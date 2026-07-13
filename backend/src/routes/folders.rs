use axum::Router;
use axum::routing::get;

use crate::handlers::folders::{create_folder, list_folders};
use crate::state::AppState;

pub fn folders_routes() -> Router<AppState> {
    Router::new().route("/folders", get(list_folders).post(create_folder))
}
