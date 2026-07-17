use crate::routes::calendar::calendar_routes;
use crate::routes::files::files_routes;
use crate::routes::folders::folders_routes;
use crate::routes::groups::groups_routes;
use crate::routes::storage::storage_routes;
use crate::routes::users::{auth_limited_routes, users_routes};
use crate::services::storage_consistency::spawn_storage_consistency_worker;
use crate::services::trash::spawn_trash_purge_worker;
use crate::state::{AppConfig, AppState};
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::middleware;
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

    tracing::info!("connecting to database");
    let pool = PgPool::connect(&database_url)
        .await
        .expect("Failed to connect to the database");
    tracing::info!("connected to database");
    pool
}

async fn hello() -> Json<Message> {
    Json(Message {
        content: "Hello, World!".to_string(),
    })
}

const CONTENT_SECURITY_POLICY: &str = concat!(
    "default-src 'none'; ",
    "base-uri 'none'; ",
    "form-action 'none'; ",
    "frame-ancestors 'none'; ",
    "object-src 'none'; ",
    "script-src 'self'; ",
    "style-src 'self'; ",
    "img-src 'self' data:; ",
    "font-src 'self'; ",
    "connect-src 'self'"
);

fn cors_layer() -> CorsLayer {
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
        .expose_headers([header::CONTENT_TYPE, header::CONTENT_DISPOSITION])
        .allow_credentials(true)
}

fn security_header_layer(
    header_name: HeaderName,
    value: &'static str,
) -> SetResponseHeaderLayer<HeaderValue> {
    SetResponseHeaderLayer::overriding(header_name, HeaderValue::from_static(value))
}

pub async fn run_server() {
    tracing::info!("starting server");
    let pool = connect().await;
    let config = AppConfig::from_env();

    tracing::info!(
        is_dev = config.is_dev,
        upload_dir = %config.upload_dir.display(),
        max_file_size_bytes = config.max_file_size_bytes,
        max_concurrent_file_transfers = config.max_concurrent_file_transfers,
        file_transfer_timeout_seconds = config.file_transfer_timeout_seconds,
        trash_retention_days = config.trash_retention_days,
        trash_purge_interval_hours = config.trash_purge_interval_hours,
        "loaded application config"
    );

    if config.is_dev {
        tracing::info!("running in development mode");
    }

    spawn_trash_purge_worker(
        pool.clone(),
        config.trash_retention_days,
        config.trash_purge_interval_hours,
    );
    spawn_storage_consistency_worker(
        pool.clone(),
        config.upload_dir.clone(),
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
        .merge(files_routes(
            config.max_file_size_bytes,
            config.max_concurrent_file_transfers,
            config.file_transfer_timeout_seconds,
        ))
        .merge(folders_routes())
        .merge(groups_routes())
        .merge(calendar_routes())
        .with_state(state)
        .layer(security_header_layer(
            header::X_CONTENT_TYPE_OPTIONS,
            "nosniff",
        ))
        .layer(security_header_layer(
            HeaderName::from_static("content-security-policy"),
            CONTENT_SECURITY_POLICY,
        ))
        .layer(security_header_layer(
            HeaderName::from_static("referrer-policy"),
            "strict-origin-when-cross-origin",
        ))
        .layer(security_header_layer(
            HeaderName::from_static("permissions-policy"),
            "camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)",
        ))
        .layer(middleware::from_fn(
            crate::observability::request_observability,
        ))
        .layer(cors_layer());

    let app = if config.is_dev {
        app
    } else {
        app.layer(security_header_layer(
            HeaderName::from_static("strict-transport-security"),
            "max-age=31536000; includeSubDomains",
        ))
    };

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    tracing::info!(address = "0.0.0.0:3000", "listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await
    .unwrap();
}
