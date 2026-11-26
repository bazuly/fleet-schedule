use argon2::{
    Argon2,
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString, rand_core::OsRng},
};
use axum::{
    Json,
    extract::{FromRequestParts, Query, State},
    http::{HeaderMap, HeaderValue, header, request::Parts},
    response::IntoResponse,
};
use chrono::Utc;
use jsonwebtoken::{Algorithm, DecodingKey, EncodingKey, Header, Validation, decode, encode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use uuid::Uuid;

use crate::{
    error::{AppError, AppResult},
    models::User,
    state::AppState,
};

/// Сколько живёт токен без новых заходов. Каждый успешный заход продлевает его.
const TOKEN_TTL_SECS: i64 = 7 * 24 * 60 * 60;

#[derive(Serialize, Deserialize)]
struct Claims {
    sub: Uuid,
    iat: i64,
    exp: i64,
}

pub fn issue_token(user_id: Uuid, secret: &[u8]) -> AppResult<String> {
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: user_id,
        iat: now,
        exp: now + TOKEN_TTL_SECS,
    };
    encode(&Header::new(Algorithm::HS256), &claims, &EncodingKey::from_secret(secret))
        .map_err(|e| AppError::Other(anyhow::anyhow!("jwt: {e}")))
}

fn user_id_from_token(token: &str, secret: &[u8]) -> AppResult<Uuid> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.leeway = 60;
    validation.validate_aud = false;
    let data = decode::<Claims>(token, &DecodingKey::from_secret(secret), &validation)
        .map_err(|_| AppError::Unauthorized)?;
    Ok(data.claims.sub)
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(|e| anyhow::anyhow!("hash error: {e}"))
}

fn verify_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

pub struct AuthUser(pub User);

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> AppResult<Self> {
        let header_token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .map(str::to_owned);
        // Браузерный WebSocket не умеет слать заголовки, поэтому токен можно передать в query.
        let token = match header_token {
            Some(t) => t,
            None => Query::<TokenQuery>::try_from_uri(&parts.uri)
                .ok()
                .and_then(|q| q.0.token)
                .ok_or(AppError::Unauthorized)?,
        };

        let user_id = user_id_from_token(&token, &state.jwt_secret)?;
        let user = sqlx::query_as::<_, User>(
            "SELECT id, login, name, is_admin FROM users WHERE id = $1",
        )
        .bind(user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(AppError::Unauthorized)?;

        Ok(AuthUser(user))
    }
}

#[derive(Deserialize)]
pub struct LoginRequest {
    login: String,
    password: String,
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> AppResult<Json<Value>> {
    let row: Option<(Uuid, String, String, bool, String)> = sqlx::query_as(
        "SELECT id, login, name, is_admin, password_hash FROM users WHERE login = $1",
    )
    .bind(req.login.trim())
    .fetch_optional(&state.db)
    .await?;

    let Some((id, login, name, is_admin, hash)) = row else {
        return Err(AppError::Unauthorized);
    };
    if !verify_password(&req.password, &hash) {
        return Err(AppError::Unauthorized);
    }

    let token = issue_token(id, &state.jwt_secret)?;
    let user = User { id, login, name, is_admin };
    Ok(Json(json!({ "token": token, "user": user })))
}

pub async fn logout() -> Json<Value> {
    // Токен живёт у клиента. Выход стирает его в браузере, серверу отзывать нечего.
    Json(json!({ "ok": true }))
}

pub async fn me(State(state): State<AppState>, AuthUser(user): AuthUser) -> AppResult<impl IntoResponse> {
    // Продлеваем на неделю от этого захода, чтобы открытое приложение не выкидывало.
    let token = issue_token(user.id, &state.jwt_secret)?;
    let mut headers = HeaderMap::new();
    headers.insert(
        "x-auth-token",
        HeaderValue::from_str(&token).map_err(|_| AppError::Other(anyhow::anyhow!("jwt header")))?,
    );
    Ok((headers, Json(user)))
}

#[derive(Deserialize)]
pub struct ChangePasswordRequest {
    old_password: String,
    new_password: String,
}

pub async fn change_password(
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
    Json(req): Json<ChangePasswordRequest>,
) -> AppResult<Json<Value>> {
    let hash: String = sqlx::query_scalar("SELECT password_hash FROM users WHERE id = $1")
        .bind(user.id)
        .fetch_one(&state.db)
        .await?;
    if !verify_password(&req.old_password, &hash) {
        return Err(AppError::BadRequest("неверный текущий пароль".into()));
    }
    if req.new_password.len() < 6 {
        return Err(AppError::BadRequest("пароль должен быть не короче 6 символов".into()));
    }
    sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
        .bind(hash_password(&req.new_password)?)
        .bind(user.id)
        .execute(&state.db)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

/// Создаёт администратора из переменных окружения, если пользователей ещё нет.
pub async fn seed_admin(state: &AppState) -> anyhow::Result<()> {
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
        .fetch_one(&state.db)
        .await?;
    if count > 0 {
        return Ok(());
    }
    let login = std::env::var("ADMIN_LOGIN").unwrap_or_else(|_| "admin".into());
    let password = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "admin".into());
    sqlx::query(
        "INSERT INTO users (id, login, name, password_hash, is_admin) VALUES ($1, $2, $3, $4, TRUE)",
    )
    .bind(Uuid::new_v4())
    .bind(&login)
    .bind("Администратор")
    .bind(hash_password(&password)?)
    .execute(&state.db)
    .await?;
    tracing::info!(%login, "created initial admin user");
    Ok(())
}
