use axum::Router;
use axum::routing::post;
use crate::state::AppState;
use crate::handlers::auth::register_user;

pub fn users_routes() -> Router<AppState> {
    Router::new()
        .route("/register_user", post(register_user))
}