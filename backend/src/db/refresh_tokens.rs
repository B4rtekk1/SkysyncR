use chrono::{DateTime, Utc};
use sqlx::PgPool;
use sqlx::types::ipnetwork::IpNetwork;
use uuid::Uuid;

use crate::crypto::refresh_token::{hash_refresh_token, refresh_token_expires_at};
use crate::utils::device::DeviceContext;

pub async fn create_refresh_token(
    pool: &PgPool,
    user_id: Uuid,
    raw_token: &str,
    device: &DeviceContext,
) -> Result<(), sqlx::Error> {
    let token_hash = hash_refresh_token(raw_token);
    let expires_at = refresh_token_expires_at();
    let ip_address: Option<IpNetwork> = device.ip_address.map(IpNetwork::from);

    sqlx::query!(
        r#"
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_id, user_agent, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6::inet)
        "#,
        user_id,
        token_hash,
        expires_at,
        device.device_id,
        device.user_agent,
        ip_address
    )
        .execute(pool)
        .await?;

    Ok(())
}

pub struct ValidRefreshToken {
    pub id: Uuid,
    pub user_id: Uuid,
}

pub enum RefreshTokenAuth {
    Valid(ValidRefreshToken),
    ReuseDetected { user_id: Uuid },
    DeviceMismatch { user_id: Uuid },
    NotFound,
}

pub async fn authenticate_refresh_token(
    pool: &PgPool,
    raw_token: &str,
    device: &DeviceContext,
) -> Result<RefreshTokenAuth, sqlx::Error> {
    let token_hash = hash_refresh_token(raw_token);

    let row = sqlx::query!(
        r#"
        SELECT
            id,
            user_id,
            device_id,
            user_agent,
            revoked,
            expires_at > NOW() AS "valid_exp!: bool"
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

    if !row.valid_exp {
        return Ok(RefreshTokenAuth::NotFound);
    }

    if row.revoked {
        return Ok(RefreshTokenAuth::ReuseDetected {
            user_id: row.user_id,
        });
    }

    let stored_device_id = row.device_id.unwrap_or_default();
    if !device.matches_stored(&stored_device_id, row.user_agent.as_deref()) {
        return Ok(RefreshTokenAuth::DeviceMismatch {
            user_id: row.user_id,
        });
    }

    Ok(RefreshTokenAuth::Valid(ValidRefreshToken {
        id: row.id,
        user_id: row.user_id,
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
    device: &DeviceContext,
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
    let expires_at: DateTime<Utc> = refresh_token_expires_at();
    let ip_address: Option<IpNetwork> = device.ip_address.map(IpNetwork::from);

    sqlx::query!(
        r#"
        INSERT INTO refresh_tokens (user_id, token_hash, expires_at, device_id, user_agent, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6::inet)
        "#,
        user_id,
        token_hash,
        expires_at,
        device.device_id,
        device.user_agent,
        ip_address
    )
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;
    Ok(())
}
