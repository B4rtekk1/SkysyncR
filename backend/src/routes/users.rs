use axum::Router;
use axum::routing::post;
use crate::state::AppState;
use crate::handlers::users::register_user;

pub fn users_routes() -> Router<AppState> {
    Router::new()
        .route("/users/register", post(register_user))
}