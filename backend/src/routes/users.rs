use axum::Router;
use axum::routing::{get, post};
use crate::state::AppState;
use crate::handlers::users::{
    login_user, logout_all_sessions, logout_user, refresh_tokens, register_user, verify_email,
};

pub fn users_routes() -> Router<AppState> {
    Router::new()
        .route("/users/register", post(register_user))
        .route("/users/login", post(login_user))
        .route("/users/refresh", post(refresh_tokens))
        .route("/users/logout", post(logout_user))
        .route("/users/logout-all", post(logout_all_sessions))
        .route("/users/verify", get(verify_email))
}
