use axum::Router;
use axum::routing::{get, patch, put};

use crate::handlers::folders::{
    add_folder_favourite, create_folder, list_folders, remove_folder_favourite, rename_folder,
    share_folder,
};
use crate::state::AppState;

pub fn folders_routes() -> Router<AppState> {
    Router::new()
        .route("/folders", get(list_folders).post(create_folder))
        .route("/folders/{id}", patch(rename_folder))
        .route("/folders/{id}/share", put(share_folder))
        .route(
            "/folders/{id}/favorite",
            put(add_folder_favourite).delete(remove_folder_favourite),
        )
}
