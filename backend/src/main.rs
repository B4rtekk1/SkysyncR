mod app;
mod auth;
mod crypto;
mod db;
mod handlers;
mod models;
mod routes;
mod services;
mod state;
mod utils;

use app::run_server;
use dotenvy;

#[tokio::main]
async fn main() {
    dotenvy::from_filename("infra/env/.env.dev").ok();
    run_server().await;
}
