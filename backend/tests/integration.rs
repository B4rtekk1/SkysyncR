use chrono::{Duration, Utc};
use skysyncr::crypto::jwt::{generate_access_token_capped, verify_access_token};
use skysyncr::db::files::{
    NewFileRecord, NewFileShare, consume_public_file_share_for_download, create_file_record,
    get_user_file_for_content_update_in_tx, get_user_file_for_download,
    list_files_shared_with_user, rename_user_file, update_user_file_content, update_user_file_note,
    upsert_user_file_share,
};
use skysyncr::db::refresh_tokens::{
    RefreshTokenAuth, authenticate_refresh_token, create_refresh_token, rotate_refresh_token,
};
use skysyncr::db::storage::{get_storage_quota, try_apply_storage_delta};
use skysyncr::db::users::{
    is_login_allowed, record_failed_login, reset_failed_login, update_last_login,
};
use sqlx::{Executor, PgPool, postgres::PgPoolOptions};
use std::borrow::Cow;
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, OwnedMutexGuard};
use uuid::Uuid;

static DB_LOCK: OnceLock<Arc<Mutex<()>>> = OnceLock::new();

async fn test_pool() -> (OwnedMutexGuard<()>, PgPool) {
    let (guard, pool) = reset_test_pool().await;
    skysyncr::db::migrations::run(&pool)
        .await
        .expect("apply migrations");

    (guard, pool)
}

async fn reset_test_pool() -> (OwnedMutexGuard<()>, PgPool) {
    let guard = DB_LOCK
        .get_or_init(|| Arc::new(Mutex::new(())))
        .clone()
        .lock_owned()
        .await;
    let database_url =
        std::env::var("DATABASE_URL").expect("DATABASE_URL must be set for integration tests");
    let allow_non_local_reset = std::env::var("SKYSYNCR_ALLOW_NON_LOCAL_TEST_DB_RESET")
        .map(|value| value == "true")
        .unwrap_or(false);
    let database_name = database_url
        .rsplit_once('/')
        .map(|(_, name)| name)
        .map(|name| name.split(['?', '#']).next().unwrap_or(name))
        .map(Cow::from)
        .unwrap_or_else(|| Cow::from(""));
    assert!(
        allow_non_local_reset || database_name.to_lowercase().contains("test"),
        "integration tests reset the public schema; use a dedicated test database name containing 'test' or set SKYSYNCR_ALLOW_NON_LOCAL_TEST_DB_RESET=true",
    );

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await
        .expect("connect to test database");

    pool.execute(
        "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS migration_backups CASCADE; CREATE SCHEMA public;",
    )
        .await
        .expect("reset schema");

    (guard, pool)
}

async fn table_column_exists(pool: &PgPool, table: &str, column: &str) -> bool {
    sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = $1
              AND column_name = $2
        )
        "#,
    )
    .bind(table)
    .bind(column)
    .fetch_one(pool)
    .await
    .expect("check column")
}

async fn create_legacy_schema(pool: &PgPool) {
    pool.execute(
        r#"
        CREATE EXTENSION IF NOT EXISTS pgcrypto;

        CREATE TABLE users
        (
            id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            email                           TEXT NOT NULL UNIQUE,
            password_hash                   TEXT NOT NULL,
            public_key                      TEXT,
            email_verified                  BOOLEAN NOT NULL DEFAULT FALSE,
            verification_token              TEXT,
            display_name                    TEXT,
            is_active                       BOOLEAN NOT NULL DEFAULT TRUE,
            failed_login_attempts           INT NOT NULL DEFAULT 0,
            locked_until                    timestamptz,
            password_reset_token            TEXT,
            password_reset_token_expiration timestamptz,
            created_at                      timestamptz NOT NULL DEFAULT NOW(),
            updated_at                      timestamptz NOT NULL DEFAULT NOW(),
            last_login_at                   timestamptz
        );

        CREATE TABLE folders
        (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            name             TEXT NOT NULL,
            parent_folder_id UUID REFERENCES folders (id) ON DELETE SET NULL,
            deleted_at       timestamptz,
            is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
            created_at       timestamptz NOT NULL DEFAULT NOW(),
            updated_at       timestamptz NOT NULL DEFAULT NOW()
        );

        CREATE TABLE files
        (
            id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_id         UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            filename         TEXT NOT NULL,
            storage_path     TEXT NOT NULL,
            mime_type        TEXT,
            size_bytes       BIGINT NOT NULL,
            encrypted_key    bytea,
            encryption_nonce bytea,
            checksum         TEXT,
            folder_id        UUID REFERENCES folders (id) ON DELETE SET NULL,
            is_deleted       BOOLEAN NOT NULL DEFAULT FALSE,
            is_public        BOOLEAN NOT NULL DEFAULT FALSE,
            share_token      TEXT,
            created_at       timestamptz NOT NULL DEFAULT NOW(),
            updated_at       timestamptz NOT NULL DEFAULT NOW(),
            deleted_at       timestamptz
        );

        CREATE TABLE refresh_tokens
        (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id    UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at timestamptz NOT NULL,
            revoked    BOOLEAN NOT NULL DEFAULT FALSE,
            user_agent TEXT,
            ip_address TEXT,
            device_id  TEXT,
            created_at timestamptz NOT NULL DEFAULT NOW()
        );

        CREATE TABLE audit_logs
        (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id       UUID REFERENCES users (id) ON DELETE SET NULL,
            action        TEXT NOT NULL,
            resource_id   UUID,
            resource_type TEXT,
            ip_address    TEXT,
            created_at    timestamptz NOT NULL DEFAULT NOW()
        );

        CREATE TABLE groups
        (
            id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name       TEXT NOT NULL,
            owner_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            created_at timestamptz NOT NULL DEFAULT NOW(),
            updated_at timestamptz NOT NULL DEFAULT NOW()
        );

        CREATE TABLE group_invitations
        (
            id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            group_id           UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
            invited_email      TEXT NOT NULL,
            invited_by_user_id UUID NOT NULL REFERENCES users (id),
            token              TEXT NOT NULL UNIQUE,
            status             TEXT NOT NULL DEFAULT 'pending',
            expires_at         timestamptz NOT NULL,
            created_at         timestamptz NOT NULL DEFAULT NOW()
        );

        CREATE TABLE file_shares
        (
            id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            file_id             UUID NOT NULL REFERENCES files (id) ON DELETE CASCADE,
            shared_by_user_id   UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            shared_with_user_id UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
            permission          TEXT NOT NULL DEFAULT 'read',
            created_at          timestamptz NOT NULL DEFAULT NOW()
        );
        "#,
    )
    .await
    .expect("create legacy schema");
}

async fn insert_user(pool: &PgPool, email: &str) -> Uuid {
    sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO users (
            email,
            password_hash,
            public_key,
            display_name,
            email_verified
        )
        VALUES ($1, '$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', $2, $3, TRUE)
        RETURNING id
        "#,
    )
    .bind(email)
    .bind(format!("public-key-for-{email}"))
    .bind(email.split('@').next().unwrap_or("user"))
    .fetch_one(pool)
    .await
    .expect("insert user")
}

#[tokio::test]
async fn migrations_apply_to_empty_database() {
    let (_guard, pool) = reset_test_pool().await;

    skysyncr::db::migrations::run(&pool)
        .await
        .expect("migrate empty database");

    assert!(table_column_exists(&pool, "users", "avatar_url").await);
    assert!(table_column_exists(&pool, "file_shares", "encrypted_key").await);
    assert!(table_column_exists(&pool, "calendar_entries", "reminder").await);
}

#[tokio::test]
async fn migrations_apply_to_existing_legacy_database_and_backup_destructive_changes() {
    let (_guard, pool) = reset_test_pool().await;
    create_legacy_schema(&pool).await;

    let owner_id = insert_user(&pool, "legacy-owner@example.test").await;
    let recipient_id = insert_user(&pool, "legacy-recipient@example.test").await;
    let file_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO files (owner_id, filename, storage_path, size_bytes)
        VALUES ($1, 'legacy.txt', 'legacy.txt.enc', 10)
        RETURNING id
        "#,
    )
    .bind(owner_id)
    .fetch_one(&pool)
    .await
    .expect("insert legacy file");

    sqlx::query(
        r#"
        INSERT INTO file_shares (file_id, shared_by_user_id, shared_with_user_id)
        VALUES ($1, $2, $3)
        "#,
    )
    .bind(file_id)
    .bind(owner_id)
    .bind(recipient_id)
    .execute(&pool)
    .await
    .expect("insert legacy share without encrypted key");

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (
            user_id, token_hash, expires_at, user_agent, ip_address, device_id
        )
        VALUES ($1, 'legacy-token', NOW() + interval '1 day', 'test-agent', '127.0.0.1', 'device-1')
        "#,
    )
    .bind(owner_id)
    .execute(&pool)
    .await
    .expect("insert legacy refresh token");

    skysyncr::db::migrations::run(&pool)
        .await
        .expect("migrate legacy database");

    assert!(table_column_exists(&pool, "users", "verification_token_expires_at").await);
    assert!(table_column_exists(&pool, "users", "sync_on_metered").await);
    assert!(table_column_exists(&pool, "refresh_tokens", "session_expires_at").await);
    assert!(!table_column_exists(&pool, "refresh_tokens", "user_agent").await);
    assert!(table_column_exists(&pool, "file_shares", "owner_id").await);
    assert!(table_column_exists(&pool, "file_shares", "recipient_user_id").await);
    assert!(table_column_exists(&pool, "file_shares", "encrypted_key").await);

    let backed_up_refresh_tokens = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM migration_backups.refresh_tokens_device_metadata_20260717000400",
    )
    .fetch_one(&pool)
    .await
    .expect("count refresh token backup rows");
    assert_eq!(backed_up_refresh_tokens, 1);

    let backed_up_file_shares = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM migration_backups.file_shares_missing_encrypted_key_20260717001400",
    )
    .fetch_one(&pool)
    .await
    .expect("count file share backup rows");
    assert_eq!(backed_up_file_shares, 1);

    let remaining_file_shares = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM file_shares")
        .fetch_one(&pool)
        .await
        .expect("count migrated shares");
    assert_eq!(remaining_file_shares, 0);
}

#[tokio::test]
async fn auth_lockout_blocks_after_failed_attempts_and_resets_on_success() {
    let (_guard, pool) = test_pool().await;
    let email = "auth-lockout@example.test";
    insert_user(&pool, email).await;

    assert!(is_login_allowed(&pool, email).await.unwrap());

    record_failed_login(&pool, email, 2, 30).await.unwrap();
    assert!(is_login_allowed(&pool, email).await.unwrap());

    record_failed_login(&pool, email, 2, 30).await.unwrap();
    assert!(!is_login_allowed(&pool, email).await.unwrap());

    reset_failed_login(&pool, email).await.unwrap();
    update_last_login(&pool, email).await.unwrap();
    assert!(is_login_allowed(&pool, email).await.unwrap());
}

#[tokio::test]
async fn storage_quota_rejects_overflow_and_negative_usage() {
    let (_guard, pool) = test_pool().await;
    let user_id = insert_user(&pool, "quota@example.test").await;

    sqlx::query(
        r#"
        INSERT INTO storage_quotas (user_id, max_bytes, used_bytes)
        VALUES ($1, 100, 0)
        ON CONFLICT (user_id)
        DO UPDATE SET max_bytes = 100, used_bytes = 0
        "#,
    )
    .bind(user_id)
    .execute(&pool)
    .await
    .unwrap();

    let mut tx = pool.begin().await.unwrap();
    assert!(try_apply_storage_delta(&mut tx, user_id, 60).await.unwrap());
    tx.commit().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    assert!(!try_apply_storage_delta(&mut tx, user_id, 41).await.unwrap());
    tx.commit().await.unwrap();

    let mut tx = pool.begin().await.unwrap();
    assert!(
        !try_apply_storage_delta(&mut tx, user_id, -61)
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();

    let quota = get_storage_quota(&pool, user_id).await.unwrap();
    assert_eq!(quota.used_bytes, 60);
    assert_eq!(quota.total_bytes, 100);
}

#[tokio::test]
async fn refresh_token_rotation_revokes_old_token_and_accepts_new_token() {
    let (_guard, pool) = test_pool().await;
    let user_id = insert_user(&pool, "refresh@example.test").await;
    let old_token = "old-refresh-token";
    let new_token = "new-refresh-token";

    let session_expires_at = create_refresh_token(&pool, user_id, old_token)
        .await
        .unwrap();

    let valid = authenticate_refresh_token(&pool, old_token).await.unwrap();
    let RefreshTokenAuth::Valid(stored) = valid else {
        panic!("old token should start valid");
    };

    rotate_refresh_token(&pool, stored.id, user_id, new_token, session_expires_at)
        .await
        .unwrap();

    match authenticate_refresh_token(&pool, old_token).await.unwrap() {
        RefreshTokenAuth::ReuseDetected { user_id: detected } => assert_eq!(detected, user_id),
        _ => panic!("old token reuse should be detected"),
    }

    match authenticate_refresh_token(&pool, new_token).await.unwrap() {
        RefreshTokenAuth::Valid(rotated) => {
            assert_eq!(rotated.user_id, user_id);
            assert!(
                (rotated.session_expires_at - session_expires_at)
                    .num_milliseconds()
                    .abs()
                    <= 1
            );
        }
        _ => panic!("new token should be valid"),
    }
}

#[tokio::test]
async fn jwt_access_token_is_capped_by_session_expiration() {
    let user_id = Uuid::new_v4().to_string();
    let session_exp = Utc::now() + Duration::seconds(30);

    let (token, expires_in) =
        generate_access_token_capped(&user_id, "test-secret", session_exp).unwrap();
    let claims = verify_access_token(&token, "test-secret").unwrap();

    assert_eq!(claims.sub, user_id);
    assert!(expires_in <= 30);
    assert!(expires_in > 0);
}

#[tokio::test]
async fn file_sharing_grants_recipient_access_without_self_share() {
    let (_guard, pool) = test_pool().await;
    let owner_id = insert_user(&pool, "owner@example.test").await;
    let recipient_id = insert_user(&pool, "recipient@example.test").await;

    let mut tx = pool.begin().await.unwrap();
    let file = create_file_record(
        &mut tx,
        NewFileRecord {
            owner_id,
            filename: "shared.txt".to_string(),
            storage_path: "shared.txt.enc".to_string(),
            mime_type: Some("text/plain".to_string()),
            size_bytes: 12,
            encrypted_key: b"owner-key".to_vec(),
            encryption_nonce: b"nonce".to_vec(),
            checksum: "checksum".to_string(),
            folder_id: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let share = upsert_user_file_share(
        &pool,
        NewFileShare {
            owner_id,
            file_id: file.id,
            recipient_email: "recipient@example.test".to_string(),
            permission: "download".to_string(),
            encrypted_key: b"recipient-wrapped-key".to_vec(),
        },
    )
    .await
    .unwrap()
    .expect("share should be created");
    assert_eq!(share.permission, "download");

    let shared = list_files_shared_with_user(&pool, recipient_id)
        .await
        .unwrap();
    assert_eq!(shared.len(), 1);
    assert_eq!(shared[0].file.id, file.id);
    assert_eq!(shared[0].file.encrypted_key, b"recipient-wrapped-key");

    let download = get_user_file_for_download(&pool, recipient_id, file.id)
        .await
        .unwrap()
        .expect("recipient can download shared file");
    assert_eq!(download.filename, "shared.txt");

    let self_share = upsert_user_file_share(
        &pool,
        NewFileShare {
            owner_id,
            file_id: file.id,
            recipient_email: "owner@example.test".to_string(),
            permission: "read".to_string(),
            encrypted_key: b"self-key".to_vec(),
        },
    )
    .await
    .unwrap();
    assert!(self_share.is_none());
}

#[tokio::test]
async fn file_share_permissions_gate_download_access() {
    let (_guard, pool) = test_pool().await;
    let owner_id = insert_user(&pool, "download-owner@example.test").await;
    let read_user_id = insert_user(&pool, "read-recipient@example.test").await;
    let download_user_id = insert_user(&pool, "download-recipient@example.test").await;
    let write_user_id = insert_user(&pool, "write-recipient@example.test").await;

    let mut tx = pool.begin().await.unwrap();
    let file = create_file_record(
        &mut tx,
        NewFileRecord {
            owner_id,
            filename: "permissioned.txt".to_string(),
            storage_path: "permissioned.txt.enc".to_string(),
            mime_type: Some("text/plain".to_string()),
            size_bytes: 12,
            encrypted_key: b"owner-key".to_vec(),
            encryption_nonce: b"nonce".to_vec(),
            checksum: "checksum".to_string(),
            folder_id: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    for (email, permission) in [
        ("read-recipient@example.test", "read"),
        ("download-recipient@example.test", "download"),
        ("write-recipient@example.test", "write"),
    ] {
        upsert_user_file_share(
            &pool,
            NewFileShare {
                owner_id,
                file_id: file.id,
                recipient_email: email.to_string(),
                permission: permission.to_string(),
                encrypted_key: format!("{permission}-wrapped-key").into_bytes(),
            },
        )
        .await
        .unwrap()
        .expect("share should be created");
    }

    let owner_download = get_user_file_for_download(&pool, owner_id, file.id)
        .await
        .unwrap();
    assert!(owner_download.is_some());

    let read_download = get_user_file_for_download(&pool, read_user_id, file.id)
        .await
        .unwrap();
    assert!(read_download.is_none());

    let download_download = get_user_file_for_download(&pool, download_user_id, file.id)
        .await
        .unwrap();
    assert!(download_download.is_some());

    let write_download = get_user_file_for_download(&pool, write_user_id, file.id)
        .await
        .unwrap();
    assert!(write_download.is_some());
}

#[tokio::test]
async fn file_share_write_permission_gates_mutations_and_preserves_owner_key() {
    let (_guard, pool) = test_pool().await;
    let owner_id = insert_user(&pool, "write-owner@example.test").await;
    let read_user_id = insert_user(&pool, "readonly-writer@example.test").await;
    let writer_id = insert_user(&pool, "writer@example.test").await;

    let mut tx = pool.begin().await.unwrap();
    let file = create_file_record(
        &mut tx,
        NewFileRecord {
            owner_id,
            filename: "draft.txt".to_string(),
            storage_path: "draft-v1.txt.enc".to_string(),
            mime_type: Some("text/plain".to_string()),
            size_bytes: 12,
            encrypted_key: b"owner-wrapped-key".to_vec(),
            encryption_nonce: b"nonce".to_vec(),
            checksum: "checksum-v1".to_string(),
            folder_id: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    for (email, permission) in [
        ("readonly-writer@example.test", "read"),
        ("writer@example.test", "write"),
    ] {
        upsert_user_file_share(
            &pool,
            NewFileShare {
                owner_id,
                file_id: file.id,
                recipient_email: email.to_string(),
                permission: permission.to_string(),
                encrypted_key: format!("{permission}-wrapped-key").into_bytes(),
            },
        )
        .await
        .unwrap()
        .expect("share should be created");
    }

    let mut read_tx = pool.begin().await.unwrap();
    let read_target = get_user_file_for_content_update_in_tx(&mut read_tx, read_user_id, file.id)
        .await
        .unwrap();
    read_tx.commit().await.unwrap();
    assert!(read_target.is_none());

    let renamed = rename_user_file(&pool, writer_id, file.id, "draft-renamed.txt".to_string())
        .await
        .unwrap()
        .expect("writer can rename");
    assert_eq!(renamed.filename, "draft-renamed.txt");

    let noted = update_user_file_note(&pool, writer_id, file.id, Some("reviewed".to_string()))
        .await
        .unwrap()
        .expect("writer can update note");
    assert_eq!(noted.note.as_deref(), Some("reviewed"));

    let mut write_tx = pool.begin().await.unwrap();
    let write_target = get_user_file_for_content_update_in_tx(&mut write_tx, writer_id, file.id)
        .await
        .unwrap()
        .expect("writer can lock file for update");
    assert_eq!(write_target.owner_id, owner_id);

    let updated = update_user_file_content(
        &mut write_tx,
        writer_id,
        file.id,
        "draft-v2.txt.enc".to_string(),
        24,
        b"writer-wrapped-key".to_vec(),
        b"nonce-v2".to_vec(),
        Some("checksum-v2".to_string()),
    )
    .await
    .unwrap()
    .expect("writer can update content");
    write_tx.commit().await.unwrap();

    assert_eq!(updated.size_bytes, 24);
    assert_eq!(updated.encrypted_key, b"owner-wrapped-key");
    assert_eq!(updated.encryption_nonce, b"nonce-v2");

    let stored_owner_key =
        sqlx::query_scalar::<_, Vec<u8>>("SELECT encrypted_key FROM files WHERE id = $1")
            .bind(file.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(stored_owner_key, b"owner-wrapped-key");
}

#[tokio::test]
async fn public_file_share_download_consumes_limit_atomically() {
    let (_guard, pool) = test_pool().await;
    let owner_id = insert_user(&pool, "public-owner@example.test").await;
    let share_token = Uuid::new_v4().to_string();

    let mut tx = pool.begin().await.unwrap();
    let file = create_file_record(
        &mut tx,
        NewFileRecord {
            owner_id,
            filename: "public.txt".to_string(),
            storage_path: "public.txt.enc".to_string(),
            mime_type: Some("text/plain".to_string()),
            size_bytes: 42,
            encrypted_key: b"owner-key".to_vec(),
            encryption_nonce: b"nonce".to_vec(),
            checksum: "checksum".to_string(),
            folder_id: None,
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    sqlx::query(
        r#"
        UPDATE files
        SET is_public = TRUE,
            share_token = $2,
            share_download_limit = 1,
            share_download_count = 0
        WHERE id = $1
        "#,
    )
    .bind(file.id)
    .bind(&share_token)
    .execute(&pool)
    .await
    .unwrap();

    let download = consume_public_file_share_for_download(&pool, &share_token)
        .await
        .unwrap()
        .expect("first public download should be allowed");
    assert_eq!(download.filename, "public.txt");

    let blocked = consume_public_file_share_for_download(&pool, &share_token)
        .await
        .unwrap();
    assert!(blocked.is_none());

    let count =
        sqlx::query_scalar::<_, i32>("SELECT share_download_count FROM files WHERE id = $1")
            .bind(file.id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(count, 1);
}
