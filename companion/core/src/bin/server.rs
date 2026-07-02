//! Standalone runner for the Rust backend — the same Axum app the Tauri shell
//! embeds. Lets us run and verify the whole server locally without the
//! Tauri/WebView build.
//!
//! Env: PORT, DATABASE_PATH, TWITCH_REDIRECT_URI, WEB_DIST (serve a built SPA),
//! NODE_ENV (production disables dev/simulate routes).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use vap_core::api::{build_router, AppState};
use vap_core::db::Db;

#[tokio::main]
async fn main() {
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(3000);
    let db_path =
        std::env::var("DATABASE_PATH").unwrap_or_else(|_| "./data/vap.sqlite".to_string());
    let redirect_uri = std::env::var("TWITCH_REDIRECT_URI")
        .unwrap_or_else(|_| format!("http://localhost:{port}/auth/twitch/callback"));
    let development_mode = std::env::var("NODE_ENV")
        .map(|value| value != "production")
        .unwrap_or(true);
    let static_dir = std::env::var("WEB_DIST").ok().map(PathBuf::from);

    let db = Arc::new(Db::open(Path::new(&db_path)).expect("open database"));
    let state = AppState::new(db, redirect_uri, development_mode, static_dir);
    let app = build_router(state);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("bind listener");
    println!("ValorPredict server on http://{addr}");
    axum::serve(listener, app).await.expect("serve");
}
