use sqlx::PgPool;

#[derive(Clone)]
pub struct AppState {
    pub db_pool: PgPool,
    pub config: AppConfig,
}

#[derive(Clone)]
pub struct AppConfig {
    pub jwt_secret: String,
    pub max_failed_login_attempts: i32,
    pub lockout_duration_minutes: i32,
    pub verification_token_ttl_hours: i64,
    pub is_dev: bool,
}

impl AppConfig {
    pub fn from_env() -> Self {
        let max_failed_login_attempts = std::env::var("MAX_FAILED_LOGIN_ATTEMPTS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5);

        let lockout_duration_minutes = std::env::var("LOCKOUT_DURATION_MINUTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(15);

        let verification_token_ttl_hours = std::env::var("VERIFICATION_TOKEN_TTL_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(24);

        let is_dev = std::env::var("APP_ENV")
            .map(|v| v == "development" || v == "dev")
            .unwrap_or(true);

        Self {
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
            max_failed_login_attempts,
            lockout_duration_minutes,
            verification_token_ttl_hours,
            is_dev,
        }
    }
}
