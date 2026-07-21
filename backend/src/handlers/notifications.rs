use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::notifications::{
    NotificationRecord, create_due_reminder_notifications, delete_notification,
    list_user_notifications, mark_all_notifications_read, mark_notification_read,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct ListNotificationsQuery {
    #[serde(default)]
    pub unread_only: bool,
    pub limit: Option<i64>,
}

pub async fn list_notifications(
    State(state): State<AppState>,
    auth: AuthUser,
    Query(query): Query<ListNotificationsQuery>,
) -> Result<Json<Vec<NotificationRecord>>, ApiError> {
    let limit = query.limit.unwrap_or(100).clamp(1, 500);
    let notifications =
        list_user_notifications(&state.db_pool, auth.user_id, query.unread_only, limit)
            .await
            .map_err(|e| internal_error("list notifications", e))?;

    Ok(Json(notifications))
}

pub async fn mark_read(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(notification_id): Path<Uuid>,
) -> Result<Json<NotificationRecord>, ApiError> {
    let notification = mark_notification_read(&state.db_pool, auth.user_id, notification_id)
        .await
        .map_err(|e| internal_error("mark notification read", e))?
        .ok_or_else(|| ApiError::BadRequest("Notification not found".into()))?;

    Ok(Json(notification))
}

pub async fn mark_all_read(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<StatusCode, ApiError> {
    mark_all_notifications_read(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("mark notifications read", e))?;

    Ok(StatusCode::NO_CONTENT)
}

pub async fn delete_one(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(notification_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_notification(&state.db_pool, auth.user_id, notification_id)
        .await
        .map_err(|e| internal_error("delete notification", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Notification not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn create_due_reminders(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<NotificationRecord>>, ApiError> {
    let notifications = create_due_reminder_notifications(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("create reminder notifications", e))?;

    Ok(Json(notifications))
}
