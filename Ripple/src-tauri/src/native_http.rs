use base64::Engine;
use curl::easy::{Auth, Easy, List};
use serde_json::Value;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::time::Instant;

use crate::http_client::{HttpRequest, HttpResponse, is_binary_content_type};

fn json_str(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

fn configure_ntlm(easy: &mut Easy, data: &Value) -> Result<(), String> {
    let username = json_str(data, "username").filter(|s| !s.is_empty());
    let password = json_str(data, "password").unwrap_or_default();
    let domain = json_str(data, "domain").filter(|s| !s.is_empty());

    if username.is_none() {
        return Err("NTLM username is required".into());
    }

    easy.http_auth(Auth::new().ntlm(true))
        .map_err(|e| format!("NTLM auth setup failed: {e}"))?;

    let user = match (&domain, &username) {
        (Some(d), Some(u)) => format!("{d}\\{u}"),
        (_, Some(u)) => u.clone(),
        _ => unreachable!(),
    };
    easy.username(&user)
        .map_err(|e| format!("NTLM username failed: {e}"))?;
    easy.password(&password)
        .map_err(|e| format!("NTLM password failed: {e}"))?;
    Ok(())
}

fn configure_client_cert(easy: &mut Easy, data: &Value) -> Result<(), String> {
    let pfx_path = json_str(data, "pfxPath");
    let cert_path = json_str(data, "certPath");
    let key_path = json_str(data, "keyPath");
    let passphrase = json_str(data, "passphrase").unwrap_or_default();

    if let Some(pfx) = pfx_path.filter(|s| !s.is_empty()) {
        easy.ssl_cert(&pfx)
            .map_err(|e| format!("Client cert (PFX) failed: {e}"))?;
        easy.ssl_cert_type("P12")
            .map_err(|e| format!("PFX type failed: {e}"))?;
        if !passphrase.is_empty() {
            easy.key_password(&passphrase)
                .map_err(|e| format!("PFX passphrase failed: {e}"))?;
        }
        return Ok(());
    }

    let cert = cert_path.filter(|s| !s.is_empty());
    let key = key_path.filter(|s| !s.is_empty());
    match (cert, key) {
        (Some(cert), Some(key)) => {
            easy.ssl_cert(&cert)
                .map_err(|e| format!("Client cert failed: {e}"))?;
            easy.ssl_key(&key)
                .map_err(|e| format!("Client key failed: {e}"))?;
            if !passphrase.is_empty() {
                easy.key_password(&passphrase)
                    .map_err(|e| format!("Key passphrase failed: {e}"))?;
            }
            Ok(())
        }
        _ => Err("Mutual TLS requires a PFX/P12 file or both certificate and private key paths".into()),
    }
}

pub fn execute_native_request(
    request: HttpRequest,
    timeout_secs: u64,
    ssl_verify: bool,
    auth_type: &str,
    auth_data: &Value,
) -> Result<HttpResponse, String> {
    let start = Instant::now();
    let mut easy = Easy::new();

    easy.url(&request.url)
        .map_err(|e| format!("Invalid URL: {e}"))?;
    easy.timeout(std::time::Duration::from_secs(timeout_secs))
        .map_err(|e| e.to_string())?;
    easy.follow_location(true)
        .map_err(|e| e.to_string())?;
    easy.ssl_verify_peer(ssl_verify)
        .map_err(|e| e.to_string())?;
    easy.ssl_verify_host(ssl_verify)
        .map_err(|e| e.to_string())?;

    match auth_type {
        "ntlm" => configure_ntlm(&mut easy, auth_data)?,
        "client-cert" => configure_client_cert(&mut easy, auth_data)?,
        other => return Err(format!("Unsupported native auth type: {other}")),
    }

    let method = request.method.to_uppercase();
    if method != "GET" {
        easy.custom_request(&method)
            .map_err(|e| format!("HTTP method failed: {e}"))?;
    }

    let mut header_list = List::new();
    let mut header_count = 0usize;
    if let Some(headers) = &request.headers {
        for (key, value) in headers {
            if key.eq_ignore_ascii_case("content-length") {
                continue;
            }
            header_list
                .append(&format!("{key}: {value}"))
                .map_err(|e| e.to_string())?;
            header_count += 1;
        }
    }
    if header_count > 0 {
        easy.http_headers(header_list)
            .map_err(|e| format!("Headers failed: {e}"))?;
    }

    let body_bytes = request
        .body
        .as_ref()
        .map(|b| b.as_bytes().to_vec())
        .unwrap_or_default();
    if !body_bytes.is_empty() {
        if method == "POST" {
            easy.post(true).map_err(|e| e.to_string())?;
            easy.post_fields_copy(&body_bytes)
                .map_err(|e| format!("Request body failed: {e}"))?;
        } else {
            let mut upload = std::io::Cursor::new(body_bytes);
            easy.upload(true).map_err(|e| e.to_string())?;
            easy.in_filesize(upload.get_ref().len() as u64)
                .map_err(|e| e.to_string())?;
            easy.read_function(move |buf| {
                match upload.read(buf) {
                    Ok(0) => Err(curl::easy::ReadError::Abort),
                    Ok(n) => Ok(n),
                    Err(_) => Err(curl::easy::ReadError::Abort),
                }
            })
            .map_err(|e| format!("Request body failed: {e}"))?;
        }
    }

    let mut response_body = Vec::<u8>::new();
    let mut response_headers = HashMap::new();
    {
        let mut transfer = easy.transfer();
        transfer
            .header_function(|data| {
                if let Ok(line) = std::str::from_utf8(data) {
                    if let Some((key, value)) = line.split_once(':') {
                        response_headers.insert(
                            key.trim().to_string(),
                            value.trim().to_string(),
                        );
                    }
                }
                true
            })
            .map_err(|e| e.to_string())?;
        transfer
            .write_function(|data| {
                response_body
                    .write_all(data)
                    .map(|_| data.len())
                    .map_err(|_| curl::easy::WriteError::Pause)
            })
            .map_err(|e| e.to_string())?;
        transfer.perform().map_err(|e| e.to_string())?;
    }

    let status = easy.response_code().map_err(|e| e.to_string())? as u16;
    let status_text = match status {
        200..=299 => "OK",
        301 | 302 | 303 | 307 | 308 => "Redirect",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        500 => "Internal Server Error",
        _ => "Unknown",
    }
    .to_string();

    let content_type = response_headers
        .iter()
        .find(|(k, _)| k.eq_ignore_ascii_case("content-type"))
        .map(|(_, v)| v.clone());
    let is_binary = content_type
        .as_ref()
        .map(|ct| is_binary_content_type(ct))
        .unwrap_or(false);

    let body = if is_binary {
        base64::engine::general_purpose::STANDARD.encode(&response_body)
    } else {
        String::from_utf8_lossy(&response_body).into_owned()
    };

    Ok(HttpResponse {
        status,
        status_text,
        headers: response_headers,
        body,
        response_time: start.elapsed().as_millis() as u64,
        content_type,
        is_binary,
    })
}
