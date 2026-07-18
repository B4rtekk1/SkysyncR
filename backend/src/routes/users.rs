use crate::handlers::users::{
    change_password, current_user, login_user, logout_all_sessions, logout_user, refresh_tokens,
    register_user, update_user_settings, verify_email,
};
use crate::state::AppState;
use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{get, patch, post};

pub fn users_routes() -> Router<AppState> {
    Router::new()
        .route("/users/me", get(current_user))
        .route("/users/settings", patch(update_user_settings))
        .route("/users/change-password", post(change_password))
        .route("/users/refresh", post(refresh_tokens))
        .route("/users/logout", post(logout_user))
        .route("/users/logout-all", post(logout_all_sessions))
        .route("/users/verify", post(verify_email))
        .layer(DefaultBodyLimit::max(4 * 1024 * 1024))
}

pub fn auth_limited_routes() -> Router<AppState> {
    use crate::handlers::password_reset::{forgot_password, get_recovery_blob, reset_password};

    Router::new()
        .route("/users/register", post(register_user))
        .route("/users/login", post(login_user))
        .route("/users/forgot-password", post(forgot_password))
        .route("/users/recovery-blob", get(get_recovery_blob))
        .route("/users/reset-password", post(reset_password))
}
