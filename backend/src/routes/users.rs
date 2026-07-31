use crate::handlers::users::{
    change_password, confirm_totp, current_user, disable_totp, list_operation_log, list_sessions,
    login_totp, login_user, logout_all_sessions, logout_user, refresh_tokens, register_user,
    resend_verification_email, revoke_session, setup_totp, totp_status, update_session_trust,
    update_user_settings, verify_email,
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
        .route("/users/sessions", get(list_sessions))
        .route("/users/operation-log", get(list_operation_log))
        .route(
            "/users/totp",
            get(totp_status).post(setup_totp).delete(disable_totp),
        )
        .route("/users/totp/confirm", post(confirm_totp))
        .route(
            "/users/sessions/{session_id}",
            patch(update_session_trust).delete(revoke_session),
        )
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
        .route("/users/login/totp", post(login_totp))
        .route(
            "/users/resend-verification",
            post(resend_verification_email),
        )
        .route("/users/forgot-password", post(forgot_password))
        .route("/users/recovery-blob", get(get_recovery_blob))
        .route("/users/reset-password", post(reset_password))
}
