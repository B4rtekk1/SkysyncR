use axum::Router;
use axum::routing::{delete, get, post, put};

use crate::handlers::notifications::{
    create_due_reminders, delete_one, list_notifications, mark_all_read, mark_read,
};
use crate::state::AppState;

pub fn notifications_routes() -> Router<AppState> {
    Router::new()
        .route("/notifications", get(list_notifications))
        .route("/notifications/read-all", put(mark_all_read))
        .route("/notifications/reminders/due", post(create_due_reminders))
        .route("/notifications/{id}", delete(delete_one))
        .route("/notifications/{id}/read", put(mark_read))
}
