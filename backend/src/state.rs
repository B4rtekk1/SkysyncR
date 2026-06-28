use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState<> {
    pub db_pool: PgPool,
    pub config: AppConfig
}

#[derive(Clone)]
pub struct AppConfig {
    pub jwt_secret: String,
}