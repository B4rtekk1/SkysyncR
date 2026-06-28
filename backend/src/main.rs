mod app;
mod db;
mod state;
mod models;
mod routes;
mod handlers;
mod services;
mod crypto;

use app::run_server;
use dotenvy;

#[tokio::main]
async fn main() {
    dotenvy::from_filename("infra/env/.env.dev").ok();
    run_server().await;
}