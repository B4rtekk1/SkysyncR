mod app;
mod auth;
mod crypto;
mod db;
mod handlers;
mod models;
mod observability;
mod routes;
mod services;
mod state;
mod utils;

use app::run_server;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    dotenvy::from_filename("infra/env/.env.dev").ok();
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    run_server().await;
}
