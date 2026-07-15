use crate::routes::files::files_routes;
use crate::routes::folders::folders_routes;
use crate::routes::storage::storage_routes;
use crate::routes::users::{auth_limited_routes, users_routes};
use crate::services::trash::spawn_trash_purge_worker;
use crate::state::{AppConfig, AppState};
use axum::http::{HeaderValue, Method, header};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use std::net::SocketAddr;
use tower_governor::governor::GovernorConfigBuilder;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::set_header::SetResponseHeaderLayer;

#[derive(Serialize, Deserialize)]
struct Message {
    content: String,
}

pub async fn connect() -> PgPool {
    let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");

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
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE])
        .expose_headers([header::CONTENT_TYPE])
        .allow_credentials(true)
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

    spawn_trash_purge_worker(
        pool.clone(),
        config.trash_retention_days,
        config.trash_purge_interval_hours,
    );

    let auth_governor = GovernorConfigBuilder::default()
        .per_second(3)
        .burst_size(6)
        .finish()
        .unwrap();

    let state = AppState {
        db_pool: pool.clone(),
        config: config.clone(),
    };

    let auth_routes =
        auth_limited_routes().layer(tower_governor::GovernorLayer::new(auth_governor));

    let app = Router::new()
        .route("/", get(hello))
        .merge(auth_routes)
        .merge(users_routes())
        .merge(storage_routes())
        .merge(files_routes())
        .merge(folders_routes())
        .with_state(state)
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
