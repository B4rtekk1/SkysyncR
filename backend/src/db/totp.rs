use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

pub struct TotpRecord {
    pub secret_ciphertext: Vec<u8>,
    pub secret_nonce: Vec<u8>,
    pub enabled_at: Option<DateTime<Utc>>,
    pub last_used_counter: Option<i64>,
}

pub async fn get_user_totp(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<TotpRecord>, sqlx::Error> {
    sqlx::query_as::<_, (Vec<u8>, Vec<u8>, Option<DateTime<Utc>>, Option<i64>)>(
        "SELECT secret_ciphertext, secret_nonce, enabled_at, last_used_counter FROM user_totp WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await
    .map(|record| record.map(|(secret_ciphertext, secret_nonce, enabled_at, last_used_counter)| TotpRecord {
        secret_ciphertext, secret_nonce, enabled_at, last_used_counter,
    }))
}

pub async fn save_pending_totp(
    pool: &PgPool,
    user_id: Uuid,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO user_totp (user_id, secret_ciphertext, secret_nonce) VALUES ($1, $2, $3) \
         ON CONFLICT (user_id) DO UPDATE SET secret_ciphertext = EXCLUDED.secret_ciphertext, secret_nonce = EXCLUDED.secret_nonce, enabled_at = NULL, last_used_counter = NULL, updated_at = NOW()",
    )
    .bind(user_id).bind(ciphertext).bind(nonce).execute(pool).await?;
    Ok(())
}

pub async fn enable_totp(pool: &PgPool, user_id: Uuid, counter: i64) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query(
        "UPDATE user_totp SET enabled_at = NOW(), last_used_counter = $2, updated_at = NOW() WHERE user_id = $1 AND enabled_at IS NULL",
    )
    .bind(user_id).bind(counter).execute(pool).await?.rows_affected() == 1)
}

pub async fn delete_totp(pool: &PgPool, user_id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(
        sqlx::query("DELETE FROM user_totp WHERE user_id = $1 AND enabled_at IS NOT NULL")
            .bind(user_id)
            .execute(pool)
            .await?
            .rows_affected()
            == 1,
    )
}

pub async fn create_login_challenge(
    pool: &PgPool,
    user_id: Uuid,
    remember: bool,
) -> Result<Uuid, sqlx::Error> {
    let id = Uuid::new_v4();
    sqlx::query("INSERT INTO login_totp_challenges (id, user_id, remember, expires_at) VALUES ($1, $2, $3, NOW() + interval '5 minutes')")
        .bind(id).bind(user_id).bind(remember).execute(pool).await?;
    Ok(id)
}

pub struct LoginChallenge {
    pub user_id: Uuid,
    pub remember: bool,
}

pub async fn get_login_challenge(
    pool: &PgPool,
    id: Uuid,
) -> Result<Option<LoginChallenge>, sqlx::Error> {
    sqlx::query_as::<_, (Uuid, bool)>(
        "SELECT user_id, remember FROM login_totp_challenges WHERE id = $1 AND used_at IS NULL AND expires_at > NOW() AND attempts < 5",
    )
    .bind(id).fetch_optional(pool).await
    .map(|row| row.map(|(user_id, remember)| LoginChallenge { user_id, remember }))
}

pub async fn record_login_challenge_failure(pool: &PgPool, id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE login_totp_challenges SET attempts = attempts + 1 WHERE id = $1 AND used_at IS NULL AND attempts < 5")
        .bind(id).execute(pool).await?;
    Ok(())
}

pub async fn consume_login_challenge(pool: &PgPool, id: Uuid) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE login_totp_challenges SET used_at = NOW() WHERE id = $1 AND used_at IS NULL AND expires_at > NOW()")
        .bind(id).execute(pool).await?.rows_affected() == 1)
}

pub async fn update_last_used_counter(
    pool: &PgPool,
    user_id: Uuid,
    counter: i64,
) -> Result<bool, sqlx::Error> {
    Ok(sqlx::query("UPDATE user_totp SET last_used_counter = $2, updated_at = NOW() WHERE user_id = $1 AND enabled_at IS NOT NULL AND (last_used_counter IS NULL OR last_used_counter < $2)")
        .bind(user_id).bind(counter).execute(pool).await?.rows_affected() == 1)
}
