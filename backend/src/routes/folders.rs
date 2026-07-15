use axum::Router;
use axum::routing::{get, patch, put};

use crate::handlers::folders::{create_folder, list_folders, rename_folder, share_folder};
use crate::state::AppState;

pub fn folders_routes() -> Router<AppState> {
    Router::new()
        .route("/folders", get(list_folders).post(create_folder))
        .route("/folders/{id}", patch(rename_folder))
        .route("/folders/{id}/share", put(share_folder))
}
