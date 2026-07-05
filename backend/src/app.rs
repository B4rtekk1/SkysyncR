use axum::routing::get;
use axum::{Json, Router};
use axum::http::{HeaderValue, Method};
use std::net::SocketAddr;
use tower_governor::governor::GovernorConfigBuilder;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tower_http::cors::{AllowOrigin, Any, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use crate::state::{AppConfig, AppState};
use crate::routes::users::users_routes;
use crate::routes::storage::storage_routes;

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

fn dev_cors_layer() -> CorsLayer {
    let origins: Vec<HeaderValue> = std::env::var("CORS_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:5173".to_string())
        .split(',')
        .filter_map(|o| o.trim().parse().ok())
        .collect();

    let allow_origin = if origins.len() <= 1 {
        let origin = origins
            .first()
            .cloned()
            .unwrap_or_else(|| "http://localhost:5173".parse().unwrap());
        AllowOrigin::exact(origin)
    } else {
        AllowOrigin::list(origins)
    };

    CorsLayer::new()
        .allow_origin(allow_origin)
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(Any)
        .expose_headers(Any)
}

fn security_headers_layer() -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::overriding(
        axum::http::header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    )
}

pub async fn run_server() {
    let pool = connect().await;
    let config = AppConfig::from_env();

    if config.is_dev {
        println!("Running in development mode");
    }

    let global_governor = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(20)
        .finish()
        .unwrap();

    let auth_governor = GovernorConfigBuilder::default()
        .per_second(3)
        .burst_size(6)
        .finish()
        .unwrap();

    let state = AppState {
        db_pool: pool.clone(),
        config: config.clone(),
    };

    let auth_routes = users_routes().layer(tower_governor::GovernorLayer::new(auth_governor));

    let app = Router::new()
        .route("/", get(hello))
        .merge(auth_routes)
        .merge(storage_routes())
        .with_state(state)
        .layer(tower_governor::GovernorLayer::new(global_governor))
        .layer(security_headers_layer())
        .layer(dev_cors_layer());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    println!("listening on http://0.0.0.0:3000 (dev)");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
