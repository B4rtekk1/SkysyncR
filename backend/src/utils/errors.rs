use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use sqlx::Error as SqlxError;

#[derive(Debug)]
pub enum ApiError {
    BadRequest(String),
    Unauthorized(String),
    Forbidden(String),
    Conflict(String),
    TooManyRequests(String),
    Internal(String),
}

pub fn internal_error(context: &str, err: impl std::fmt::Display) -> ApiError {
    tracing::error!(context, error = %err, "internal error");
    ApiError::Internal("An internal error occurred".into())
}

pub fn map_db_error(context: &str, err: SqlxError) -> ApiError {
    if let SqlxError::Database(db_err) = &err {
        if db_err.code().as_deref() == Some("23505") {
            return ApiError::Conflict("Email already registered".into());
        }
    }
    internal_error(context, err)
}

#[derive(Serialize)]
struct ErrorBody {
    error: String,
    message: String,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            ApiError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
            ApiError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg),
            ApiError::TooManyRequests(msg) => (StatusCode::TOO_MANY_REQUESTS, msg),
            ApiError::Internal(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg),
        };

        let body = Json(ErrorBody {
            error: status.to_string(),
            message,
        });

        (status, body).into_response()
    }
}
