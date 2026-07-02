//! Tauri-independent backend logic for ValorPredict.
//!
//! This crate holds the pieces ported from the old Node backend so they can be
//! compiled and tested without the Tauri/WebView stack: the SQLite layer, the
//! Twitch client, the prediction service, and (later) the Axum HTTP server.

// Methods are added per phase; some are unused until later phases wire them up.
#![allow(dead_code)]

pub mod api;
pub mod db;
pub mod predictions;
pub mod twitch;
