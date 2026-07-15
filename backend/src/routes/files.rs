use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};

use crate::handlers::files::{
    download_file, list_files, list_shared_files_with_me, permanent_delete_file, rename_file,
    restore_file, share_file, soft_delete_file, update_file_content, update_file_note, upload_file,
};
use crate::state::AppState;

pub fn files_routes() -> Router<AppState> {
    Router::new()
        .route("/files", get(list_files).post(upload_file))
        .route("/files/shared-with-me", get(list_shared_files_with_me))
        .route("/files/{id}/download", get(download_file))
        .route("/files/{id}/content", put(update_file_content))
        .route("/files/{id}/note", put(update_file_note))
        .route("/files/{id}/share", put(share_file))
        .route("/files/{id}/permanent", delete(permanent_delete_file))
        .route("/files/{id}", delete(soft_delete_file).patch(rename_file))
        .route("/files/{id}/restore", post(restore_file))
        .layer(DefaultBodyLimit::disable())
}
