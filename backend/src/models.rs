use chrono::NaiveDate;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub const PANELS: [&str; 3] = ["main", "unassigned", "pickups"];

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Row {
    pub id: Uuid,
    pub panel: String,
    pub position: f64,
    pub driver: String,
    pub tractor: String,
    pub trailer: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Cell {
    pub row_id: Uuid,
    pub day: NaiveDate,
    pub value: String,
    pub bg: Option<String>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct User {
    pub id: Uuid,
    pub login: String,
    pub name: String,
    pub is_admin: bool,
}
