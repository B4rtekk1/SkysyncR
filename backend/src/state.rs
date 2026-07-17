use sqlx::PgPool;
use std::path::PathBuf;

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
    pub upload_dir: PathBuf,
    pub max_file_size_bytes: u64,
    pub max_concurrent_file_transfers: usize,
    pub file_transfer_timeout_seconds: u64,
    pub trash_retention_days: i64,
    pub trash_purge_interval_hours: u64,
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

        let upload_dir = std::env::var("UPLOAD_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("uploads"));

        let max_file_size_bytes = std::env::var("MAX_FILE_SIZE_BYTES")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1_073_741_824);

        let max_concurrent_file_transfers = std::env::var("MAX_CONCURRENT_FILE_TRANSFERS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|limit| *limit >= 1)
            .unwrap_or(4);

        let file_transfer_timeout_seconds = std::env::var("FILE_TRANSFER_TIMEOUT_SECONDS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|seconds| *seconds >= 1)
            .unwrap_or(900);

        let trash_retention_days = std::env::var("TRASH_RETENTION_DAYS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|days| (1..=365).contains(days))
            .unwrap_or(30);

        let trash_purge_interval_hours = std::env::var("TRASH_PURGE_INTERVAL_HOURS")
            .ok()
            .and_then(|v| v.parse().ok())
            .filter(|hours| *hours >= 1)
            .unwrap_or(24);

        let is_dev = std::env::var("APP_ENV")
            .map(|v| v == "development" || v == "dev")
            .unwrap_or(true);

        Self {
            jwt_secret: std::env::var("JWT_SECRET").expect("JWT_SECRET must be set"),
            max_failed_login_attempts,
            lockout_duration_minutes,
            verification_token_ttl_hours,
            upload_dir,
            max_file_size_bytes,
            max_concurrent_file_transfers,
            file_transfer_timeout_seconds,
            trash_retention_days,
            trash_purge_interval_hours,
            is_dev,
        }
    }
}
