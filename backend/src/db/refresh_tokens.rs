use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::crypto::refresh_token::{
    hash_refresh_token, refresh_session_expires_at, refresh_token_expires_at,
};

pub async fn create_refresh_token(
    pool: &PgPool,
    user_id: Uuid,
    raw_token: &str,
    metadata: RefreshTokenMetadata<'_>,
) -> Result<(Uuid, DateTime<Utc>), sqlx::Error> {
    let token_hash = hash_refresh_token(raw_token);
    let session_id = Uuid::new_v4();
    let session_expires_at = refresh_session_expires_at();
    let expires_at = refresh_token_expires_at(session_expires_at);

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (
            user_id,
            session_id,
            token_hash,
            expires_at,
            session_expires_at,
            device_id,
            device_label,
            user_agent,
            ip_address,
            last_used_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(session_expires_at)
    .bind(metadata.device_id)
    .bind(metadata.device_label)
    .bind(metadata.user_agent)
    .bind(metadata.ip_address)
    .execute(pool)
    .await?;

    insert_refresh_token_activity(pool, user_id, session_id, "login", metadata).await?;

    Ok((session_id, session_expires_at))
}

#[derive(Clone, Copy)]
pub struct RefreshTokenMetadata<'a> {
    pub device_id: Option<&'a str>,
    pub device_label: Option<&'a str>,
    pub user_agent: Option<&'a str>,
    pub ip_address: Option<&'a str>,
}

#[derive(Debug, Serialize)]
pub struct UserSession {
    pub id: Uuid,
    pub device_label: String,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
    pub last_used_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub trusted: bool,
    pub current: bool,
}

#[derive(Debug, Serialize)]
pub struct UserSessionActivity {
    pub id: Uuid,
    pub session_id: Uuid,
    pub action: String,
    pub device_label: Option<String>,
    pub ip_address: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn insert_refresh_token_activity(
    pool: &PgPool,
    user_id: Uuid,
    session_id: Uuid,
    action: &str,
    metadata: RefreshTokenMetadata<'_>,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO refresh_token_activity_logs (
            user_id,
            session_id,
            action,
            device_label,
            ip_address
        )
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(action)
    .bind(metadata.device_label)
    .bind(metadata.ip_address)
    .execute(pool)
    .await?;

    Ok(())
}

pub struct ValidRefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
    pub session_id: Uuid,
    pub session_expires_at: DateTime<Utc>,
}

pub enum RefreshTokenAuth {
    Valid(ValidRefreshToken),
    ReuseDetected { user_id: Uuid },
    NotFound,
}

const REFRESH_TOKEN_REUSE_GRACE_SECONDS: i32 = 30;

pub async fn authenticate_refresh_token(
    pool: &PgPool,
    raw_token: &str,
) -> Result<RefreshTokenAuth, sqlx::Error> {
    let token_hash = hash_refresh_token(raw_token);

    let row = sqlx::query_as::<_, (Uuid, Uuid, Uuid, bool, bool, DateTime<Utc>, bool)>(
        r#"
        SELECT
            id,
            session_id,
            user_id,
            revoked,
            expires_at > NOW() AS valid_exp,
            session_expires_at,
            session_expires_at > NOW() AS valid_session
        FROM refresh_tokens
        WHERE token_hash = $1
        "#,
    )
    .bind(token_hash)
    .fetch_optional(pool)
    .await?;

    let Some((id, session_id, user_id, revoked, valid_exp, session_expires_at, valid_session)) =
        row
    else {
        return Ok(RefreshTokenAuth::NotFound);
    };

    if !valid_exp || !valid_session {
        return Ok(RefreshTokenAuth::NotFound);
    }

    if revoked {
        return Ok(RefreshTokenAuth::ReuseDetected { user_id });
    }

    Ok(RefreshTokenAuth::Valid(ValidRefreshToken {
        id,
        user_id,
        session_id,
        session_expires_at,
    }))
}

pub async fn revoke_refresh_token(pool: &PgPool, token_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE id = $1
        "#,
    )
    .bind(token_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn revoke_user_session(
    pool: &PgPool,
    user_id: Uuid,
    session_id: Uuid,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE user_id = $1
          AND session_id = $2
          AND revoked = FALSE
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn revoke_all_user_refresh_tokens(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE user_id = $1 AND revoked = FALSE
        "#,
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn revoke_user_device_refresh_tokens(
    pool: &PgPool,
    user_id: Uuid,
    device_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE user_id = $1
          AND device_id = $2
          AND revoked = FALSE
        "#,
    )
    .bind(user_id)
    .bind(device_id)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn update_user_session_trust(
    pool: &PgPool,
    user_id: Uuid,
    session_id: Uuid,
    trusted: bool,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET trusted = $3
        WHERE user_id = $1
          AND session_id = $2
          AND revoked = FALSE
          AND expires_at > NOW()
          AND session_expires_at > NOW()
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(trusted)
    .execute(pool)
    .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn update_active_device_label(
    pool: &PgPool,
    user_id: Uuid,
    device_id: &str,
    device_label: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET device_label = $3,
            last_used_at = NOW()
        WHERE user_id = $1
          AND device_id = $2
          AND revoked = FALSE
          AND expires_at > NOW()
          AND session_expires_at > NOW()
        "#,
    )
    .bind(user_id)
    .bind(device_id)
    .bind(device_label)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn rotate_refresh_token(
    pool: &PgPool,
    old_token_id: Uuid,
    user_id: Uuid,
    session_id: Uuid,
    new_raw_token: &str,
    session_expires_at: DateTime<Utc>,
    metadata: RefreshTokenMetadata<'_>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE,
            last_used_at = NOW()
        WHERE id = $1 AND revoked = FALSE
        "#,
    )
    .bind(old_token_id)
    .execute(&mut *tx)
    .await?;

    let token_hash = hash_refresh_token(new_raw_token);
    let expires_at: DateTime<Utc> = refresh_token_expires_at(session_expires_at);

    sqlx::query(
        r#"
        INSERT INTO refresh_tokens (
            user_id,
            session_id,
            token_hash,
            expires_at,
            session_expires_at,
            device_id,
            device_label,
            user_agent,
            ip_address,
            last_used_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(session_expires_at)
    .bind(metadata.device_id)
    .bind(metadata.device_label)
    .bind(metadata.user_agent)
    .bind(metadata.ip_address)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO refresh_token_activity_logs (
            user_id,
            session_id,
            action,
            device_label,
            ip_address
        )
        VALUES ($1, $2, 'refresh', $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(metadata.device_label)
    .bind(metadata.ip_address)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}

pub async fn rotate_recent_refresh_token_reuse(
    pool: &PgPool,
    reused_raw_token: &str,
    new_raw_token: &str,
    metadata: RefreshTokenMetadata<'_>,
) -> Result<Option<ValidRefreshToken>, sqlx::Error> {
    let reused_token_hash = hash_refresh_token(reused_raw_token);
    let mut tx = pool.begin().await?;

    let reused = sqlx::query_as::<_, (Uuid, Uuid, DateTime<Utc>)>(
        r#"
        SELECT session_id, user_id, session_expires_at
        FROM refresh_tokens
        WHERE token_hash = $1
          AND revoked = TRUE
          AND expires_at > NOW()
          AND session_expires_at > NOW()
          AND last_used_at > NOW() - ($2 * interval '1 second')
          AND (device_id IS NULL OR device_id = $3)
        FOR UPDATE
        "#,
    )
    .bind(reused_token_hash)
    .bind(REFRESH_TOKEN_REUSE_GRACE_SECONDS)
    .bind(metadata.device_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some((session_id, user_id, session_expires_at)) = reused else {
        tx.rollback().await?;
        return Ok(None);
    };

    let active_token_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        SELECT id
        FROM refresh_tokens
        WHERE user_id = $1
          AND session_id = $2
          AND revoked = FALSE
          AND expires_at > NOW()
          AND session_expires_at > NOW()
        ORDER BY last_used_at DESC
        LIMIT 1
        FOR UPDATE
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(active_token_id) = active_token_id else {
        tx.rollback().await?;
        return Ok(None);
    };

    sqlx::query(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE,
            last_used_at = NOW()
        WHERE id = $1 AND revoked = FALSE
        "#,
    )
    .bind(active_token_id)
    .execute(&mut *tx)
    .await?;

    let token_hash = hash_refresh_token(new_raw_token);
    let expires_at: DateTime<Utc> = refresh_token_expires_at(session_expires_at);

    let new_token_id = sqlx::query_scalar::<_, Uuid>(
        r#"
        INSERT INTO refresh_tokens (
            user_id,
            session_id,
            token_hash,
            expires_at,
            session_expires_at,
            device_id,
            device_label,
            user_agent,
            ip_address,
            last_used_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
        RETURNING id
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(session_expires_at)
    .bind(metadata.device_id)
    .bind(metadata.device_label)
    .bind(metadata.user_agent)
    .bind(metadata.ip_address)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO refresh_token_activity_logs (
            user_id,
            session_id,
            action,
            device_label,
            ip_address
        )
        VALUES ($1, $2, 'refresh', $3, $4)
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(metadata.device_label)
    .bind(metadata.ip_address)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(Some(ValidRefreshToken {
        id: new_token_id,
        user_id,
        session_id,
        session_expires_at,
    }))
}

pub async fn list_active_user_sessions(
    pool: &PgPool,
    user_id: Uuid,
    current_session_id: Option<Uuid>,
) -> Result<Vec<UserSession>, sqlx::Error> {
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            Option<String>,
            Option<String>,
            DateTime<Utc>,
            DateTime<Utc>,
            DateTime<Utc>,
            bool,
        ),
    >(
        r#"
        WITH active AS (
            SELECT
                session_id,
                device_label,
                ip_address,
                created_at,
                last_used_at,
                session_expires_at,
                trusted
            FROM refresh_tokens
            WHERE user_id = $1
              AND revoked = FALSE
              AND expires_at > NOW()
              AND session_expires_at > NOW()
        ),
        latest AS (
            SELECT DISTINCT ON (session_id)
                session_id,
                device_label,
                ip_address,
                last_used_at,
                session_expires_at,
                trusted
            FROM active
            ORDER BY session_id, last_used_at DESC
        )
        SELECT
            latest.session_id,
            latest.device_label,
            latest.ip_address,
            (
                SELECT MIN(active.created_at)
                FROM active
                WHERE active.session_id = latest.session_id
            ) AS created_at,
            latest.last_used_at,
            latest.session_expires_at,
            latest.trusted
        FROM latest
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut sessions: Vec<UserSession> = rows
        .into_iter()
        .map(
            |(id, device_label, ip_address, created_at, last_used_at, expires_at, trusted)| {
                UserSession {
                    current: current_session_id == Some(id),
                    id,
                    device_label: device_label.unwrap_or_else(|| "Unknown device".into()),
                    ip_address,
                    created_at,
                    last_used_at,
                    expires_at,
                    trusted,
                }
            },
        )
        .collect();

    sessions.sort_by(|a, b| {
        b.current
            .cmp(&a.current)
            .then_with(|| b.last_used_at.cmp(&a.last_used_at))
    });

    Ok(sessions)
}

pub async fn list_user_session_activity(
    pool: &PgPool,
    user_id: Uuid,
    limit: i64,
) -> Result<Vec<UserSessionActivity>, sqlx::Error> {
    let rows = sqlx::query_as::<
        _,
        (
            Uuid,
            Uuid,
            String,
            Option<String>,
            Option<String>,
            DateTime<Utc>,
        ),
    >(
        r#"
        SELECT id, session_id, action, device_label, ip_address, created_at
        FROM refresh_token_activity_logs
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(user_id)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(
            |(id, session_id, action, device_label, ip_address, created_at)| UserSessionActivity {
                id,
                session_id,
                action,
                device_label,
                ip_address,
                created_at,
            },
        )
        .collect())
}
