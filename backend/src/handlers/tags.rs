use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::tags::{
    FileTagRecord, NewTag, TagRecord, add_file_tag, create_user_tag, delete_user_tag,
    list_file_tags, list_user_tags, remove_file_tag, update_user_tag,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct TagRequest {
    pub name: String,
    pub color: Option<String>,
}

pub async fn list_tags(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<TagRecord>>, ApiError> {
    let tags = list_user_tags(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("list tags", e))?;

    Ok(Json(tags))
}

pub async fn create_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<TagRequest>,
) -> Result<(StatusCode, Json<TagRecord>), ApiError> {
    let name = normalize_tag_name(&payload.name)?;
    let color = normalize_tag_color(payload.color.as_deref())?;

    let tag = create_user_tag(
        &state.db_pool,
        NewTag {
            owner_id: auth.user_id,
            name,
            color,
        },
    )
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db_err) = &e
            && db_err.code().as_deref() == Some("23505")
        {
            return ApiError::Conflict("Tag already exists".into());
        }
        internal_error("create tag", e)
    })?;

    Ok((StatusCode::CREATED, Json(tag)))
}

pub async fn update_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(tag_id): Path<Uuid>,
    Json(payload): Json<TagRequest>,
) -> Result<Json<TagRecord>, ApiError> {
    let name = normalize_tag_name(&payload.name)?;
    let color = normalize_tag_color(payload.color.as_deref())?;

    let tag = update_user_tag(&state.db_pool, auth.user_id, tag_id, name, color)
        .await
        .map_err(|e| {
            if let sqlx::Error::Database(db_err) = &e
                && db_err.code().as_deref() == Some("23505")
            {
                return ApiError::Conflict("Tag already exists".into());
            }
            internal_error("update tag", e)
        })?
        .ok_or_else(|| ApiError::BadRequest("Tag not found".into()))?;

    Ok(Json(tag))
}

pub async fn delete_tag(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(tag_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_user_tag(&state.db_pool, auth.user_id, tag_id)
        .await
        .map_err(|e| internal_error("delete tag", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Tag not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_tags_for_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(file_id): Path<Uuid>,
) -> Result<Json<Vec<FileTagRecord>>, ApiError> {
    let tags = list_file_tags(&state.db_pool, auth.user_id, file_id)
        .await
        .map_err(|e| internal_error("list file tags", e))?;

    Ok(Json(tags))
}

pub async fn add_tag_to_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((file_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<FileTagRecord>, ApiError> {
    let tag = add_file_tag(&state.db_pool, auth.user_id, file_id, tag_id)
        .await
        .map_err(|e| internal_error("add file tag", e))?
        .ok_or_else(|| ApiError::BadRequest("File or tag not found".into()))?;

    Ok(Json(tag))
}

pub async fn remove_tag_from_file(
    State(state): State<AppState>,
    auth: AuthUser,
    Path((file_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    let rows = remove_file_tag(&state.db_pool, auth.user_id, file_id, tag_id)
        .await
        .map_err(|e| internal_error("remove file tag", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("File tag not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

fn normalize_tag_name(value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest("Missing tag name".into()));
    }
    if trimmed.len() > 80 {
        return Err(ApiError::BadRequest("Tag name is too large".into()));
    }

    Ok(trimmed.to_string())
}

fn normalize_tag_color(value: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.len() > 32 {
        return Err(ApiError::BadRequest("Tag color is too large".into()));
    }
    if !trimmed.chars().all(|ch| {
        ch.is_ascii_alphanumeric() || matches!(ch, '#' | '-' | '_' | '(' | ')' | ',' | '.')
    }) {
        return Err(ApiError::BadRequest("Invalid tag color".into()));
    }

    Ok(Some(trimmed.to_string()))
}
