use axum::Router;
use axum::routing::{delete, get, patch, post};

use crate::handlers::groups::{
    create_group, create_group_invite, delete_group, delete_group_invite, list_group_recipients,
    list_groups, update_group,
};
use crate::state::AppState;

pub fn groups_routes() -> Router<AppState> {
    Router::new()
        .route("/groups", get(list_groups).post(create_group))
        .route("/groups/{id}", patch(update_group).delete(delete_group))
        .route("/groups/{id}/recipients", get(list_group_recipients))
        .route("/groups/{id}/invites", post(create_group_invite))
        .route(
            "/groups/{group_id}/invites/{invite_id}",
            delete(delete_group_invite),
        )
}
