use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use chrono::NaiveDate;
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::Cell,
    state::{AppState, Event, client_id, parse_day},
};

const MAX_RANGE_DAYS: i64 = 1500;
const MAX_BATCH: usize = 50_000;

#[derive(Deserialize)]
pub struct RangeQuery {
    from: String,
    to: String,
}

pub async fn list(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Query(q): Query<RangeQuery>,
) -> AppResult<Json<Vec<Cell>>> {
    let from = parse_day(&q.from)?;
    let to = parse_day(&q.to)?;
    if to < from || (to - from).num_days() > MAX_RANGE_DAYS {
        return Err(AppError::BadRequest("invalid date range".into()));
    }
    let cells = sqlx::query_as::<_, Cell>(
        "SELECT row_id, day, value, bg FROM cells WHERE day BETWEEN $1 AND $2",
    )
    .bind(from)
    .bind(to)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(cells))
}

#[derive(Deserialize)]
pub struct PutCells {
    cells: Vec<Cell>,
}

/// Пакетная запись ячеек. Пустая ячейка без заливки удаляется.
pub async fn put(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    Json(req): Json<PutCells>,
) -> AppResult<Json<Value>> {
    if req.cells.len() > MAX_BATCH {
        return Err(AppError::BadRequest("too many cells in one batch".into()));
    }

    let mut upsert_rows: Vec<Uuid> = Vec::new();
    let mut upsert_days: Vec<NaiveDate> = Vec::new();
    let mut upsert_values: Vec<String> = Vec::new();
    let mut upsert_bgs: Vec<Option<String>> = Vec::new();
    let mut delete_rows: Vec<Uuid> = Vec::new();
    let mut delete_days: Vec<NaiveDate> = Vec::new();
    let mut normalized = Vec::with_capacity(req.cells.len());

    for mut c in req.cells {
        c.bg = c.bg.filter(|b| !b.is_empty());
        if c.value.is_empty() && c.bg.is_none() {
            delete_rows.push(c.row_id);
            delete_days.push(c.day);
        } else {
            upsert_rows.push(c.row_id);
            upsert_days.push(c.day);
            upsert_values.push(c.value.clone());
            upsert_bgs.push(c.bg.clone());
        }
        normalized.push(c);
    }

    let mut tx = state.db.begin().await?;
    if !delete_rows.is_empty() {
        sqlx::query(
            "DELETE FROM cells c
             USING UNNEST($1::uuid[], $2::date[]) AS d(row_id, day)
             WHERE c.row_id = d.row_id AND c.day = d.day",
        )
        .bind(&delete_rows)
        .bind(&delete_days)
        .execute(&mut *tx)
        .await?;
    }
    if !upsert_rows.is_empty() {
        sqlx::query(
            "INSERT INTO cells (row_id, day, value, bg, updated_by, updated_at)
             SELECT d.row_id, d.day, d.value, d.bg, $5, now()
             FROM UNNEST($1::uuid[], $2::date[], $3::text[], $4::text[]) AS d(row_id, day, value, bg)
             WHERE EXISTS (SELECT 1 FROM schedule_rows r WHERE r.id = d.row_id)
             ON CONFLICT (row_id, day) DO UPDATE SET
                value = EXCLUDED.value,
                bg = EXCLUDED.bg,
                updated_by = EXCLUDED.updated_by,
                updated_at = EXCLUDED.updated_at",
        )
        .bind(&upsert_rows)
        .bind(&upsert_days)
        .bind(&upsert_values)
        .bind(&upsert_bgs)
        .bind(user.id)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    let count = normalized.len();
    if count > 0 {
        state.publish(Event::Cells {
            by: user.id,
            client: client_id(&headers),
            cells: normalized,
        });
    }
    Ok(Json(json!({ "ok": true, "count": count })))
}
