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
) -> Result<DateTime<Utc>, sqlx::Error> {
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
            device_label,
            user_agent,
            ip_address,
            last_used_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(session_expires_at)
    .bind(metadata.device_label)
    .bind(metadata.user_agent)
    .bind(metadata.ip_address)
    .execute(pool)
    .await?;

    insert_refresh_token_activity(pool, user_id, session_id, "login", metadata).await?;

    Ok(session_expires_at)
}

#[derive(Clone, Copy)]
pub struct RefreshTokenMetadata<'a> {
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

    let Some((id, session_id, user_id, revoked, valid_exp, session_expires_at, valid_session)) = row
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
        SET revoked = TRUE
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
            device_label,
            user_agent,
            ip_address,
            last_used_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        "#,
    )
    .bind(user_id)
    .bind(session_id)
    .bind(token_hash)
    .bind(expires_at)
    .bind(session_expires_at)
    .bind(metadata.device_label)
    .bind(metadata.user_agent)
    .bind(metadata.ip_address)
    .execute(&mut *tx)
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
                session_expires_at
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
                session_expires_at
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
            latest.session_expires_at
        FROM latest
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut sessions: Vec<UserSession> = rows
        .into_iter()
        .map(
            |(id, device_label, ip_address, created_at, last_used_at, expires_at)| UserSession {
                current: current_session_id == Some(id),
                id,
                device_label: device_label.unwrap_or_else(|| "Unknown device".into()),
                ip_address,
                created_at,
                last_used_at,
                expires_at,
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
            |(id, session_id, action, device_label, ip_address, created_at)| {
                UserSessionActivity {
                    id,
                    session_id,
                    action,
                    device_label,
                    ip_address,
                    created_at,
                }
            },
        )
        .collect())
}
