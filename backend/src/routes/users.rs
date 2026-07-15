use crate::handlers::users::{
    current_user, login_user, logout_all_sessions, logout_user, refresh_tokens, register_user,
    update_user_settings, verify_email,
};
use crate::state::AppState;
use axum::Router;
use axum::routing::{get, patch, post};

pub fn users_routes() -> Router<AppState> {
    Router::new()
        .route("/users/me", get(current_user))
        .route("/users/settings", patch(update_user_settings))
        .route("/users/refresh", post(refresh_tokens))
        .route("/users/logout", post(logout_user))
        .route("/users/logout-all", post(logout_all_sessions))
        .route("/users/verify", get(verify_email))
}

pub fn auth_limited_routes() -> Router<AppState> {
    Router::new()
        .route("/users/register", post(register_user))
        .route("/users/login", post(login_user))
}
