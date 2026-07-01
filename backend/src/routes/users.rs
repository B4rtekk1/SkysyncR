use axum::Router;
use axum::routing::{get,post};
use crate::db::users::verify_email_token;
use crate::state::AppState;
use crate::handlers::users::{login_user, register_user, verify_email};

pub fn users_routes() -> Router<AppState> {
    Router::new()
        .route("/users/register", post(register_user))
        .route("/users/login", post(login_user))
        .route("/users/verify", get(verify_email))
}