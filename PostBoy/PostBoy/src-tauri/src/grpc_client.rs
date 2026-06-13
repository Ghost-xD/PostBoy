use std::collections::HashMap;
use std::time::Instant;

use granc_core::client::{DynamicRequest, DynamicResponse, GrancClient};
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn normalize_grpc_addr(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("gRPC server address is required".into());
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Ok(trimmed.to_string());
    }
    if trimmed.starts_with("grpc://") {
        return Ok(trimmed.replacen("grpc://", "http://", 1));
    }
    if trimmed.starts_with("grpcs://") {
        return Ok(trimmed.replacen("grpcs://", "https://", 1));
    }
    Ok(format!("http://{trimmed}"))
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GrpcInvokeResponse {
    pub status: u16,
    #[serde(rename = "statusText")]
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    #[serde(rename = "responseTime")]
    pub response_time: u64,
}

#[tauri::command]
pub async fn grpc_list_services(address: String) -> Result<Vec<String>, String> {
    let addr = normalize_grpc_addr(&address)?;
    let mut client = GrancClient::connect(&addr)
        .await
        .map_err(|e| format!("gRPC connect failed: {e}"))?;
    client
        .list_services()
        .await
        .map_err(|e| format!("Reflection failed: {e}"))
}

#[tauri::command]
pub async fn grpc_invoke(
    address: String,
    service: String,
    method: String,
    metadata: Option<HashMap<String, String>>,
    body_json: Option<String>,
) -> Result<GrpcInvokeResponse, String> {
    let addr = normalize_grpc_addr(&address)?;
    let start = Instant::now();
    let mut client = GrancClient::connect(&addr)
        .await
        .map_err(|e| format!("gRPC connect failed: {e}"))?;

    let body: Value = match body_json.as_deref() {
        Some(s) if !s.trim().is_empty() => {
            serde_json::from_str(s).map_err(|e| format!("Invalid JSON body: {e}"))?
        }
        _ => Value::Object(serde_json::Map::new()),
    };

    let headers: Vec<(String, String)> = metadata.unwrap_or_default().into_iter().collect();

    let request = DynamicRequest {
        service: service.clone(),
        method: method.clone(),
        body,
        headers,
    };

    let response = client
        .dynamic(request)
        .await
        .map_err(|e| format!("gRPC call failed: {e}"))?;

    let elapsed = start.elapsed().as_millis() as u64;

    match response {
        DynamicResponse::Unary(result) => match result {
            Ok(body) => {
                let body_str =
                    serde_json::to_string_pretty(&body).unwrap_or_else(|_| body.to_string());
                Ok(GrpcInvokeResponse {
                    status: 200,
                    status_text: "OK".into(),
                    headers: HashMap::new(),
                    body: body_str,
                    response_time: elapsed,
                })
            }
            Err(status) => Err(format!(
                "gRPC error {}: {}",
                status.code(),
                status.message()
            )),
        },
        DynamicResponse::Streaming(_) => Err(
            "Server streaming responses are not yet supported in Ripple UI (unary only)".into(),
        ),
    }
}

#[tauri::command]
pub async fn grpc_describe_service(
    address: String,
    service: String,
) -> Result<Vec<String>, String> {
    let addr = normalize_grpc_addr(&address)?;
    let mut client = GrancClient::connect(&addr)
        .await
        .map_err(|e| format!("gRPC connect failed: {e}"))?;

    let descriptor = client
        .get_descriptor_by_symbol(&service)
        .await
        .map_err(|e| format!("Service lookup failed: {e}"))?;

    let svc = descriptor
        .service_descriptor()
        .ok_or_else(|| format!("Symbol is not a service: {service}"))?;

    Ok(svc
        .methods()
        .map(|m| m.name().to_string())
        .collect())
}
