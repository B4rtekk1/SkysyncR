use axum::http::HeaderMap;
use std::net::IpAddr;
use uuid::Uuid;

use crate::utils::errors::ApiError;

const DEVICE_ID_HEADER: &str = "x-device-id";
const MAX_USER_AGENT_LEN: usize = 512;

#[derive(Debug, Clone)]
pub struct DeviceContext {
    pub device_id: String,
    pub user_agent: Option<String>,
    pub ip_address: Option<IpAddr>,
}

impl DeviceContext {
    pub fn from_headers(headers: &HeaderMap, peer_ip: Option<IpAddr>) -> Result<Self, ApiError> {
        let device_id = headers
            .get(DEVICE_ID_HEADER)
            .and_then(|value| value.to_str().ok())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| ApiError::BadRequest("Missing device id".into()))?;

        Uuid::parse_str(device_id).map_err(|_| ApiError::BadRequest("Invalid device id".into()))?;

        let user_agent = headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.chars().take(MAX_USER_AGENT_LEN).collect());

        Ok(Self {
            device_id: device_id.to_owned(),
            user_agent,
            ip_address: peer_ip,
        })
    }

    pub fn matches_stored(&self, stored_device_id: &str, stored_user_agent: Option<&str>) -> bool {
        self.device_id == stored_device_id && self.user_agent.as_deref() == stored_user_agent
    }
}
