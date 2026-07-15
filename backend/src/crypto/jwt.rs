use chrono::{DateTime, Duration, Utc};
use jsonwebtoken::{DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};

pub const ACCESS_TOKEN_DURATION: Duration = Duration::minutes(15);

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: usize,
    pub iat: usize,
}

pub fn generate_access_token_capped(
    user_id: &str,
    secret: &str,
    max_expires_at: DateTime<Utc>,
) -> Result<(String, i64), jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let exp = (now + ACCESS_TOKEN_DURATION).min(max_expires_at);

    generate_access_token_with_expiry(user_id, secret, now, exp)
}

fn generate_access_token_with_expiry(
    user_id: &str,
    secret: &str,
    now: DateTime<Utc>,
    exp: DateTime<Utc>,
) -> Result<(String, i64), jsonwebtoken::errors::Error> {
    let expires_in = (exp - now).num_seconds().max(0);

    let claims = Claims {
        sub: user_id.to_owned(),
        exp: exp.timestamp() as usize,
        iat: now.timestamp() as usize,
    };

    let token = encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )?;

    Ok((token, expires_in))
}

pub fn verify_access_token(
    token: &str,
    secret: &str,
) -> Result<Claims, jsonwebtoken::errors::Error> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}
