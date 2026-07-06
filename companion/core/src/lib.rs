//! Tauri-independent backend logic for ValorPredict.
//!
//! This crate holds the pieces the desktop app builds on without pulling in the
//! Tauri/WebView stack: the SQLite layer, the Twitch client, and the prediction
//! service. It can be compiled and tested on its own.

// Some methods are only exercised by the Tauri shell; keep them here regardless.
#![allow(dead_code)]

pub mod db;
pub mod predictions;
pub mod twitch;
