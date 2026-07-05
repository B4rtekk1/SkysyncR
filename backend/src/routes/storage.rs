use axum::routing::get;
use axum::Router;

use crate::handlers::storage::get_quota;
use crate::state::AppState;

pub fn storage_routes() -> Router<AppState> {
    Router::new().route("/storage/quota", get(get_quota))
}
