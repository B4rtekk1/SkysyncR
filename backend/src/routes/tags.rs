use axum::Router;
use axum::routing::{get, put};

use crate::handlers::tags::{
    add_tag_to_file, create_tag, delete_tag, list_tags, list_tags_for_file, remove_tag_from_file,
    update_tag,
};
use crate::state::AppState;

pub fn tags_routes() -> Router<AppState> {
    Router::new()
        .route("/tags", get(list_tags).post(create_tag))
        .route("/tags/{id}", put(update_tag).delete(delete_tag))
        .route("/files/{id}/tags", get(list_tags_for_file))
        .route(
            "/files/{file_id}/tags/{tag_id}",
            put(add_tag_to_file).delete(remove_tag_from_file),
        )
}
