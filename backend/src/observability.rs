use axum::body::Body;
use axum::extract::{ConnectInfo, MatchedPath, Request, State};
use axum::http::{HeaderName, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::db::storage::{StorageOverview, get_storage_overview};
use crate::state::AppState;

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const DEFAULT_LOG_FILTER: &str = "skysyncr=info,tower_http=info,sqlx=warn";
const METRICS_CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";
const MAX_HTTP_METRIC_KEYS: usize = 1024;
const HTTP_METRICS_OVERFLOW_PATH: &str = "/__other__";

pub fn init_tracing() {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));

    let default_format = if std::env::var("APP_ENV")
        .map(|value| value == "production" || value == "prod")
        .unwrap_or(false)
    {
        "json"
    } else {
        "pretty"
    };
    let format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| default_format.to_string());

    if format.eq_ignore_ascii_case("json") {
        tracing_subscriber::fmt()
            .json()
            .with_env_filter(env_filter)
            .with_current_span(true)
            .with_span_list(true)
            .with_target(true)
            .with_file(true)
            .with_line_number(true)
            .with_thread_ids(true)
            .init();
    } else {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .compact()
            .with_target(false)
            .with_file(false)
            .with_line_number(false)
            .with_thread_ids(false)
            .init();
    }
}

pub async fn request_observability(mut request: Request, next: Next) -> Response {
    let started = Instant::now();
    let request_id = request_id(&request);
    let method = request.method().clone();
    let path = request
        .extensions()
        .get::<MatchedPath>()
        .map(|matched_path| route_name(matched_path.as_str()))
        .unwrap_or_else(|| sanitized_request_path(request.uri().path()));
    let request_bytes = content_length(request.headers());
    let user_agent = header_value(request.headers(), header::USER_AGENT);
    let client_ip = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ConnectInfo(addr)| addr.ip().to_string());

    request
        .extensions_mut()
        .insert(RequestId(request_id.clone()));

    let mut response = next.run(request).await;
    let status = response.status();
    let response_bytes = content_length(response.headers());
    let latency_ms = started.elapsed().as_secs_f64() * 1000.0;
    metrics().record_http_request(&method.to_string(), &path, status.as_u16(), latency_ms);

    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response.headers_mut().insert(REQUEST_ID_HEADER, value);
    }

    if status.is_server_error() {
        tracing::error!(
            request_id = %request_id,
            method = %method,
            path = %path,
            status = status.as_u16(),
            latency_ms,
            request_bytes,
            response_bytes,
            client_ip,
            user_agent,
            "http_request"
        );
    } else if status.is_client_error() {
        tracing::warn!(
            request_id = %request_id,
            method = %method,
            path = %path,
            status = status.as_u16(),
            latency_ms,
            request_bytes,
            response_bytes,
            client_ip,
            user_agent,
            "http_request"
        );
    } else {
        tracing::info!(
            request_id = %request_id,
            method = %method,
            path = %path,
            status = status.as_u16(),
            latency_ms,
            request_bytes,
            response_bytes,
            client_ip,
            user_agent,
            "http_request"
        );
    }

    response
}

pub fn record_transfer_success(direction: &'static str, bytes: i64) {
    metrics().record_transfer(direction, "success", bytes.max(0) as u64);
}

pub fn record_transfer_error(direction: &'static str, reason: &'static str) {
    metrics().record_transfer(direction, reason, 0);
    tracing::warn!(
        transfer_direction = direction,
        transfer_error = reason,
        alert = "file_transfer_error",
        "file transfer failed"
    );
}

pub fn observe_db_latency(operation: &'static str, elapsed: Duration) {
    let latency_ms = elapsed.as_secs_f64() * 1000.0;
    metrics().record_db_latency(operation, latency_ms);
}

pub async fn metrics_endpoint(_auth: AuthUser, State(state): State<AppState>) -> Response {
    let db_latency = probe_database_latency(&state).await;
    let storage_overview = match get_storage_overview(&state.db_pool).await {
        Ok(overview) => Some(overview),
        Err(err) => {
            tracing::error!(error = %err, alert = "storage_metrics_unavailable", "failed to collect storage metrics");
            None
        }
    };
    if let Some(overview) = storage_overview.as_ref() {
        emit_storage_alert(&state, overview);
    }

    let body = metrics().render(
        db_latency,
        storage_overview.as_ref(),
        state.db_pool.size(),
        state.db_pool.num_idle() as u32,
    );

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, METRICS_CONTENT_TYPE)
        .body(Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

pub async fn healthz(State(state): State<AppState>) -> impl IntoResponse {
    let db_latency = probe_database_latency(&state).await;
    let status = if db_latency.is_some() {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (
        status,
        if status == StatusCode::OK {
            "ok\n"
        } else {
            "degraded\n"
        },
    )
}

async fn probe_database_latency(state: &AppState) -> Option<f64> {
    let started = Instant::now();
    let result = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db_pool)
        .await;
    let latency_ms = started.elapsed().as_secs_f64() * 1000.0;
    observe_db_latency("health_probe", started.elapsed());

    match result {
        Ok(_) => {
            if latency_ms > state.config.db_latency_alert_ms as f64 {
                tracing::warn!(
                    latency_ms,
                    threshold_ms = state.config.db_latency_alert_ms,
                    alert = "database_latency_high",
                    "database health probe exceeded latency threshold"
                );
            }
            Some(latency_ms)
        }
        Err(err) => {
            metrics().increment_alert("database_unreachable");
            tracing::error!(error = %err, alert = "database_unreachable", "database health probe failed");
            None
        }
    }
}

fn emit_storage_alert(state: &AppState, overview: &StorageOverview) {
    let Some(ratio) = overview.usage_ratio() else {
        return;
    };
    if ratio >= state.config.storage_usage_alert_ratio {
        metrics().increment_alert("storage_usage_high");
        tracing::warn!(
            used_bytes = overview.used_bytes,
            total_bytes = overview.total_bytes,
            usage_ratio = ratio,
            threshold_ratio = state.config.storage_usage_alert_ratio,
            alert = "storage_usage_high",
            "storage usage exceeded alert threshold"
        );
    }
}

fn metrics() -> &'static Metrics {
    static METRICS: OnceLock<Metrics> = OnceLock::new();
    METRICS.get_or_init(Metrics::default)
}

#[derive(Default)]
struct Metrics {
    http_requests: Mutex<BTreeMap<HttpKey, RequestMetric>>,
    transfers: Mutex<BTreeMap<TransferKey, TransferMetric>>,
    db_latency: Mutex<BTreeMap<&'static str, LatencyMetric>>,
    alerts: Mutex<BTreeMap<&'static str, u64>>,
}

impl Metrics {
    fn record_http_request(&self, method: &str, path: &str, status: u16, latency_ms: f64) {
        let mut key = HttpKey {
            method: method.to_string(),
            path: path.to_string(),
            status_class: format!("{}xx", status / 100),
        };
        let mut requests = self.http_requests.lock().expect("metrics mutex poisoned");
        if !requests.contains_key(&key) && requests.len() >= MAX_HTTP_METRIC_KEYS - 1 {
            key.path = HTTP_METRICS_OVERFLOW_PATH.to_string();
        }
        requests.entry(key).or_default().observe(latency_ms);
    }

    fn record_transfer(&self, direction: &'static str, result: &'static str, bytes: u64) {
        let mut transfers = self.transfers.lock().expect("metrics mutex poisoned");
        transfers
            .entry(TransferKey { direction, result })
            .or_default()
            .observe(bytes);
    }

    fn record_db_latency(&self, operation: &'static str, latency_ms: f64) {
        let mut latencies = self.db_latency.lock().expect("metrics mutex poisoned");
        latencies.entry(operation).or_default().observe(latency_ms);
    }

    fn increment_alert(&self, name: &'static str) {
        let mut alerts = self.alerts.lock().expect("metrics mutex poisoned");
        *alerts.entry(name).or_default() += 1;
    }

    fn render(
        &self,
        db_probe_latency_ms: Option<f64>,
        storage: Option<&StorageOverview>,
        db_pool_size: u32,
        db_pool_idle: u32,
    ) -> String {
        let mut out = String::new();
        out.push_str("# HELP skysyncr_up Application liveness from the metrics endpoint.\n");
        out.push_str("# TYPE skysyncr_up gauge\nskysyncr_up 1\n");
        out.push_str("# HELP skysyncr_db_pool_connections PostgreSQL pool connections.\n");
        out.push_str("# TYPE skysyncr_db_pool_connections gauge\n");
        push_metric(
            &mut out,
            "skysyncr_db_pool_connections",
            &[("state", "open")],
            db_pool_size as f64,
        );
        push_metric(
            &mut out,
            "skysyncr_db_pool_connections",
            &[("state", "idle")],
            db_pool_idle as f64,
        );

        if let Some(latency_ms) = db_probe_latency_ms {
            out.push_str("# HELP skysyncr_database_health_probe_latency_ms Latest database health probe latency.\n");
            out.push_str("# TYPE skysyncr_database_health_probe_latency_ms gauge\n");
            push_metric(
                &mut out,
                "skysyncr_database_health_probe_latency_ms",
                &[],
                latency_ms,
            );
        } else {
            out.push_str("# HELP skysyncr_database_reachable Database health probe result.\n");
            out.push_str(
                "# TYPE skysyncr_database_reachable gauge\nskysyncr_database_reachable 0\n",
            );
        }

        if let Some(storage) = storage {
            out.push_str("# HELP skysyncr_storage_bytes Storage quota usage across users.\n");
            out.push_str("# TYPE skysyncr_storage_bytes gauge\n");
            push_metric(
                &mut out,
                "skysyncr_storage_bytes",
                &[("kind", "used")],
                storage.used_bytes as f64,
            );
            push_metric(
                &mut out,
                "skysyncr_storage_bytes",
                &[("kind", "total")],
                storage.total_bytes as f64,
            );
            push_metric(
                &mut out,
                "skysyncr_storage_users_total",
                &[],
                storage.users as f64,
            );
        }

        out.push_str("# HELP skysyncr_http_requests_total HTTP requests grouped by method, path and status class.\n");
        out.push_str("# TYPE skysyncr_http_requests_total counter\n");
        out.push_str("# HELP skysyncr_http_request_latency_ms_sum Total HTTP request latency in milliseconds.\n");
        out.push_str("# TYPE skysyncr_http_request_latency_ms_sum counter\n");
        out.push_str("# HELP skysyncr_http_request_latency_ms_max Maximum observed HTTP request latency in milliseconds.\n");
        out.push_str("# TYPE skysyncr_http_request_latency_ms_max gauge\n");
        for (key, metric) in self
            .http_requests
            .lock()
            .expect("metrics mutex poisoned")
            .iter()
        {
            let labels = [
                ("method", key.method.as_str()),
                ("path", key.path.as_str()),
                ("status_class", key.status_class.as_str()),
            ];
            push_metric(
                &mut out,
                "skysyncr_http_requests_total",
                &labels,
                metric.count as f64,
            );
            push_metric(
                &mut out,
                "skysyncr_http_request_latency_ms_sum",
                &labels,
                metric.latency_ms_sum,
            );
            push_metric(
                &mut out,
                "skysyncr_http_request_latency_ms_max",
                &labels,
                metric.latency_ms_max,
            );
        }

        out.push_str("# HELP skysyncr_file_transfer_operations_total File transfer operations grouped by direction and result.\n");
        out.push_str("# TYPE skysyncr_file_transfer_operations_total counter\n");
        out.push_str("# HELP skysyncr_file_transfer_bytes_total File transfer bytes grouped by direction and result.\n");
        out.push_str("# TYPE skysyncr_file_transfer_bytes_total counter\n");
        for (key, metric) in self
            .transfers
            .lock()
            .expect("metrics mutex poisoned")
            .iter()
        {
            let labels = [("direction", key.direction), ("result", key.result)];
            push_metric(
                &mut out,
                "skysyncr_file_transfer_operations_total",
                &labels,
                metric.count as f64,
            );
            push_metric(
                &mut out,
                "skysyncr_file_transfer_bytes_total",
                &labels,
                metric.bytes as f64,
            );
        }

        out.push_str("# HELP skysyncr_db_operation_latency_ms_sum Total observed DB operation latency in milliseconds.\n");
        out.push_str("# TYPE skysyncr_db_operation_latency_ms_sum counter\n");
        out.push_str("# HELP skysyncr_db_operation_latency_ms_max Maximum observed DB operation latency in milliseconds.\n");
        out.push_str("# TYPE skysyncr_db_operation_latency_ms_max gauge\n");
        for (operation, metric) in self
            .db_latency
            .lock()
            .expect("metrics mutex poisoned")
            .iter()
        {
            let labels = [("operation", *operation)];
            push_metric(
                &mut out,
                "skysyncr_db_operation_latency_ms_count",
                &labels,
                metric.count as f64,
            );
            push_metric(
                &mut out,
                "skysyncr_db_operation_latency_ms_sum",
                &labels,
                metric.sum,
            );
            push_metric(
                &mut out,
                "skysyncr_db_operation_latency_ms_max",
                &labels,
                metric.max,
            );
        }

        out.push_str("# HELP skysyncr_operational_alerts_total Operational alert emissions grouped by alert name.\n");
        out.push_str("# TYPE skysyncr_operational_alerts_total counter\n");
        for (name, count) in self.alerts.lock().expect("metrics mutex poisoned").iter() {
            push_metric(
                &mut out,
                "skysyncr_operational_alerts_total",
                &[("alert", *name)],
                *count as f64,
            );
        }

        out
    }
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
struct HttpKey {
    method: String,
    path: String,
    status_class: String,
}

#[derive(Clone, Eq, Ord, PartialEq, PartialOrd)]
struct TransferKey {
    direction: &'static str,
    result: &'static str,
}

#[derive(Default)]
struct RequestMetric {
    count: u64,
    latency_ms_sum: f64,
    latency_ms_max: f64,
}

impl RequestMetric {
    fn observe(&mut self, latency_ms: f64) {
        self.count += 1;
        self.latency_ms_sum += latency_ms;
        self.latency_ms_max = self.latency_ms_max.max(latency_ms);
    }
}

#[derive(Default)]
struct TransferMetric {
    count: u64,
    bytes: u64,
}

impl TransferMetric {
    fn observe(&mut self, bytes: u64) {
        self.count += 1;
        self.bytes += bytes;
    }
}

#[derive(Default)]
struct LatencyMetric {
    count: u64,
    sum: f64,
    max: f64,
}

impl LatencyMetric {
    fn observe(&mut self, latency_ms: f64) {
        self.count += 1;
        self.sum += latency_ms;
        self.max = self.max.max(latency_ms);
    }
}

fn push_metric(out: &mut String, name: &str, labels: &[(&str, &str)], value: f64) {
    out.push_str(name);
    if !labels.is_empty() {
        out.push('{');
        for (index, (label, value)) in labels.iter().enumerate() {
            if index > 0 {
                out.push(',');
            }
            out.push_str(label);
            out.push_str("=\"");
            push_escaped_label(out, value);
            out.push('"');
        }
        out.push('}');
    }
    out.push(' ');
    out.push_str(&value.to_string());
    out.push('\n');
}

fn push_escaped_label(out: &mut String, value: &str) {
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            ch => out.push(ch),
        }
    }
}

#[derive(Clone, Debug)]
pub struct RequestId(pub String);

fn request_id(request: &Request) -> String {
    request
        .headers()
        .get(&REQUEST_ID_HEADER)
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        })
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| Uuid::new_v4().to_string())
}

fn content_length(headers: &axum::http::HeaderMap) -> Option<u64> {
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
}

fn header_value(headers: &axum::http::HeaderMap, name: HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.chars().take(256).collect())
}

fn sanitized_request_path(path: &str) -> String {
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    match segments.as_slice() {
        ["share", _, "download"] => "/share/:token/download".into(),
        ["share", "folders", _] => "/share/folders/:token".into(),
        ["share", "folders", _, "files", _, "download"] => {
            "/share/folders/:token/files/:file_id/download".into()
        }
        _ => "/__unmatched__".into(),
    }
}

fn route_name(path: &str) -> String {
    path.split('/')
        .map(|segment| {
            segment
                .strip_prefix('{')
                .and_then(|segment| segment.strip_suffix('}'))
                .map_or_else(|| segment.to_string(), |parameter| format!(":{parameter}"))
        })
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{HeaderMap, HeaderValue};

    #[test]
    fn content_length_parses_valid_header() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("42"));

        assert_eq!(content_length(&headers), Some(42));
    }

    #[test]
    fn content_length_ignores_invalid_header() {
        let mut headers = HeaderMap::new();
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("nope"));

        assert_eq!(content_length(&headers), None);
    }

    #[test]
    fn header_value_truncates_long_values() {
        let mut headers = HeaderMap::new();
        let value = "a".repeat(300);
        headers.insert(header::USER_AGENT, HeaderValue::from_str(&value).unwrap());

        assert_eq!(
            header_value(&headers, header::USER_AGENT).unwrap().len(),
            256
        );
    }

    #[test]
    fn sanitized_request_path_hides_public_share_tokens() {
        assert_eq!(
            sanitized_request_path("/share/secret-token/download"),
            "/share/:token/download"
        );
        assert_eq!(
            sanitized_request_path("/share/folders/secret-token/files/file-id/download"),
            "/share/folders/:token/files/:file_id/download"
        );
    }

    #[test]
    fn route_name_uses_colon_parameters() {
        assert_eq!(
            route_name("/share/{token}/download"),
            "/share/:token/download"
        );
    }

    #[test]
    fn http_metrics_have_a_bounded_number_of_keys() {
        let metrics = Metrics::default();

        for index in 0..(MAX_HTTP_METRIC_KEYS + 100) {
            metrics.record_http_request("GET", &format!("/unknown/{index}"), 404, 1.0);
        }

        let requests = metrics.http_requests.lock().unwrap();
        assert_eq!(requests.len(), MAX_HTTP_METRIC_KEYS);
        assert!(
            requests
                .keys()
                .any(|key| key.path == HTTP_METRICS_OVERFLOW_PATH)
        );
    }
}
