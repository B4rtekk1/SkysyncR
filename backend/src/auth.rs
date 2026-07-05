use axum::extract::FromRequestParts;
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use uuid::Uuid;

use crate::crypto::jwt::verify_access_token;
use crate::state::AppState;
use crate::utils::device::DeviceContext;
use crate::utils::errors::ApiError;

pub struct AuthUser {
    pub user_id: Uuid,
    pub device_id: String,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| ApiError::Unauthorized("Missing authorization header".into()))?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::Unauthorized("Invalid authorization header".into()))?;

        let claims = verify_access_token(token, &state.config.jwt_secret)
            .map_err(|_| ApiError::Unauthorized("Invalid or expired token".into()))?;

        let user_id = Uuid::parse_str(&claims.sub)
            .map_err(|_| ApiError::Unauthorized("Invalid token subject".into()))?;

        let device = DeviceContext::from_headers(&parts.headers, None)?;

        if device.device_id != claims.did {
            return Err(ApiError::Unauthorized("Session device mismatch".into()));
        }

        Ok(Self {
            user_id,
            device_id: device.device_id,
        })
    }
}
