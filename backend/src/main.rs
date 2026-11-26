mod auth;
mod axenta;
mod calendar;
mod cells;
mod error;
mod models;
mod rows;
mod state;
mod users;
mod ws;

use std::net::SocketAddr;

use axum::{
    Router,
    routing::{delete, get, patch, post},
};
use sqlx::postgres::PgPoolOptions;
use axum::http::HeaderName;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing_subscriber::EnvFilter;

use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")?;
    let db = PgPoolOptions::new()
        .max_connections(20)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&db).await?;

    let jwt_secret = std::env::var("JWT_SECRET").map_err(|_| anyhow::anyhow!("JWT_SECRET не задан"))?;
    if jwt_secret.len() < 16 {
        anyhow::bail!("JWT_SECRET короче 16 символов");
    }
    let state = AppState::new(db, jwt_secret.into_bytes());
    if state.axenta.is_none() {
        tracing::warn!("AXENTA_USERNAME/AXENTA_PASSWORD не заданы — карта транспорта отключена");
    }
    auth::seed_admin(&state).await?;

    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/auth/password", post(auth::change_password))
        .route("/users", get(users::list).post(users::create))
        .route("/users/{id}", patch(users::update).delete(users::delete))
        .route("/rows", get(rows::list).post(rows::create).patch(rows::patch_many))
        .route("/rows/{id}", delete(rows::delete))
        .route("/cells", get(cells::list).put(cells::put))
        .route("/cells/history", get(cells::history))
        .route("/calendar", get(calendar::get).put(calendar::put))
        .route("/navigation/locate", get(axenta::locate))
        .route("/ws", get(ws::handler));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any)
        .expose_headers([HeaderName::from_static("x-auth-token")]);

    let app = Router::new()
        .nest("/api", api)
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port: u16 = std::env::var("PORT").ok().and_then(|p| p.parse().ok()).unwrap_or(8080);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    tracing::info!(%addr, "listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}
