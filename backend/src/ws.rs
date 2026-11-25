use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    response::Response,
};
use futures::{SinkExt, StreamExt};
use tokio::sync::broadcast::error::RecvError;

use crate::{auth::AuthUser, state::AppState};

pub async fn handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    AuthUser(user): AuthUser,
) -> Response {
    ws.on_upgrade(move |socket| run(socket, state, user.login))
}

async fn run(socket: WebSocket, state: AppState, login: String) {
    let (mut sender, mut receiver) = socket.split();
    let mut events = state.events.subscribe();
    tracing::debug!(%login, "ws connected");

    loop {
        tokio::select! {
            event = events.recv() => match event {
                Ok(event) => {
                    let Ok(text) = serde_json::to_string(&event) else { continue };
                    if sender.send(Message::Text(text.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => {
                    // Клиент отстал — просим его перечитать данные целиком.
                    let msg = r#"{"type":"resync"}"#;
                    if sender.send(Message::Text(msg.into())).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Closed) => break,
            },
            msg = receiver.next() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }
    tracing::debug!(%login, "ws disconnected");
}
