use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    #[serde(rename = "statusText")]
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    #[serde(rename = "responseTime")]
    pub response_time: u64,
    #[serde(rename = "contentType")]
    pub content_type: Option<String>,
    #[serde(rename = "isBinary")]
    pub is_binary: bool,
}

fn is_binary_content_type(content_type: &str) -> bool {
    let ct = content_type.to_lowercase();
    ct.starts_with("image/")
        || ct.starts_with("audio/")
        || ct.starts_with("video/")
        || ct.starts_with("font/")
        || ct == "application/pdf"
        || ct == "application/zip"
        || ct == "application/gzip"
        || ct == "application/octet-stream"
        || ct == "application/wasm"
        || ct.starts_with("application/vnd.")
        || ct.contains("protobuf")
}

/// Render an error and every error returned by `.source()` joined with `: ` so
/// the actual underlying cause (DNS lookup failure, TLS handshake error, TCP
/// refusal, proxy failure, …) reaches the caller. reqwest wraps everything in
/// a generic "error sending request for url (…)" by default and `to_string()`
/// alone drops the source chain.
fn format_error_chain<E: std::error::Error + 'static>(err: E) -> String {
    let mut out = err.to_string();
    let mut src: Option<&dyn std::error::Error> = err.source();
    while let Some(s) = src {
        let msg = s.to_string();
        if !msg.is_empty() && !out.ends_with(&msg) {
            out.push_str(": ");
            out.push_str(&msg);
        }
        src = s.source();
    }
    out
}

pub async fn execute_request(
    request: HttpRequest,
    timeout_secs: Option<u64>,
    proxy_url: Option<String>,
    ssl_verify: Option<bool>,
    follow_redirects: Option<bool>,
    max_redirects: Option<usize>,
) -> Result<HttpResponse, String> {
    let start = Instant::now();
    
    let mut builder = reqwest::Client::builder()
        .danger_accept_invalid_certs(!ssl_verify.unwrap_or(false))
        .timeout(std::time::Duration::from_secs(timeout_secs.unwrap_or(30)));

    if let Some(ref proxy) = proxy_url {
        if !proxy.is_empty() {
            builder = builder.proxy(reqwest::Proxy::all(proxy).map_err(|e| e.to_string())?);
        }
    }

    if let Some(false) = follow_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::none());
    } else if let Some(max) = max_redirects {
        builder = builder.redirect(reqwest::redirect::Policy::limited(max));
    }

    let client = builder.build().map_err(|e| e.to_string())?;
    
    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "DELETE" => reqwest::Method::DELETE,
        "PATCH" => reqwest::Method::PATCH,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return Err(format!("Unsupported HTTP method: {}", request.method)),
    };
    
    let mut req_builder = client.request(method, &request.url);
    
    // Add headers
    if let Some(headers) = request.headers {
        for (key, value) in headers {
            req_builder = req_builder.header(key, value);
        }
    }
    
    // Add body
    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }
    
    // Execute request
    let response = req_builder.send().await.map_err(format_error_chain)?;
    
    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("Unknown").to_string();
    
    // Extract headers
    let mut headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(value_str) = value.to_str() {
            headers.insert(key.to_string(), value_str.to_string());
        }
    }
    
    let content_type = headers
        .get("content-type")
        .cloned()
        .or_else(|| headers.get("Content-Type").cloned());
    let is_binary = content_type
        .as_ref()
        .map(|ct| is_binary_content_type(ct))
        .unwrap_or(false);

    let body = if is_binary {
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    } else {
        response.text().await.map_err(|e| e.to_string())?
    };

    let response_time = start.elapsed().as_millis() as u64;

    Ok(HttpResponse {
        status,
        status_text,
        headers,
        body,
        response_time,
        content_type,
        is_binary,
    })
}

#[tauri::command]
pub async fn execute_http_request(
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_secs: Option<u64>,
    proxy_url: Option<String>,
    ssl_verify: Option<bool>,
    follow_redirects: Option<bool>,
    max_redirects: Option<usize>,
) -> Result<HttpResponse, String> {
    let request = HttpRequest {
        method,
        url,
        headers,
        body,
    };
    
    execute_request(request, timeout_secs, proxy_url, ssl_verify, follow_redirects, max_redirects).await
}
