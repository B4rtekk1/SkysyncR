use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::{delete, get, post, put};
use std::time::Duration;
use tower::limit::ConcurrencyLimitLayer;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::timeout::TimeoutLayer;

use crate::handlers::files::{
    add_file_favourite, create_file_share, delete_file_share, download_file,
    get_file_share_recipient_profile, list_file_shares, list_files, list_shared_files_with_me,
    permanent_delete_file, remove_file_favourite, rename_file, restore_file, share_file,
    soft_delete_file, update_file_content, update_file_note, upload_file,
};
use crate::state::AppState;

pub fn files_routes(
    max_file_size_bytes: u64,
    max_concurrent_transfers: usize,
    transfer_timeout_seconds: u64,
) -> Router<AppState> {
    let request_limit = max_file_size_bytes.saturating_add(1024 * 1024);

    Router::new()
        .route("/files", get(list_files).post(upload_file))
        .route("/files/shared-with-me", get(list_shared_files_with_me))
        .route("/files/{id}/download", get(download_file))
        .route("/files/{id}/content", put(update_file_content))
        .route("/files/{id}/note", put(update_file_note))
        .route("/files/{id}/share", put(share_file))
        .route(
            "/files/{id}/shares/recipient",
            get(get_file_share_recipient_profile),
        )
        .route(
            "/files/{id}/shares",
            get(list_file_shares).post(create_file_share),
        )
        .route("/files/{id}/shares/{share_id}", delete(delete_file_share))
        .route(
            "/files/{id}/favorite",
            put(add_file_favourite).delete(remove_file_favourite),
        )
        .route("/files/{id}/permanent", delete(permanent_delete_file))
        .route("/files/{id}", delete(soft_delete_file).patch(rename_file))
        .route("/files/{id}/restore", post(restore_file))
        .layer(DefaultBodyLimit::max(request_limit as usize))
        .layer(RequestBodyLimitLayer::new(request_limit as usize))
        .layer(TimeoutLayer::with_status_code(
            axum::http::StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(transfer_timeout_seconds),
        ))
        .layer(ConcurrencyLimitLayer::new(max_concurrent_transfers))
}
