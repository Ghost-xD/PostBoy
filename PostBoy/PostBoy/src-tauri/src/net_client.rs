use serde::Serialize;
use std::net::ToSocketAddrs;
use std::time::Instant;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};

#[derive(Serialize)]
pub struct DnsResult {
    pub hostname: String,
    pub addresses: Vec<String>,
    pub duration_ms: u64,
}

#[derive(Serialize)]
pub struct PortCheckResult {
    pub host: String,
    pub port: u16,
    pub open: bool,
    pub duration_ms: u64,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct PingResult {
    pub host: String,
    pub ip: String,
    pub reachable: bool,
    pub latency_ms: Option<f64>,
    pub error: Option<String>,
}

#[derive(Serialize)]
pub struct TraceHop {
    pub hop: u8,
    pub ip: Option<String>,
    pub hostname: Option<String>,
    pub latency_ms: Option<f64>,
    pub timed_out: bool,
}

#[derive(Serialize)]
pub struct TraceResult {
    pub target: String,
    pub hops: Vec<TraceHop>,
    pub duration_ms: u64,
}

#[tauri::command]
pub async fn dns_resolve(hostname: String) -> Result<DnsResult, String> {
    let host = hostname.clone();
    let start = Instant::now();

    let result = tokio::task::spawn_blocking(move || {
        format!("{}:0", host)
            .to_socket_addrs()
            .map(|addrs| addrs.map(|a| a.ip().to_string()).collect::<Vec<_>>())
    })
    .await
    .map_err(|e| format!("DNS resolution task failed: {e}"))?
    .map_err(|e| format!("DNS resolution failed: {e}"))?;

    // Deduplicate addresses while preserving order
    let mut seen = std::collections::HashSet::new();
    let addresses: Vec<String> = result.into_iter().filter(|a| seen.insert(a.clone())).collect();

    if addresses.is_empty() {
        return Err(format!("DNS resolution failed: no addresses found for {hostname}"));
    }

    Ok(DnsResult {
        hostname,
        addresses,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn port_check(host: String, port: u16, timeout_secs: Option<u64>) -> Result<PortCheckResult, String> {
    let dur = Duration::from_secs(timeout_secs.unwrap_or(5));
    let addr = format!("{}:{}", host, port);
    let start = Instant::now();

    match timeout(dur, TcpStream::connect(&addr)).await {
        Ok(Ok(_stream)) => Ok(PortCheckResult {
            host,
            port,
            open: true,
            duration_ms: start.elapsed().as_millis() as u64,
            error: None,
        }),
        Ok(Err(e)) => Ok(PortCheckResult {
            host,
            port,
            open: false,
            duration_ms: start.elapsed().as_millis() as u64,
            error: Some(format!("{e}")),
        }),
        Err(_) => Ok(PortCheckResult {
            host,
            port,
            open: false,
            duration_ms: start.elapsed().as_millis() as u64,
            error: Some("Connection timed out".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn ping_host(host: String) -> Result<PingResult, String> {
    let addr_str = format!("{}:0", host);
    let ip = tokio::task::spawn_blocking(move || {
        addr_str.to_socket_addrs()
            .ok()
            .and_then(|mut addrs| addrs.next())
            .map(|a| a.ip())
    })
    .await
    .map_err(|e| format!("Resolve failed: {e}"))?
    .ok_or_else(|| format!("Could not resolve host: {host}"))?;

    let ip_str = ip.to_string();
    let start = Instant::now();

    // Try ICMP ping (requires admin/raw socket on Windows)
    match surge_ping::ping(ip, &[0u8; 8]).await {
        Ok((_packet, dur)) => Ok(PingResult {
            host,
            ip: ip_str,
            reachable: true,
            latency_ms: Some(dur.as_secs_f64() * 1000.0),
            error: None,
        }),
        Err(e) => {
            // Fallback: TCP connect to port 80 as a "ping" proxy
            let tcp_addr = format!("{}:80", ip_str);
            match timeout(Duration::from_secs(5), TcpStream::connect(&tcp_addr)).await {
                Ok(Ok(_)) => Ok(PingResult {
                    host,
                    ip: ip_str,
                    reachable: true,
                    latency_ms: Some(start.elapsed().as_secs_f64() * 1000.0),
                    error: Some(format!("ICMP failed ({e}), used TCP fallback on port 80")),
                }),
                _ => Ok(PingResult {
                    host,
                    ip: ip_str,
                    reachable: false,
                    latency_ms: None,
                    error: Some(format!("ICMP: {e}; TCP fallback on port 80 also failed")),
                }),
            }
        }
    }
}

#[tauri::command]
pub async fn trace_route(host: String) -> Result<TraceResult, String> {
    let start = Instant::now();

    let cmd = if cfg!(target_os = "windows") { "tracert" } else { "traceroute" };
    let args: Vec<&str> = if cfg!(target_os = "windows") {
        vec!["-d", "-w", "3000", "-h", "30", &host]
    } else {
        vec!["-n", "-w", "3", "-m", "30", &host]
    };

    let output = tokio::process::Command::new(cmd)
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run {cmd}: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let hops = parse_trace_output(&stdout);

    Ok(TraceResult {
        target: host,
        hops,
        duration_ms: start.elapsed().as_millis() as u64,
    })
}

fn parse_trace_output(output: &str) -> Vec<TraceHop> {
    let mut hops = Vec::new();

    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        // Match lines that start with a hop number (1-30)
        let parts: Vec<&str> = trimmed.split_whitespace().collect();
        if parts.is_empty() {
            continue;
        }

        let hop_num: u8 = match parts[0].parse() {
            Ok(n) if n >= 1 => n,
            _ => continue,
        };

        // Check if all probes timed out
        if trimmed.contains("Request timed out") || parts.iter().all(|p| *p == "*" || p.parse::<u8>().is_ok()) {
            hops.push(TraceHop {
                hop: hop_num,
                ip: None,
                hostname: None,
                latency_ms: None,
                timed_out: true,
            });
            continue;
        }

        // Parse IP and latency from the remaining tokens
        let mut ip = None;
        let mut latency = None;

        for (i, part) in parts.iter().enumerate().skip(1) {
            // IP address pattern
            if ip.is_none() && part.contains('.') && part.chars().all(|c| c.is_ascii_digit() || c == '.') {
                ip = Some(part.to_string());
            }
            // Latency: a number followed by "ms"
            if latency.is_none() {
                if let Ok(ms) = part.replace("ms", "").trim().parse::<f64>() {
                    if i + 1 < parts.len() && parts[i + 1] == "ms" {
                        latency = Some(ms);
                    } else if part.ends_with("ms") {
                        latency = Some(ms);
                    } else if part.parse::<f64>().is_ok() && i + 1 < parts.len() && parts[i + 1] == "ms" {
                        latency = Some(ms);
                    }
                }
            }
        }

        hops.push(TraceHop {
            hop: hop_num,
            ip: ip.clone(),
            hostname: ip,
            latency_ms: latency,
            timed_out: false,
        });
    }

    hops
}
