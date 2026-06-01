#[cfg(feature = "chatbot")]
mod ai;
mod commands;
mod database;
mod http_client;
mod net_client;
mod sql_client;
mod ws_client;
mod sse_client;

use tauri::Manager;
use tauri::Emitter;

/// Always-compiled feature probe. Returns whether this build of PostBoy
/// includes the chatbot feature. The frontend uses this to hide chatbot UI
/// entirely when the build was produced with `--no-default-features`.
#[tauri::command]
fn ai_supported() -> bool {
    cfg!(feature = "chatbot")
}

const UPDATE_SERVER: Option<&str> = option_env!("UPDATE_SERVER");
const UPDATE_TOKEN: Option<&str> = option_env!("UPDATE_TOKEN");

// ---------------------------------------------------------------------------
// Server mode helpers (plain HTTP to a LAN server)
// ---------------------------------------------------------------------------

async fn server_fetch_latest_json(server_url: &str) -> Result<serde_json::Value, String> {
    let url = format!("{}/latest.json", server_url.trim_end_matches('/'));
    reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to reach update server: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Invalid JSON from update server: {e}"))
}

// ---------------------------------------------------------------------------
// GitHub mode helpers (authenticated GitHub API for private repos)
// ---------------------------------------------------------------------------

async fn github_fetch_latest_json(token: &str) -> Result<(String, serde_json::Value), String> {
    let client = reqwest::Client::new();

    let release: serde_json::Value = client
        .get("https://api.github.com/repos/moodysaroha/postboy/releases/latest")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "PostBoy-Updater")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch release info: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {e}"))?;

    let assets = release["assets"]
        .as_array()
        .ok_or_else(|| "No assets found in the latest release".to_string())?;

    let latest_asset = assets
        .iter()
        .find(|a| a["name"].as_str() == Some("latest.json"))
        .ok_or_else(|| "latest.json asset not found in release".to_string())?;

    let asset_api_url = latest_asset["url"]
        .as_str()
        .ok_or_else(|| "Missing API URL for latest.json asset".to_string())?;

    let latest_json_text = client
        .get(asset_api_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/octet-stream")
        .header("User-Agent", "PostBoy-Updater")
        .send()
        .await
        .map_err(|e| format!("Failed to download latest.json: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Failed to read latest.json: {e}"))?;

    let latest_json: serde_json::Value = serde_json::from_str(&latest_json_text)
        .map_err(|e| format!("latest.json is not valid JSON: {e}"))?;

    Ok((latest_json_text, latest_json))
}

fn serve_json_locally(json_text: String) -> Result<u16, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to start local update server: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get server address: {e}"))?
        .port();

    std::thread::spawn(move || {
        use std::io::{Read, Write};
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = [0u8; 4096];
            let _ = stream.read(&mut buf);
            let body = json_text.as_bytes();
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(body);
        }
    });

    Ok(port)
}

// ---------------------------------------------------------------------------
// Shared: fetch version info from whichever source is configured
// ---------------------------------------------------------------------------

async fn fetch_update_info() -> Result<(serde_json::Value, Option<String>), String> {
    if let Some(server) = UPDATE_SERVER {
        let json = server_fetch_latest_json(server).await?;
        Ok((json, None))
    } else if let Some(token) = UPDATE_TOKEN {
        let (text, json) = github_fetch_latest_json(token).await?;
        Ok((json, Some(text)))
    } else {
        Err("No update source configured. Build with UPDATE_SERVER or UPDATE_TOKEN.".into())
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<String, String> {
    let (latest_json, _raw_text) = fetch_update_info().await?;

    let remote_version = latest_json["version"].as_str().unwrap_or("0.0.0");
    let current_version = app.package_info().version.to_string();
    let notes = latest_json["notes"].as_str().unwrap_or("").to_string();

    if remote_version != current_version {
        let _ = app.emit("update-available", serde_json::json!({
            "version": remote_version,
            "body": notes
        }));
        Ok(format!("Update available: v{remote_version}"))
    } else {
        Ok("App is up to date".into())
    }
}

#[tauri::command]
async fn perform_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;

    let _ = app.emit("update-status", "Fetching release info...");

    if let Some(server) = UPDATE_SERVER {
        // Server mode: Tauri updater fetches latest.json directly from the LAN server
        let endpoint = format!("{}/latest.json", server.trim_end_matches('/'));
        let endpoint_url = url::Url::parse(&endpoint)
            .map_err(|e| format!("Invalid server URL: {e}"))?;

        let _ = app.emit("update-status", "Downloading update...");

        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint_url])
            .map_err(|e| format!("Failed to set update endpoint: {e}"))?
            .build()
            .map_err(|e| format!("Failed to build updater: {e}"))?;

        let update = updater
            .check()
            .await
            .map_err(|e| format!("Update check failed: {e}"))?;

        let update = match update {
            Some(u) => u,
            None => return Err("Version is already up to date".into()),
        };

        let _ = app.emit("update-status", "Installing update...");
        update
            .download_and_install(|_chunk_len, _content_len| {}, || {})
            .await
            .map_err(|e| format!("Update installation failed: {e}"))?;
    } else if let Some(token) = UPDATE_TOKEN {
        // GitHub mode: fetch manifest via API, serve locally, then use Tauri updater
        let (latest_json_text, _) = github_fetch_latest_json(token).await?;

        let _ = app.emit("update-status", "Downloading update...");

        let port = serve_json_locally(latest_json_text)?;
        let local_endpoint = format!("http://127.0.0.1:{port}/latest.json");
        let endpoint_url = url::Url::parse(&local_endpoint).map_err(|e| e.to_string())?;

        let builder = app
            .updater_builder()
            .endpoints(vec![endpoint_url])
            .map_err(|e| format!("Failed to set update endpoint: {e}"))?;
        let builder = builder
            .header("Authorization", &format!("Bearer {token}"))
            .map_err(|e| format!("Failed to set auth header: {e}"))?;
        let builder = builder
            .header("User-Agent", "PostBoy-Updater")
            .map_err(|e| format!("Failed to set user-agent header: {e}"))?;

        let updater = builder
            .build()
            .map_err(|e| format!("Failed to build updater: {e}"))?;
        let update = updater
            .check()
            .await
            .map_err(|e| format!("Update verification failed: {e}"))?;

        let update = match update {
            Some(u) => u,
            None => return Err("Version is already up to date".into()),
        };

        let _ = app.emit("update-status", "Installing update...");
        update
            .download_and_install(|_chunk_len, _content_len| {}, || {})
            .await
            .map_err(|e| format!("Update installation failed: {e}"))?;
    } else {
        return Err("No update source configured. Build with UPDATE_SERVER or UPDATE_TOKEN.".into());
    }

    app.restart();
    #[allow(unreachable_code)]
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:postboy.db", database::get_migrations())
                .build()
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(feature = "chatbot")]
    let builder = builder.manage(ai::AiState::new());

    builder
        .setup(|app| {
            use tauri::WebviewWindowBuilder;
            use tauri::WebviewUrl;
            
            // Get main window handle (devtools feature in Cargo.toml enables Ctrl+Shift+I in production)
            let main_window = app.get_webview_window("main").expect("Failed to get main window");
            
            // Create splashscreen window with inline HTML
            let splashscreen = WebviewWindowBuilder::new(
                app,
                "splashscreen",
                WebviewUrl::App("splashscreen.html".into())
            )
            .title("PostBoy")
            .inner_size(500.0, 400.0)
            .resizable(false)
            .decorations(false)
            .always_on_top(true)
            .center()
            .skip_taskbar(true)
            .build()
            .expect("Failed to create splashscreen window");
            
            // Clone for the async task
            let main_window_clone = main_window.clone();
            let splashscreen_clone = splashscreen.clone();
            
            // Spawn initialization task
            tauri::async_runtime::spawn(async move {
                // Initialize database with migrations
                let app_handle = main_window_clone.app_handle();
                let app_data_dir = app_handle.path().app_data_dir()
                    .expect("Failed to get app data dir");
                
                std::fs::create_dir_all(&app_data_dir)
                    .expect("Failed to create app data directory");
                
                let db_path = app_data_dir.join("postboy.db");
                
                database::initialize_database(db_path)
                    .expect("Failed to initialize database");
                
                println!("PostBoy app initialized successfully");
                
                // Wait a moment for visual effect
                std::thread::sleep(std::time::Duration::from_millis(2500));
                
                // Show main window and close splashscreen
                main_window_clone.show().expect("Failed to show main window");
                splashscreen_clone.close().expect("Failed to close splashscreen");
            });

            // Check for updates on startup
            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if UPDATE_SERVER.is_none() && UPDATE_TOKEN.is_none() {
                    eprintln!("No update source configured — skipping update check");
                    return;
                }

                let (latest_json, _raw) = match fetch_update_info().await {
                    Ok(v) => v,
                    Err(e) => { eprintln!("Startup update check failed: {e}"); return; }
                };

                let remote_version = latest_json["version"].as_str().unwrap_or("0.0.0");
                let current_version = update_handle.package_info().version.to_string();
                let notes = latest_json["notes"].as_str().unwrap_or("").to_string();

                let source = if UPDATE_SERVER.is_some() { "server" } else { "github" };
                println!("[{source}] Current: v{current_version}, Remote: v{remote_version}");

                if remote_version != current_version {
                    let _ = update_handle.emit("update-available", serde_json::json!({
                        "version": remote_version,
                        "body": notes
                    }));
                } else {
                    println!("App is up to date");
                }
            });

            Ok(())
        })
        .invoke_handler({
            #[cfg(feature = "chatbot")]
            {
                tauri::generate_handler![
                    ai_supported,
                    commands::get_version,
                    commands::get_update_token,
                    check_for_update,
                    perform_update,
                    http_client::execute_http_request,
                    commands::db_create_collection,
                    commands::db_get_collections,
                    commands::db_get_collection,
                    commands::db_update_collection,
                    commands::db_delete_collection,
                    commands::db_create_request,
                    commands::db_get_requests,
                    commands::db_get_request,
                    commands::db_update_request,
                    commands::db_delete_request,
                    commands::db_add_history,
                    commands::db_get_history,
                    commands::db_delete_history,
                    commands::db_clear_history,
                    commands::db_set_setting,
                    commands::db_get_setting,
                    commands::db_get_all_settings,
                    commands::db_export_collections,
                    commands::db_import_collections,
                    commands::show_save_dialog,
                    commands::show_open_dialog,
                    commands::write_file,
                    commands::read_file,
                    commands::read_file_base64,
                    commands::db_get_variables,
                    commands::db_set_variable,
                    commands::db_delete_variable,
                    commands::db_clear_variables,
                    commands::db_rename_collection,
                    commands::db_rename_request,
                    commands::db_reorder_requests,
                    commands::db_move_request,
                    commands::db_export_single_collection,
                    commands::db_import_single_collection,
                    commands::db_create_folder,
                    commands::db_move_collection,
                    ws_client::ws_connect,
                    ws_client::ws_send,
                    ws_client::ws_disconnect,
                    sse_client::sse_connect,
                    sse_client::sse_disconnect,
                    commands::db_get_cookies,
                    commands::db_get_cookies_for_url,
                    commands::db_set_cookie,
                    commands::db_delete_cookie,
                    commands::db_clear_cookies,
                    commands::db_clear_all_cookies,
                    sql_client::sql_connect,
                    sql_client::sql_query,
                    sql_client::sql_disconnect,
                    net_client::dns_resolve,
                    net_client::port_check,
                    net_client::ping_host,
                    net_client::trace_route,
                    ai::commands::ai_get_status,
                    ai::commands::ai_list_models,
                    ai::commands::ai_list_installed,
                    ai::commands::ai_download_model,
                    ai::commands::ai_cancel_download,
                    ai::commands::ai_pause_download,
                    ai::commands::ai_resume_download,
                    ai::commands::ai_delete_model,
                    ai::commands::ai_load_engine,
                    ai::commands::ai_unload_engine,
                    ai::commands::ai_chat_send,
                    ai::commands::ai_chat_cancel,
                    ai::commands::ai_get_action_log,
                    ai::commands::ai_clear_action_log,
                    ai::commands::ai_list_chats,
                    ai::commands::ai_get_chat,
                    ai::commands::ai_save_chat,
                    ai::commands::ai_delete_chat,
                    ai::commands::ai_delete_all_chats,
                    ai::commands::ai_get_suggestion_corpus,
                ]
            }
            #[cfg(not(feature = "chatbot"))]
            {
                tauri::generate_handler![
                    ai_supported,
                    commands::get_version,
                    commands::get_update_token,
                    check_for_update,
                    perform_update,
                    http_client::execute_http_request,
                    commands::db_create_collection,
                    commands::db_get_collections,
                    commands::db_get_collection,
                    commands::db_update_collection,
                    commands::db_delete_collection,
                    commands::db_create_request,
                    commands::db_get_requests,
                    commands::db_get_request,
                    commands::db_update_request,
                    commands::db_delete_request,
                    commands::db_add_history,
                    commands::db_get_history,
                    commands::db_delete_history,
                    commands::db_clear_history,
                    commands::db_set_setting,
                    commands::db_get_setting,
                    commands::db_get_all_settings,
                    commands::db_export_collections,
                    commands::db_import_collections,
                    commands::show_save_dialog,
                    commands::show_open_dialog,
                    commands::write_file,
                    commands::read_file,
                    commands::read_file_base64,
                    commands::db_get_variables,
                    commands::db_set_variable,
                    commands::db_delete_variable,
                    commands::db_clear_variables,
                    commands::db_rename_collection,
                    commands::db_rename_request,
                    commands::db_reorder_requests,
                    commands::db_move_request,
                    commands::db_export_single_collection,
                    commands::db_import_single_collection,
                    commands::db_create_folder,
                    commands::db_move_collection,
                    ws_client::ws_connect,
                    ws_client::ws_send,
                    ws_client::ws_disconnect,
                    sse_client::sse_connect,
                    sse_client::sse_disconnect,
                    commands::db_get_cookies,
                    commands::db_get_cookies_for_url,
                    commands::db_set_cookie,
                    commands::db_delete_cookie,
                    commands::db_clear_cookies,
                    commands::db_clear_all_cookies,
                    sql_client::sql_connect,
                    sql_client::sql_query,
                    sql_client::sql_disconnect,
                    net_client::dns_resolve,
                    net_client::port_check,
                    net_client::ping_host,
                    net_client::trace_route,
                ]
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
