use axum::http::StatusCode;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn create_user(
    pool: &PgPool,
    email: &str,
    visible_name: &str,
    password_hash: &str,
    public_key: &str,
) -> Result<Uuid, sqlx::Error> {
    let user_id = sqlx::query!(
        r#"
        INSERT INTO users (email, password_hash, public_key, display_name)
        VALUES ($1, $2, $3, $4)
        RETURNING id
        "#,
        email,
        password_hash,
        public_key,
        visible_name
    )
    .fetch_one(pool)
    .await?
    .id;

    Ok(user_id)
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
}
