use sqlx::PgPool;
use uuid::Uuid;

pub async fn create_user(
    pool: &PgPool,
    email: &str,
    password_hash: &str,
    public_key: &str,
) -> Result<Uuid, sqlx::Error> {

    let user_id = sqlx::query!(
        r#"
        INSERT INTO users (email, password_hash, public_key)
        VALUES ($1, $2, $3)
        RETURNING id
        "#,
        email,
        password_hash,
        public_key
    )
    .fetch_one(pool)
    .await?
    .id;

    Ok(user_id)
}