use axum::extract::State;
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use crate::state::AppState;
use crate::routes::users::users_routes;

#[derive(Serialize, Deserialize)]
struct Message {
    content: String,
}

pub async fn connect() -> PgPool {
    let database_url = std::env::var("DATABASE_URL")
        .expect("DATABASE_URL must be set");

    PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to the database")
}

async fn hello() -> Json<Message> {
    Json(Message {
        content: "Hello, World!".to_string(),
    })
}

pub async fn run_server() {
    let pool = connect().await;
    let state = AppState {db_pool: pool.clone()};

    let app = Router::new()
        .route("/", get(hello))
        .merge(users_routes())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("listening on port 3000");

    axum::serve(listener, app).await.unwrap();
}