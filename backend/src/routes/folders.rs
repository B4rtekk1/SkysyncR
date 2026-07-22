use axum::Router;
use axum::routing::{delete, get, patch, post, put};

use crate::handlers::folders::{
    add_folder_favourite, create_folder, list_folders, move_folder, permanent_delete_folder,
    remove_folder_favourite, rename_folder, restore_folder, share_folder, soft_delete_folder,
};
use crate::state::AppState;

pub fn folders_routes() -> Router<AppState> {
    Router::new()
        .route("/folders", get(list_folders).post(create_folder))
        .route(
            "/folders/{id}",
            patch(rename_folder).delete(soft_delete_folder),
        )
        .route("/folders/{id}/move", put(move_folder))
        .route("/folders/{id}/share", put(share_folder))
        .route("/folders/{id}/restore", post(restore_folder))
        .route("/folders/{id}/permanent", delete(permanent_delete_folder))
        .route(
            "/folders/{id}/favorite",
            put(add_folder_favourite).delete(remove_folder_favourite),
        )
}
