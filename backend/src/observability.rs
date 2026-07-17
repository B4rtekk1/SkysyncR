use axum::extract::{ConnectInfo, Request};
use axum::http::{HeaderName, HeaderValue, header};
use axum::middleware::Next;
use axum::response::Response;
use std::net::SocketAddr;
use std::time::Instant;
use tracing_subscriber::EnvFilter;
use uuid::Uuid;

const REQUEST_ID_HEADER: HeaderName = HeaderName::from_static("x-request-id");
const DEFAULT_LOG_FILTER: &str = "skysyncr=info,tower_http=info,sqlx=warn";

pub fn init_tracing() {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LOG_FILTER));

    let format = std::env::var("LOG_FORMAT").unwrap_or_else(|_| "json".to_string());

    if format.eq_ignore_ascii_case("pretty") {
        tracing_subscriber::fmt()
            .with_env_filter(env_filter)
            .with_target(true)
            .with_file(true)
            .with_line_number(true)
            .with_thread_ids(true)
            .init();
    } else {
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
    }
}

pub async fn request_observability(mut request: Request, next: Next) -> Response {
    let started = Instant::now();
    let request_id = request_id(&request);
    let method = request.method().clone();
    let path = request.uri().path().to_string();
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
}
