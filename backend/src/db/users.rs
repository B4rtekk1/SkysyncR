use sqlx::PgPool;
use uuid::Uuid;
use bcrypt::{hash, };

pub async fn create_user(
    pool: &PgPool,
    email: &str,
    password: &str,
) -> Result<Uuid, sqlx::Error> {
    let hashed_password = hash(password, 4).expect("Failed to hash password");
    
    let user_id = sqlx::query!(
        r#"
        INSERT INTO users (email, password_hash)
        VALUES ($1, $2)
        RETURNING id
        "#,
        email,
        hashed_password
    )
    .fetch_one(pool)
    .await?
    .id;

    Ok(user_id)
}