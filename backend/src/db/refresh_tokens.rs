use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::crypto::refresh_token::{
    hash_refresh_token, refresh_session_expires_at, refresh_token_expires_at,
};

pub async fn create_refresh_token(
    pool: &PgPool,
    user_id: Uuid,
    raw_token: &str,
) -> Result<DateTime<Utc>, sqlx::Error> {
    let token_hash = hash_refresh_token(raw_token);
    let session_expires_at = refresh_session_expires_at();
    let expires_at = refresh_token_expires_at(session_expires_at);

    sqlx::query!(
        r#"
        INSERT INTO refresh_tokens (
            user_id,
            token_hash,
            expires_at,
            session_expires_at
        )
        VALUES ($1, $2, $3, $4)
        "#,
        user_id,
        token_hash,
        expires_at,
        session_expires_at
    )
    .execute(pool)
    .await?;

    Ok(session_expires_at)
}

pub struct ValidRefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
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

    let row = sqlx::query!(
        r#"
        SELECT
            id,
            user_id,
            revoked,
            expires_at > NOW() AS "valid_exp!: bool",
            session_expires_at AS "session_expires_at!: DateTime<Utc>",
            session_expires_at > NOW() AS "valid_session!: bool"
        FROM refresh_tokens
        WHERE token_hash = $1
        "#,
        token_hash
    )
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else {
        return Ok(RefreshTokenAuth::NotFound);
    };

    if !row.valid_exp || !row.valid_session {
        return Ok(RefreshTokenAuth::NotFound);
    }

    if row.revoked {
        return Ok(RefreshTokenAuth::ReuseDetected {
            user_id: row.user_id,
        });
    }

    Ok(RefreshTokenAuth::Valid(ValidRefreshToken {
        id: row.id,
        user_id: row.user_id,
        session_expires_at: row.session_expires_at,
    }))
}

pub async fn revoke_refresh_token(pool: &PgPool, token_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE id = $1
        "#,
        token_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn revoke_all_user_refresh_tokens(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE user_id = $1 AND revoked = FALSE
        "#,
        user_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn rotate_refresh_token(
    pool: &PgPool,
    old_token_id: Uuid,
    user_id: Uuid,
    new_raw_token: &str,
    session_expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;

    sqlx::query!(
        r#"
        UPDATE refresh_tokens
        SET revoked = TRUE
        WHERE id = $1 AND revoked = FALSE
        "#,
        old_token_id
    )
    .execute(&mut *tx)
    .await?;

    let token_hash = hash_refresh_token(new_raw_token);
    let expires_at: DateTime<Utc> = refresh_token_expires_at(session_expires_at);

    sqlx::query!(
        r#"
        INSERT INTO refresh_tokens (
            user_id,
            token_hash,
            expires_at,
            session_expires_at
        )
        VALUES ($1, $2, $3, $4)
        "#,
        user_id,
        token_hash,
        expires_at,
        session_expires_at
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
