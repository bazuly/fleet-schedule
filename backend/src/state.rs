use chrono::NaiveDate;
use serde::Serialize;
use sqlx::PgPool;
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::models::{Cell, Row};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    Cells { by: Uuid, client: Option<String>, cells: Vec<Cell> },
    Rows { by: Uuid, client: Option<String>, rows: Vec<Row> },
    RowDeleted { by: Uuid, client: Option<String>, id: Uuid },
}

/// Идентификатор вкладки браузера: клиент игнорирует собственные события.
pub fn client_id(headers: &axum::http::HeaderMap) -> Option<String> {
    headers
        .get("x-client-id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.chars().take(64).collect())
}

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub events: broadcast::Sender<Event>,
}

impl AppState {
    pub fn new(db: PgPool) -> Self {
        let (events, _) = broadcast::channel(1024);
        Self { db, events }
    }

    pub fn publish(&self, event: Event) {
        // Ошибка означает лишь отсутствие подписчиков.
        let _ = self.events.send(event);
    }
}

pub fn parse_day(s: &str) -> Result<NaiveDate, crate::error::AppError> {
    NaiveDate::parse_from_str(s, "%Y-%m-%d")
        .map_err(|_| crate::error::AppError::BadRequest(format!("invalid date: {s}")))
}
