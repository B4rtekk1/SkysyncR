use crate::crypto::email::generate_verification_token;
use sqlx::PgPool;
use uuid::Uuid;

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
        token,
        verification_ttl_hours as i32
    )
    .fetch_one(pool)
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
    .execute(pool)
    .await?;

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

    let fake_hash = "$2b$12$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    let hash = user
        .map(|u| u.password_hash)
        .unwrap_or(fake_hash.to_string());

    let is_valid = bcrypt::verify(password, &hash).unwrap_or(false);
    Ok(is_valid)
}

pub async fn verify_email_token(pool: &PgPool, token: &str) -> Result<bool, sqlx::Error> {
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
        token
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
    let result = sqlx::query!(
        r#"SELECT id FROM users WHERE email = $1"#,
        email
    )
    .fetch_optional(pool)
    .await?;

    Ok(result.map(|r| r.id))
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
