use axum::{
    Json,
    extract::{Path, State},
    http::HeaderMap,
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::AuthUser,
    error::{AppError, AppResult},
    models::{PANELS, Row},
    state::{AppState, Event, client_id},
};

pub async fn list(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
) -> AppResult<Json<Vec<Row>>> {
    let rows = sqlx::query_as::<_, Row>(
        "SELECT id, panel, position, driver, tractor, trailer, note, status
         FROM schedule_rows ORDER BY panel, position",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(rows))
}

#[derive(Deserialize)]
pub struct CreateRow {
    panel: String,
    /// Если не задана — строка добавляется в конец панели.
    position: Option<f64>,
    #[serde(default)]
    driver: String,
    #[serde(default)]
    tractor: String,
    #[serde(default)]
    trailer: String,
}

pub async fn create(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    Json(req): Json<CreateRow>,
) -> AppResult<Json<Row>> {
    if !PANELS.contains(&req.panel.as_str()) {
        return Err(AppError::BadRequest(format!("unknown panel: {}", req.panel)));
    }
    let position = match req.position {
        Some(p) => p,
        None => {
            let max: Option<f64> =
                sqlx::query_scalar("SELECT max(position) FROM schedule_rows WHERE panel = $1")
                    .bind(&req.panel)
                    .fetch_one(&state.db)
                    .await?;
            max.unwrap_or(0.0) + 1.0
        }
    };
    let row = sqlx::query_as::<_, Row>(
        "INSERT INTO schedule_rows (id, panel, position, driver, tractor, trailer)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, panel, position, driver, tractor, trailer, note, status",
    )
    .bind(Uuid::new_v4())
    .bind(&req.panel)
    .bind(position)
    .bind(req.driver)
    .bind(req.tractor)
    .bind(req.trailer)
    .fetch_one(&state.db)
    .await?;

    state.publish(Event::Rows {
        by: user.id,
        client: client_id(&headers),
        rows: vec![row.clone()],
    });
    Ok(Json(row))
}

#[derive(Deserialize)]
pub struct PatchRow {
    id: Uuid,
    position: Option<f64>,
    driver: Option<String>,
    tractor: Option<String>,
    trailer: Option<String>,
    note: Option<String>,
    status: Option<String>,
}

const ROW_STATUSES: [&str; 6] = ["", "work", "dayoff", "sick", "free", "repair"];

pub async fn patch_many(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    Json(patches): Json<Vec<PatchRow>>,
) -> AppResult<Json<Vec<Row>>> {
    let mut tx = state.db.begin().await?;
    let mut updated = Vec::with_capacity(patches.len());
    for p in patches {
        if let Some(ref status) = p.status {
            if !ROW_STATUSES.contains(&status.as_str()) {
                return Err(AppError::BadRequest(format!("unknown status: {status}")));
            }
        }
        let row = sqlx::query_as::<_, Row>(
            "UPDATE schedule_rows SET
                position = COALESCE($2, position),
                driver   = COALESCE($3, driver),
                tractor  = COALESCE($4, tractor),
                trailer  = COALESCE($5, trailer),
                note     = COALESCE($6, note),
                status   = COALESCE($7, status),
                updated_at = now()
             WHERE id = $1
             RETURNING id, panel, position, driver, tractor, trailer, note, status",
        )
        .bind(p.id)
        .bind(p.position)
        .bind(p.driver)
        .bind(p.tractor)
        .bind(p.trailer)
        .bind(p.note)
        .bind(p.status)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(row) = row {
            updated.push(row);
        }
    }
    tx.commit().await?;

    if !updated.is_empty() {
        state.publish(Event::Rows {
            by: user.id,
            client: client_id(&headers),
            rows: updated.clone(),
        });
    }
    Ok(Json(updated))
}

pub async fn delete(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    let res = sqlx::query("DELETE FROM schedule_rows WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    if res.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    state.publish(Event::RowDeleted {
        by: user.id,
        client: client_id(&headers),
        id,
    });
    Ok(Json(json!({ "ok": true })))
}
