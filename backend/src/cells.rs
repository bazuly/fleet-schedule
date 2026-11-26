use axum::{
    Json,
    extract::{Query, State},
    http::HeaderMap,
};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Postgres;
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{Cell, User},
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
        "SELECT c.row_id, c.day, c.value, c.bg, c.fg, c.comment, c.sent, c.span,
                c.updated_by,
                COALESCE(NULLIF(btrim(u.name), ''), u.login) AS updated_by_name,
                c.updated_at
         FROM cells c
         LEFT JOIN users u ON u.id = c.updated_by
         WHERE c.day BETWEEN $1 AND $2",
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

/// Пакетная запись ячеек. Пустая ячейка шириной в один день удаляется.
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
    let mut upsert_fgs: Vec<Option<String>> = Vec::new();
    let mut upsert_comments: Vec<String> = Vec::new();
    let mut upsert_sents: Vec<bool> = Vec::new();
    let mut upsert_spans: Vec<i32> = Vec::new();
    let mut delete_rows: Vec<Uuid> = Vec::new();
    let mut delete_days: Vec<NaiveDate> = Vec::new();
    let mut normalized = Vec::with_capacity(req.cells.len());

    for mut c in req.cells {
        c.bg = c.bg.filter(|b| !b.is_empty());
        c.fg = c.fg.filter(|b| !b.is_empty());
        c.comment = c.comment.trim().chars().take(4000).collect();
        c.span = c.span.clamp(1, 62);
        if c.value.is_empty() && c.bg.is_none() && c.fg.is_none() && c.comment.is_empty() && !c.sent && c.span <= 1 {
            delete_rows.push(c.row_id);
            delete_days.push(c.day);
        } else {
            upsert_rows.push(c.row_id);
            upsert_days.push(c.day);
            upsert_values.push(c.value.clone());
            upsert_bgs.push(c.bg.clone());
            upsert_fgs.push(c.fg.clone());
            upsert_comments.push(c.comment.clone());
            upsert_sents.push(c.sent);
            upsert_spans.push(c.span);
        }
        normalized.push(c);
    }

    let changed_at = Utc::now();
    let user_name = display_name(&user);
    let mut tx = state.db.begin().await?;
    record_history(
        &mut tx,
        &delete_rows,
        &delete_days,
        &upsert_rows,
        &upsert_days,
        &upsert_values,
        &upsert_bgs,
        &upsert_fgs,
        &upsert_comments,
        &upsert_sents,
        &upsert_spans,
        user.id,
        &user_name,
        changed_at,
    )
    .await?;
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
            "INSERT INTO cells (row_id, day, value, bg, fg, comment, span, sent, updated_by, updated_at)
             SELECT d.row_id, d.day, d.value, d.bg, d.fg, d.comment, d.span, d.sent, $9, $10
             FROM UNNEST($1::uuid[], $2::date[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::bool[])
                AS d(row_id, day, value, bg, fg, comment, span, sent)
             WHERE EXISTS (SELECT 1 FROM schedule_rows r WHERE r.id = d.row_id)
             ON CONFLICT (row_id, day) DO UPDATE SET
                value = EXCLUDED.value,
                bg = EXCLUDED.bg,
                fg = EXCLUDED.fg,
                comment = EXCLUDED.comment,
                span = EXCLUDED.span,
                sent = EXCLUDED.sent,
                updated_by = EXCLUDED.updated_by,
                updated_at = EXCLUDED.updated_at",
        )
        .bind(&upsert_rows)
        .bind(&upsert_days)
        .bind(&upsert_values)
        .bind(&upsert_bgs)
        .bind(&upsert_fgs)
        .bind(&upsert_comments)
        .bind(&upsert_spans)
        .bind(&upsert_sents)
        .bind(user.id)
        .bind(changed_at)
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;

    for cell in &mut normalized {
        if cell_is_blank(cell) {
            continue;
        }
        cell.updated_by = Some(user.id);
        cell.updated_by_name = Some(user_name.clone());
        cell.updated_at = Some(changed_at);
    }

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

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct CellChange {
    pub id: i64,
    pub user_name: String,
    pub changed_at: DateTime<Utc>,
    pub value: String,
    pub comment: String,
    pub bg: Option<String>,
    pub fg: Option<String>,
    pub span: i32,
    pub sent: bool,
    pub deleted: bool,
}

#[derive(Deserialize)]
pub struct HistoryQuery {
    row_id: Uuid,
    day: String,
}

/// Последние правки одной клетки, новые сверху.
pub async fn history(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Query(q): Query<HistoryQuery>,
) -> AppResult<Json<Vec<CellChange>>> {
    let day = parse_day(&q.day)?;
    let changes = sqlx::query_as::<_, CellChange>(
        "SELECT id, user_name, changed_at, value, comment, bg, fg, span, sent, deleted
         FROM cell_changes
         WHERE row_id = $1 AND day = $2
         ORDER BY changed_at DESC, id DESC
         LIMIT 50",
    )
    .bind(q.row_id)
    .bind(day)
    .fetch_all(&state.db)
    .await?;
    Ok(Json(changes))
}

fn display_name(user: &User) -> String {
    let name = user.name.trim();
    if name.is_empty() { user.login.clone() } else { name.to_string() }
}

fn cell_is_blank(cell: &Cell) -> bool {
    cell.span <= 1
        && cell.value.is_empty()
        && cell.bg.is_none()
        && cell.fg.is_none()
        && cell.comment.is_empty()
        && !cell.sent
}

#[allow(clippy::too_many_arguments)]
async fn record_history(
    tx: &mut sqlx::Transaction<'_, Postgres>,
    delete_rows: &[Uuid],
    delete_days: &[NaiveDate],
    upsert_rows: &[Uuid],
    upsert_days: &[NaiveDate],
    upsert_values: &[String],
    upsert_bgs: &[Option<String>],
    upsert_fgs: &[Option<String>],
    upsert_comments: &[String],
    upsert_sents: &[bool],
    upsert_spans: &[i32],
    user_id: Uuid,
    user_name: &str,
    changed_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    if !delete_rows.is_empty() {
        sqlx::query(
            "INSERT INTO cell_changes
                (row_id, day, user_id, user_name, changed_at, value, comment, bg, fg, span, sent, deleted)
             SELECT c.row_id, c.day, $3, $4, $5, c.value, c.comment, c.bg, c.fg, c.span, c.sent, true
             FROM cells c
             JOIN UNNEST($1::uuid[], $2::date[]) AS d(row_id, day)
               ON c.row_id = d.row_id AND c.day = d.day",
        )
        .bind(delete_rows)
        .bind(delete_days)
        .bind(user_id)
        .bind(user_name)
        .bind(changed_at)
        .execute(&mut **tx)
        .await?;
    }
    if !upsert_rows.is_empty() {
        sqlx::query(
            "INSERT INTO cell_changes
                (row_id, day, user_id, user_name, changed_at, value, comment, bg, fg, span, sent, deleted)
             SELECT d.row_id, d.day, $9, $10, $11, d.value, d.comment, d.bg, d.fg, d.span, d.sent, false
             FROM UNNEST($1::uuid[], $2::date[], $3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::bool[])
                AS d(row_id, day, value, bg, fg, comment, span, sent)
             LEFT JOIN cells c ON c.row_id = d.row_id AND c.day = d.day
             WHERE EXISTS (SELECT 1 FROM schedule_rows r WHERE r.id = d.row_id)
               AND (c.row_id IS NULL
                OR c.value IS DISTINCT FROM d.value
                OR c.comment IS DISTINCT FROM d.comment
                OR c.bg IS DISTINCT FROM d.bg
                OR c.fg IS DISTINCT FROM d.fg
                OR c.span IS DISTINCT FROM d.span
                OR c.sent IS DISTINCT FROM d.sent)",
        )
        .bind(upsert_rows)
        .bind(upsert_days)
        .bind(upsert_values)
        .bind(upsert_bgs)
        .bind(upsert_fgs)
        .bind(upsert_comments)
        .bind(upsert_spans)
        .bind(upsert_sents)
        .bind(user_id)
        .bind(user_name)
        .bind(changed_at)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}
