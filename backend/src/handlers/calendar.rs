use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use chrono::{NaiveDate, NaiveTime};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::calendar::{
    CalendarEntryRecord, CalendarEntryUpdate, NewCalendarEntry, create_calendar_entry,
    delete_calendar_entry, file_belongs_to_user, list_calendar_entries, update_calendar_entry,
};
use crate::state::AppState;
use crate::utils::errors::{ApiError, internal_error};

#[derive(Deserialize)]
pub struct CalendarEntryRequest {
    pub kind: String,
    pub date: String,
    pub time: String,
    pub title: String,
    pub note: String,
    pub reminder: String,
    pub file_id: Option<Uuid>,
}

pub async fn list_entries(
    State(state): State<AppState>,
    auth: AuthUser,
) -> Result<Json<Vec<CalendarEntryRecord>>, ApiError> {
    let entries = list_calendar_entries(&state.db_pool, auth.user_id)
        .await
        .map_err(|e| internal_error("list calendar entries", e))?;

    Ok(Json(entries))
}

pub async fn create_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Json(payload): Json<CalendarEntryRequest>,
) -> Result<(StatusCode, Json<CalendarEntryRecord>), ApiError> {
    let entry = validate_entry(&state, auth.user_id, payload).await?;
    let created = create_calendar_entry(&state.db_pool, entry)
        .await
        .map_err(|e| internal_error("create calendar entry", e))?;

    Ok((StatusCode::CREATED, Json(created)))
}

pub async fn update_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(entry_id): Path<Uuid>,
    Json(payload): Json<CalendarEntryRequest>,
) -> Result<Json<CalendarEntryRecord>, ApiError> {
    let entry = validate_entry_update(&state, auth.user_id, payload).await?;
    let updated = update_calendar_entry(&state.db_pool, auth.user_id, entry_id, entry)
        .await
        .map_err(|e| internal_error("update calendar entry", e))?
        .ok_or_else(|| ApiError::BadRequest("Calendar entry not found".into()))?;

    Ok(Json(updated))
}

pub async fn delete_entry(
    State(state): State<AppState>,
    auth: AuthUser,
    Path(entry_id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let rows = delete_calendar_entry(&state.db_pool, auth.user_id, entry_id)
        .await
        .map_err(|e| internal_error("delete calendar entry", e))?;

    if rows == 0 {
        return Err(ApiError::BadRequest("Calendar entry not found".into()));
    }

    Ok(StatusCode::NO_CONTENT)
}

async fn validate_entry(
    state: &AppState,
    user_id: Uuid,
    payload: CalendarEntryRequest,
) -> Result<NewCalendarEntry, ApiError> {
    let validated = validate_entry_update(state, user_id, payload).await?;

    Ok(NewCalendarEntry {
        owner_id: user_id,
        kind: validated.kind,
        date: validated.date,
        time: validated.time,
        title: validated.title,
        note: validated.note,
        reminder: validated.reminder,
        file_id: validated.file_id,
    })
}

async fn validate_entry_update(
    state: &AppState,
    user_id: Uuid,
    payload: CalendarEntryRequest,
) -> Result<CalendarEntryUpdate, ApiError> {
    let kind = payload.kind.trim();
    if kind != "event" && kind != "deadline" {
        return Err(ApiError::BadRequest("Invalid calendar entry kind".into()));
    }

    let date = payload.date.trim();
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| ApiError::BadRequest("Invalid calendar entry date".into()))?;

    let time = payload.time.trim();
    NaiveTime::parse_from_str(time, "%H:%M")
        .or_else(|_| NaiveTime::parse_from_str(time, "%H:%M:%S"))
        .map_err(|_| ApiError::BadRequest("Invalid calendar entry time".into()))?;

    let title = normalize_text("title", &payload.title, 500)?;
    let note = normalize_text("note", &payload.note, 10_000)?;
    let reminder = normalize_text("reminder", &payload.reminder, 40)?;

    if let Some(file_id) = payload.file_id {
        let exists = file_belongs_to_user(&state.db_pool, user_id, file_id)
            .await
            .map_err(|e| internal_error("check calendar linked file", e))?;
        if !exists {
            return Err(ApiError::BadRequest("Linked file not found".into()));
        }
    }

    Ok(CalendarEntryUpdate {
        kind: kind.to_string(),
        date: date.to_string(),
        time: time.to_string(),
        title,
        note,
        reminder,
        file_id: payload.file_id,
    })
}

fn normalize_text(field: &str, value: &str, max_len: usize) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if field == "title" && trimmed.is_empty() {
        return Err(ApiError::BadRequest("Missing calendar entry title".into()));
    }
    if trimmed.len() > max_len {
        return Err(ApiError::BadRequest(format!(
            "Calendar entry {field} is too large"
        )));
    }

    Ok(trimmed.to_string())
}
