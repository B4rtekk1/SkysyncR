use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post};

use crate::handlers::files::{
    download_file, list_files, list_shared_files_with_me, restore_file, soft_delete_file,
    upload_file,
};
use crate::state::AppState;

pub fn files_routes() -> Router<AppState> {
    Router::new()
        .route("/files", get(list_files).post(upload_file))
        .route("/files/shared-with-me", get(list_shared_files_with_me))
        .route("/files/{id}/download", get(download_file))
        .route("/files/{id}", delete(soft_delete_file))
        .route("/files/{id}/restore", post(restore_file))
        .layer(DefaultBodyLimit::disable())
}
