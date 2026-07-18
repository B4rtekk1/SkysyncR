use crate::crypto::email::{generate_verification_token, hash_verification_token};
use sqlx::PgPool;
use uuid::Uuid;

pub const DUMMY_PASSWORD_HASH: &str =
    "$2b$12$KIXS5zJhFq5hJ2iP6TLmA.UK5dt2rceoLI04AmYwrPkaEkoNgRuPK";

pub struct NewUser<'a> {
    pub email: &'a str,
    pub display_name: &'a str,
    pub password_hash: &'a str,
    pub public_key: &'a str,
}

pub async fn create_user(
    pool: &PgPool,
    new_user: NewUser<'_>,
    verification_ttl_hours: i64,
) -> Result<(Uuid, String), sqlx::Error> {
    let token = generate_verification_token();
    let token_hash = hash_verification_token(&token);
    let mut tx = pool.begin().await?;

    let user_id = sqlx::query!(
        r#"
        INSERT INTO users (
            email, password_hash, public_key, display_name,
            verification_token, verification_token_expires_at
        )
        VALUES ($1, $2, $3, $4, $5, NOW() + ($6::int * interval '1 hour'))
        RETURNING id
        "#,
        new_user.email,
        new_user.password_hash,
        new_user.public_key,
        new_user.display_name,
        token_hash,
        verification_ttl_hours as i32
    )
    .fetch_one(&mut *tx)
    .await?
    .id;

    sqlx::query!(
        r#"
        INSERT INTO storage_quotas (user_id)
        VALUES ($1)
        ON CONFLICT (user_id) DO NOTHING
        "#,
        user_id
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((user_id, token))
}

pub async fn compare_passwords(
    pool: &PgPool,
    email: &str,
    password: &str,
) -> Result<bool, sqlx::Error> {
    let user = sqlx::query!(r#"SELECT password_hash FROM users WHERE email = $1"#, email)
        .fetch_optional(pool)
        .await?;

    let hash = user
        .map(|u| u.password_hash)
        .unwrap_or(DUMMY_PASSWORD_HASH.to_string());

    let is_valid = bcrypt::verify(password, &hash).unwrap_or(false);
    Ok(is_valid)
}

pub struct LoginAuthRecord {
    pub id: Uuid,
    pub password_hash: String,
    pub email_verified: bool,
    pub login_allowed: bool,
}

pub async fn get_login_auth_record(
    pool: &PgPool,
    email: &str,
) -> Result<Option<LoginAuthRecord>, sqlx::Error> {
    let result = sqlx::query_as::<_, (Uuid, String, bool, bool)>(
        r#"
        SELECT
            id,
            password_hash,
            email_verified,
            CASE
                WHEN locked_until IS NULL THEN TRUE
                WHEN locked_until <= NOW() THEN TRUE
                ELSE FALSE
            END AS login_allowed
        FROM users
        WHERE email = $1
          AND is_active = TRUE
        "#,
    )
    .bind(email)
    .fetch_optional(pool)
    .await?;

    Ok(result.map(
        |(id, password_hash, email_verified, login_allowed)| LoginAuthRecord {
            id,
            password_hash,
            email_verified,
            login_allowed,
        },
    ))
}

pub async fn verify_email_token(pool: &PgPool, token: &str) -> Result<bool, sqlx::Error> {
    let token_hash = hash_verification_token(token);
    let result = sqlx::query!(
        r#"
        UPDATE users
        SET email_verified = TRUE,
            verification_token = NULL,
            verification_token_expires_at = NULL
        WHERE verification_token = $1
          AND (verification_token_expires_at IS NULL OR verification_token_expires_at > NOW())
        RETURNING id
        "#,
        token_hash
    )
    .fetch_optional(pool)
    .await?;

    Ok(result.is_some())
}

pub async fn is_user_verified(pool: &PgPool, email: &str) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT email_verified FROM users WHERE email = $1
        "#,
        email
    )
    .fetch_optional(pool)
    .await?;

    Ok(result.map(|r| r.email_verified).unwrap_or(false))
}

pub async fn get_user_id_by_email(pool: &PgPool, email: &str) -> Result<Option<Uuid>, sqlx::Error> {
    let result = sqlx::query!(r#"SELECT id FROM users WHERE email = $1"#, email)
        .fetch_optional(pool)
        .await?;

    Ok(result.map(|r| r.id))
}

pub struct CurrentUserCryptoProfile {
    pub id: Uuid,
    pub email: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub public_key: Option<String>,
    pub default_view: String,
    pub layout_mode: String,
    pub upload_protection: bool,
    pub compact_metadata: bool,
    pub device_lock: bool,
    pub sync_on_metered: bool,
    pub trash_retention_days: i32,
}

pub async fn get_current_user_crypto_profile(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Option<CurrentUserCryptoProfile>, sqlx::Error> {
    let result = sqlx::query_as::<
        _,
        (
            Uuid,
            String,
            Option<String>,
            Option<String>,
            Option<String>,
            String,
            String,
            bool,
            bool,
            bool,
            bool,
            i32,
        ),
    >(
        r#"
        SELECT
            id,
            email,
            display_name,
            avatar_url,
            public_key,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days
        FROM users
        WHERE id = $1
          AND is_active = TRUE
        "#,
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(result.map(
        |(
            id,
            email,
            display_name,
            avatar_url,
            public_key,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days,
        )| CurrentUserCryptoProfile {
            id,
            email,
            display_name,
            avatar_url,
            public_key,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days,
        },
    ))
}

pub struct UserSettingsUpdate {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub default_view: Option<String>,
    pub layout_mode: Option<String>,
    pub upload_protection: Option<bool>,
    pub compact_metadata: Option<bool>,
    pub device_lock: Option<bool>,
    pub sync_on_metered: Option<bool>,
    pub trash_retention_days: Option<i32>,
}

pub struct UserSettingsRecord {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub default_view: String,
    pub layout_mode: String,
    pub upload_protection: bool,
    pub compact_metadata: bool,
    pub device_lock: bool,
    pub sync_on_metered: bool,
    pub trash_retention_days: i32,
}

pub async fn update_user_settings_record(
    pool: &PgPool,
    user_id: Uuid,
    update: UserSettingsUpdate,
) -> Result<Option<UserSettingsRecord>, sqlx::Error> {
    let result = sqlx::query_as::<
        _,
        (
            Option<String>,
            Option<String>,
            String,
            String,
            bool,
            bool,
            bool,
            bool,
            i32,
        ),
    >(
        r#"
        UPDATE users
        SET display_name = COALESCE($1, display_name),
            avatar_url = COALESCE($2, avatar_url),
            default_view = COALESCE($3, default_view),
            layout_mode = COALESCE($4, layout_mode),
            upload_protection = COALESCE($5, upload_protection),
            compact_metadata = COALESCE($6, compact_metadata),
            device_lock = COALESCE($7, device_lock),
            sync_on_metered = COALESCE($8, sync_on_metered),
            trash_retention_days = COALESCE($9, trash_retention_days),
            updated_at = NOW()
        WHERE id = $10
          AND is_active = TRUE
        RETURNING
            display_name,
            avatar_url,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days
        "#,
    )
    .bind(update.display_name)
    .bind(update.avatar_url)
    .bind(update.default_view)
    .bind(update.layout_mode)
    .bind(update.upload_protection)
    .bind(update.compact_metadata)
    .bind(update.device_lock)
    .bind(update.sync_on_metered)
    .bind(update.trash_retention_days)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    Ok(result.map(
        |(
            display_name,
            avatar_url,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days,
        )| UserSettingsRecord {
            display_name,
            avatar_url,
            default_view,
            layout_mode,
            upload_protection,
            compact_metadata,
            device_lock,
            sync_on_metered,
            trash_retention_days,
        },
    ))
}

pub async fn update_last_login(pool: &PgPool, email: &str) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE users
        SET last_login_at = NOW()
        WHERE email = $1
        "#,
        email
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn is_login_allowed(pool: &PgPool, email: &str) -> Result<bool, sqlx::Error> {
    let allowed = sqlx::query_scalar!(
        r#"
        SELECT
            CASE
                WHEN locked_until IS NULL THEN TRUE
                WHEN locked_until <= NOW() THEN TRUE
                ELSE FALSE
            END AS "allowed!: bool"
        FROM users
        WHERE email = $1
        "#,
        email
    )
    .fetch_optional(pool)
    .await?;

    Ok(allowed.unwrap_or(false))
}

pub async fn record_failed_login(
    pool: &PgPool,
    email: &str,
    max_attempts: i32,
    lockout_minutes: i32,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE users
        SET failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
                WHEN failed_login_attempts + 1 >= $2
                THEN NOW() + ($3::int * interval '1 minute')
                ELSE locked_until
            END
        WHERE email = $1
        "#,
        email,
        max_attempts,
        lockout_minutes
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn reset_failed_login(pool: &PgPool, email: &str) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        UPDATE users
        SET failed_login_attempts = 0,
            locked_until = NULL
        WHERE email = $1
        "#,
        email
    )
    .execute(pool)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::DUMMY_PASSWORD_HASH;

    #[test]
    fn dummy_password_hash_is_valid_bcrypt() {
        assert!(bcrypt::verify("not-the-login-password", DUMMY_PASSWORD_HASH).is_ok());
    }
}
