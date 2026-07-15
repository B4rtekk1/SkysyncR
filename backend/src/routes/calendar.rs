use axum::Router;
use axum::routing::{get, put};

use crate::handlers::calendar::{create_entry, delete_entry, list_entries, update_entry};
use crate::state::AppState;

pub fn calendar_routes() -> Router<AppState> {
    Router::new()
        .route("/calendar-entries", get(list_entries).post(create_entry))
        .route(
            "/calendar-entries/{id}",
            put(update_entry).delete(delete_entry),
        )
}
