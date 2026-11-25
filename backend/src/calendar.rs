use axum::{Json, extract::State};
use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    state::{AppState, parse_day},
};

const MAX_RANGE_DAYS: i64 = 1500;

#[derive(Debug, Serialize, Deserialize)]
pub struct CalendarView {
    #[serde(rename = "from")]
    pub from_day: String,
    #[serde(rename = "to")]
    pub to_day: String,
    pub focus: String,
}

#[derive(sqlx::FromRow)]
struct CalendarRow {
    from_day: NaiveDate,
    to_day: NaiveDate,
    focus_day: NaiveDate,
}

impl From<CalendarRow> for CalendarView {
    fn from(row: CalendarRow) -> Self {
        Self {
            from_day: row.from_day.format("%Y-%m-%d").to_string(),
            to_day: row.to_day.format("%Y-%m-%d").to_string(),
            focus: row.focus_day.format("%Y-%m-%d").to_string(),
        }
    }
}

pub async fn get(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
) -> AppResult<Json<Option<CalendarView>>> {
    let row = sqlx::query_as::<_, CalendarRow>(
        "SELECT from_day, to_day, focus_day FROM calendar_view WHERE id = 1",
    )
    .fetch_optional(&state.db)
    .await?;
    Ok(Json(row.map(CalendarView::from)))
}

pub async fn put(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Json(body): Json<CalendarView>,
) -> AppResult<Json<CalendarView>> {
    let from = parse_day(&body.from_day)?;
    let to = parse_day(&body.to_day)?;
    let mut focus = parse_day(&body.focus)?;
    if to < from || (to - from).num_days() > MAX_RANGE_DAYS {
        return Err(AppError::BadRequest("invalid date range".into()));
    }
    if focus < from {
        focus = from;
    } else if focus > to {
        focus = to;
    }

    let row = sqlx::query_as::<_, CalendarRow>(
        "INSERT INTO calendar_view (id, from_day, to_day, focus_day)
         VALUES (1, $1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET
            from_day = EXCLUDED.from_day,
            to_day = EXCLUDED.to_day,
            focus_day = EXCLUDED.focus_day,
            updated_at = now()
         RETURNING from_day, to_day, focus_day",
    )
    .bind(from)
    .bind(to)
    .bind(focus)
    .fetch_one(&state.db)
    .await?;
    Ok(Json(CalendarView::from(row)))
}
