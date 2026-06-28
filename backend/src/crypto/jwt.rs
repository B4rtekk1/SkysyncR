use serde::{Serialize, Deserialize};
use jsonwebtoken::{encode, decode, EncodingKey, DecodingKey, Validation, Header};
use chrono::{Utc, Duration};

#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    sub: String, //user id
    exp: usize, // expiration time
    iat: usize, // issued at time
}

pub fn generate_jwt(user_id: &str, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let now = Utc::now();
    let exp = now + Duration::hours(24); // Token valid for 24 hours

    let claims = Claims {
        sub: user_id.to_owned(),
        exp: exp.timestamp() as usize,
        iat: now.timestamp() as usize,
    };

    let token = encode(
        &Header::default(), // HS256 is the default algorithm
        &claims,
        &EncodingKey::from_secret(secret.as_ref()),
    )?;
    Ok(token)
}

fn verify_jwt(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_ref()),
        &Validation::default(),
    )?;
    Ok(token_data.claims)
}