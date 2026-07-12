use chrono::{Duration, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};

pub const REFRESH_SESSION_DURATION: Duration = Duration::days(90);
pub const REFRESH_TOKEN_DURATION: Duration = REFRESH_SESSION_DURATION;

pub fn generate_refresh_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    hex::encode(bytes)
}

pub fn hash_refresh_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn refresh_session_expires_at() -> chrono::DateTime<Utc> {
    Utc::now() + REFRESH_SESSION_DURATION
}

pub fn refresh_token_expires_at(
    session_expires_at: chrono::DateTime<Utc>,
) -> chrono::DateTime<Utc> {
    let rolling_expires_at = Utc::now() + REFRESH_TOKEN_DURATION;
    rolling_expires_at.min(session_expires_at)
}
