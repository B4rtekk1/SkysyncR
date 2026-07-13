use axum::Router;
use axum::routing::{get, put};

use crate::handlers::folders::{create_folder, list_folders, share_folder};
use crate::state::AppState;

pub fn folders_routes() -> Router<AppState> {
    Router::new()
        .route("/folders", get(list_folders).post(create_folder))
        .route("/folders/{id}/share", put(share_folder))
}
