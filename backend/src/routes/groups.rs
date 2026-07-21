use axum::Router;
use axum::routing::{delete, get, patch, post};

use crate::handlers::groups::{
    accept_group_invite, create_group, create_group_invite, decline_group_invite, delete_group,
    delete_group_invite, delete_group_member, leave_group, list_group_recipients, list_groups,
    list_incoming_invites, update_group, update_group_member,
};
use crate::state::AppState;

pub fn groups_routes() -> Router<AppState> {
    Router::new()
        .route("/groups", get(list_groups).post(create_group))
        .route("/groups/invitations", get(list_incoming_invites))
        .route(
            "/groups/invitations/{invite_id}/accept",
            post(accept_group_invite),
        )
        .route(
            "/groups/invitations/{invite_id}/decline",
            post(decline_group_invite),
        )
        .route("/groups/{id}", patch(update_group).delete(delete_group))
        .route("/groups/{id}/membership", delete(leave_group))
        .route("/groups/{id}/recipients", get(list_group_recipients))
        .route("/groups/{id}/invites", post(create_group_invite))
        .route(
            "/groups/{group_id}/invites/{invite_id}",
            delete(delete_group_invite),
        )
        .route(
            "/groups/{group_id}/members/{member_user_id}",
            patch(update_group_member).delete(delete_group_member),
        )
}
