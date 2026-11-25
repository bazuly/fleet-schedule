use axum::{
    Json,
    extract::{Path, State},
};
use serde::Deserialize;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    auth::{AuthUser, hash_password},
    error::{AppError, AppResult},
    models::User,
    state::AppState,
};

fn require_admin(user: &User) -> AppResult<()> {
    if user.is_admin { Ok(()) } else { Err(AppError::Forbidden) }
}

pub async fn list(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> AppResult<Json<Vec<User>>> {
    require_admin(&user)?;
    let users = sqlx::query_as::<_, User>(
        "SELECT id, login, name, is_admin FROM users ORDER BY created_at",
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(users))
}

#[derive(Deserialize)]
pub struct CreateUser {
    login: String,
    name: String,
    password: String,
    #[serde(default)]
    is_admin: bool,
}

pub async fn create(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<CreateUser>,
) -> AppResult<Json<User>> {
    require_admin(&user)?;
    let login = req.login.trim();
    if login.is_empty() || req.password.len() < 6 {
        return Err(AppError::BadRequest(
            "нужен логин и пароль не короче 6 символов".into(),
        ));
    }
    let created = sqlx::query_as::<_, User>(
        "INSERT INTO users (id, login, name, password_hash, is_admin)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (login) DO NOTHING
         RETURNING id, login, name, is_admin",
    )
    .bind(Uuid::new_v4())
    .bind(login)
    .bind(req.name.trim())
    .bind(hash_password(&req.password)?)
    .bind(req.is_admin)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| AppError::Conflict("такой логин уже существует".into()))?;
    Ok(Json(created))
}

#[derive(Deserialize)]
pub struct UpdateUser {
    name: Option<String>,
    password: Option<String>,
    is_admin: Option<bool>,
}

pub async fn update(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateUser>,
) -> AppResult<Json<User>> {
    require_admin(&user)?;
    if id == user.id && req.is_admin == Some(false) {
        return Err(AppError::BadRequest("нельзя снять права администратора с себя".into()));
    }
    let hash = match req.password.as_deref() {
        Some(p) if p.len() < 6 => {
            return Err(AppError::BadRequest("пароль должен быть не короче 6 символов".into()));
        }
        Some(p) => Some(hash_password(p)?),
        None => None,
    };
    let updated = sqlx::query_as::<_, User>(
        "UPDATE users SET
            name = COALESCE($2, name),
            password_hash = COALESCE($3, password_hash),
            is_admin = COALESCE($4, is_admin)
         WHERE id = $1
         RETURNING id, login, name, is_admin",
    )
    .bind(id)
    .bind(req.name.as_deref().map(str::trim))
    .bind(hash)
    .bind(req.is_admin)
    .fetch_optional(&state.db)
    .await?
    .ok_or(AppError::NotFound)?;
    if req.password.is_some() {
        sqlx::query("DELETE FROM sessions WHERE user_id = $1 AND $1 <> $2")
            .bind(id)
            .bind(user.id)
            .execute(&state.db)
            .await?;
    }
    Ok(Json(updated))
}

pub async fn delete(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Path(id): Path<Uuid>,
) -> AppResult<Json<Value>> {
    require_admin(&user)?;
    if id == user.id {
        return Err(AppError::BadRequest("нельзя удалить самого себя".into()));
    }
    sqlx::query("DELETE FROM users WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
