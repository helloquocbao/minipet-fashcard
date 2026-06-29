use crate::pet::manager::{PetInstance, PetListItem, UserSettings};
use crate::pet::pomodoro::PomodoroState;
use crate::AppState;
use tauri::{AppHandle, Emitter, Manager, State};
// --- Pet Commands ---

#[tauri::command]
pub async fn get_installed_pets(state: State<'_, AppState>) -> Result<Vec<PetListItem>, String> {
    let mgr = state.pet_manager.lock().await;
    Ok(mgr.get_installed_pets())
}

#[tauri::command]
pub async fn get_pet_instance_config(
    state: State<'_, AppState>,
    instance_id: String,
) -> Result<serde_json::Value, String> {
    let mgr = state.pet_manager.lock().await;
    mgr.get_pet_instance_config(&instance_id).await
        .ok_or_else(|| "Instance not found".to_string())
}

#[tauri::command]
pub async fn spawn_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    slug: String,
) -> Result<PetInstance, String> {
    let mut mgr = state.pet_manager.lock().await;
    let instance = mgr.spawn_pet(&slug).await?;

    // Check if there's already an overlay window running
    let existing_windows: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|k| k.starts_with("overlay-"))
        .cloned()
        .collect();

    if existing_windows.is_empty() {
        // No window exists — create fresh
        crate::window::overlay::create(&app, &instance.id, instance.x, instance.y)?;
    } else {
        // Window already exists — just notify it to reload the new pet config.
        // This avoids destroy+create which causes a visible blank flash.
        // The overlay JS will handle reloading spritesheet via settings:update.
    }

    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(instance)
}

#[tauri::command]
pub async fn remove_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    instance_id: String,
) -> Result<(), String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.remove_pet(&instance_id).await?;
    crate::window::overlay::destroy(&app, &instance_id);
    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(())
}

#[tauri::command]
pub async fn get_spritesheet_url(
    state: State<'_, AppState>,
    slug: String,
) -> Result<String, String> {
    let mgr = state.pet_manager.lock().await;
    mgr.get_spritesheet_url(&slug)
        .ok_or_else(|| "Pet not found".to_string())
}

#[tauri::command]
pub async fn get_spritesheet_data(
    state: State<'_, AppState>,
    slug: String,
) -> Result<String, String> {
    let mgr = state.pet_manager.lock().await;
    let path = mgr
        .get_spritesheet_path(&slug)
        .ok_or_else(|| "Pet not found".to_string())?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("webp");
    let mime = if ext == "png" {
        "image/png"
    } else {
        "image/webp"
    };
    Ok(format!("data:{};base64,{}", mime, base64_encode(&bytes)))
}

fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = if chunk.len() > 1 {
            chunk[1] as usize
        } else {
            0
        };
        let b2 = if chunk.len() > 2 {
            chunk[2] as usize
        } else {
            0
        };
        out.push(CHARS[b0 >> 2] as char);
        out.push(CHARS[((b0 & 3) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 {
            CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            CHARS[b2 & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

// --- Settings Commands ---

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<UserSettings, String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.load_settings().await;
    Ok(mgr.get_settings())
}

#[tauri::command]
pub async fn update_settings(
    state: State<'_, AppState>,
    app: AppHandle,
    settings: serde_json::Value,
) -> Result<(), String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.update_settings(settings.clone()).await;

    let updated = mgr.get_settings();
    let _ = app.emit("settings:update", updated.clone());
    drop(mgr);

    // Re-apply the global translation hotkey when its settings change.
    #[cfg(desktop)]
    crate::translate::sync_global_shortcut(&app, updated.translate_enabled, &updated.translate_mode);

    Ok(())
}

/// Translate an arbitrary piece of text and show it on the pet (used by the
/// "Test" button in Settings).
#[tauri::command]
pub async fn translate_test(app: AppHandle, text: String) -> Result<(), String> {
    crate::translate::translate_and_say(&app, &text).await;
    Ok(())
}

// --- Window Commands ---

#[tauri::command]
pub async fn save_position(
    state: State<'_, AppState>,
    app: AppHandle,
    instance_id: String,
    x: f64,
    y: f64,
) -> Result<(), String> {
    let mut mgr = state.pet_manager.lock().await;
    mgr.update_instance_position(&instance_id, x, y).await;
    let positions = mgr.get_positions();
    let _ = app.emit("pets:positions-updated", positions);
    Ok(())
}

#[tauri::command]
pub fn resize_window_keep_bottom(
    app: AppHandle,
    instance_id: String,
    width: f64,
    height: f64,
) -> Result<tauri::LogicalPosition<f64>, String> {
    crate::window::overlay::resize_keep_bottom(&app, &instance_id, width, height)
}

#[tauri::command]
pub fn toggle_visibility(app: AppHandle) -> Result<(), String> {
    let mut visible = true;
    // Check first pet window to determine current state
    if let Some(win) = app
        .webview_windows()
        .values()
        .find(|w| w.label().starts_with("overlay-"))
    {
        visible = !win.is_visible().unwrap_or(true);
    }

    for window in app.webview_windows().values() {
        let label = window.label();
        if label.starts_with("overlay-") {
            if visible {
                let _ = window.show();
            } else {
                let _ = window.hide();
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn exit_app(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut process_lock = state.llama_process.lock().await;
    if let Some(mut child) = process_lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn set_drag_mode(app: AppHandle, instance_id: String, enabled: bool) {
    crate::window::overlay::set_drag_mode(&app, &instance_id, enabled);
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> Result<(), String> {
    crate::window::settings::open(&app)
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http:// and https:// URLs are allowed for security reasons.".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}



// --- File Eating ---

#[tauri::command]
pub async fn eat_files(state: State<'_, AppState>, paths: Vec<String>) -> Result<(), String> {
    let mgr = state.pet_manager.lock().await;
    mgr.eat_files(paths).await
}

// --- Pet Import/Delete ---

#[tauri::command]
pub async fn import_pet(
    state: State<'_, AppState>,
    app: AppHandle,
    source_path: String,
) -> Result<Vec<PetListItem>, String> {
    let mut mgr = state.pet_manager.lock().await;
    let result = mgr.import_pet(&source_path).await?;
    let _ = app.emit("settings:update", mgr.get_settings());
    Ok(result)
}



// --- Pomodoro Commands ---

#[tauri::command]
pub async fn pomo_get_state(state: State<'_, AppState>) -> Result<PomodoroState, String> {
    let s = state.pomo_state.lock().await;
    Ok(s.clone())
}

#[tauri::command]
pub async fn pomo_start(
    state: State<'_, AppState>,
    app: AppHandle,
    focus: i32,
    #[allow(non_snake_case)] breakMin: i32,
) -> Result<(), String> {
    if focus <= 0 || focus > 120 || breakMin < 0 || breakMin > 60 {
        return Err("Invalid pomodoro parameters".to_string());
    }
    let mut pomo = state.pomodoro.lock().await;
    pomo.start(focus, breakMin, state.pomo_state.clone(), app);
    Ok(())
}

#[tauri::command]
pub async fn pomo_pause(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut pomo = state.pomodoro.lock().await;
    pomo.pause(&state.pomo_state, &app).await;
    Ok(())
}

#[tauri::command]
pub async fn pomo_reset(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut pomo = state.pomodoro.lock().await;
    pomo.reset(&state.pomo_state, &app).await;
    Ok(())
}

#[tauri::command]
pub async fn pomo_update_config(
    state: State<'_, AppState>,
    app: AppHandle,
    focus: i32,
    #[allow(non_snake_case)] breakMin: i32,
) -> Result<(), String> {
    if focus <= 0 || focus > 120 || breakMin < 0 || breakMin > 60 {
        return Err("Invalid pomodoro parameters".to_string());
    }
    let mut pomo = state.pomodoro.lock().await;
    pomo.update_config(focus, breakMin, &state.pomo_state, &app).await;
    Ok(())
}

// --- Broadcast Commands ---

#[tauri::command]
pub fn broadcast_pet_event(app: AppHandle, event: String, payload: serde_json::Value) {
    let allowed_static = [
        "pet:start-alarm", "pomo:tick", "pomo:finished", "pet:eat",
        "pet:someone-speaking", "pet:ping", "pet:say",
        "global:chat-active", "wallet:suggest-sync", "trigger-flashcard-test",
    ];
    let allowed_prefixes = [
        "update-speech-",
        "update-flashcard-",
        "flashcard-ready-",
        "flashcard-button-",
        "speech-size-",
        "chat-mode-",
        "chat-mode-toggle-",
        "chat-reply-",
        "user-chat-submit-",
        "speech-button-",
    ];

    let is_allowed = allowed_static.contains(&event.as_str())
        || allowed_prefixes.iter().any(|prefix| event.starts_with(prefix));

    if is_allowed {
        let _ = app.emit(&event, payload);
    } else {
        eprintln!("[broadcast_pet_event] Blocked unknown event: {}", event);
    }
}

#[tauri::command]
pub fn re_raise_window(app: AppHandle, instance_id: String) {
    crate::window::overlay::re_raise_window(&app, &instance_id);
}

/// Returns the primary monitor's work area (excludes Dock/Taskbar) in logical pixels.
#[tauri::command]
pub fn get_monitor_work_area(app: AppHandle) -> serde_json::Value {
    if let Ok(Some(monitor)) = app.primary_monitor() {
        let scale = monitor.scale_factor();
        let wa = monitor.work_area();
        return serde_json::json!({
            "x": wa.position.x as f64 / scale,
            "y": wa.position.y as f64 / scale,
            "width": wa.size.width as f64 / scale,
            "height": wa.size.height as f64 / scale,
        });
    }
    serde_json::json!({ "x": 0, "y": 0, "width": 1920, "height": 1080 })
}

#[tauri::command]
pub fn debug_log(message: String) {
    eprintln!("[WebView] {}", message);
}

#[tauri::command]
pub async fn get_active_app() -> Result<Option<String>, String> {
    Ok(crate::intelligence::get_active_app().await)
}

#[tauri::command]
pub async fn get_browser_tab(browser: String) -> Result<Option<String>, String> {
    Ok(crate::intelligence::get_browser_tab(&browser).await)
}

#[tauri::command]
pub async fn get_browser_url(browser: String) -> Result<Option<String>, String> {
    Ok(crate::intelligence::get_browser_url(&browser).await)
}

// --- Local AI Commands ---



#[tauri::command]
pub fn check_model_exists(app: AppHandle) -> bool {
    let app_data_dir = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir.join("minipet-qwen-model-SUI.gguf");
    const MIN_VALID_SIZE: u64 = 900 * 1024 * 1024;
    if let Ok(meta) = std::fs::metadata(&model_path) {
        meta.len() >= MIN_VALID_SIZE
    } else {
        false
    }
}

#[tauri::command]
pub fn delete_model(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir.join("minipet-qwen-model-SUI.gguf");
    if model_path.exists() {
        std::fs::remove_file(&model_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn download_model(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir.join("minipet-qwen-model-SUI.gguf");
    const MIN_VALID_SIZE: u64 = 900 * 1024 * 1024;

    // Remove corrupt/incomplete file before re-downloading
    if model_path.exists() {
        if let Ok(meta) = std::fs::metadata(&model_path) {
            if meta.len() >= MIN_VALID_SIZE {
                return Ok(()); // Already valid
            }
            eprintln!("[Model] Removing corrupt/incomplete model file ({} bytes)", meta.len());
            let _ = std::fs::remove_file(&model_path);
        }
    }
    
    let url = "https://huggingface.co/iamquocbao/minipet-qwen-model-SUI/resolve/main/qwen-sui-q4_k_m.gguf";
    
    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let total_size = response.content_length().unwrap_or(0);
    
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    
    let mut file = tokio::fs::File::create(&model_path).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();
    
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        
        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else {
            0.0
        };
        
        let _ = app.emit("model-download-progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total_size,
            "progress": progress
        }));
    }
    
    file.sync_all().await.map_err(|e| e.to_string())?;

    Ok(())
}

async fn download_llama_server_inner(app: &AppHandle, bin_path: &std::path::Path) -> Result<(), String> {
    let url = if cfg!(target_os = "macos") {
        if cfg!(target_arch = "aarch64") {
            "https://huggingface.co/iamquocbao/minipet-qwen-model-SUI/resolve/main/llama-server-aarch64-apple-darwin"
        } else {
            "https://huggingface.co/iamquocbao/minipet-qwen-model-SUI/resolve/main/llama-server-x86_64-apple-darwin"
        }
    } else if cfg!(target_os = "windows") {
        "https://huggingface.co/iamquocbao/minipet-qwen-model-SUI/resolve/main/llama-server.exe"
    } else {
        "https://huggingface.co/iamquocbao/minipet-qwen-model-SUI/resolve/main/llama-server-x86_64-unknown-linux-gnu"
    };

    let response = reqwest::get(url).await.map_err(|e| e.to_string())?;
    let total_size = response.content_length().unwrap_or(0);

    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    if let Some(parent) = bin_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }

    let mut file = tokio::fs::File::create(bin_path).await.map_err(|e| e.to_string())?;
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;

        let progress = if total_size > 0 {
            (downloaded as f64 / total_size as f64) * 100.0
        } else { 0.0 };

        let _ = app.emit("llama-download-progress", serde_json::json!({
            "downloaded": downloaded,
            "total": total_size,
            "progress": progress
        }));
    }

    file.sync_all().await.map_err(|e| e.to_string())?;

    // Make executable on unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(bin_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }

    eprintln!("[Rust Local AI] llama-server downloaded successfully");
    Ok(())
}

#[tauri::command]
pub async fn start_ai_server(state: State<'_, AppState>, app: AppHandle) -> Result<(), String> {
    let mut process_lock = state.llama_process.lock().await;

    // Ensure llama-server binary exists, download if not
    let app_data_dir = app.path().app_data_dir().unwrap();
    let bin_name = if cfg!(target_os = "windows") {
        "llama-server.exe"
    } else {
        "llama-server"
    };
    let bin_path = app_data_dir.join(bin_name);
    if !bin_path.exists() {
        eprintln!("[Rust Local AI] llama-server not found, downloading...");
        download_llama_server_inner(&app, &bin_path).await?;
    }
    
    // Check if already running — clean up dead processes
    if let Some(child) = process_lock.as_mut() {
        match child.try_wait() {
            Ok(None) => {
                // Still running
                eprintln!("[Rust Local AI] Server is already running.");
                return Ok(());
            }
            Ok(Some(status)) => {
                // Process exited — clean up and restart
                eprintln!("[Rust Local AI] Server exited with status: {}. Restarting...", status);
                *process_lock = None;
            }
            Err(e) => {
                eprintln!("[Rust Local AI] Failed to check process status: {}. Cleaning up...", e);
                *process_lock = None;
            }
        }
    }

    let app_data_dir2 = app.path().app_data_dir().unwrap();
    let model_path = app_data_dir2.join("minipet-qwen-model-SUI.gguf");
    
    eprintln!("[Rust Local AI] Starting AI server...");
    eprintln!("[Rust Local AI] Binary path: {:?}", bin_path);
    eprintln!("[Rust Local AI] Model path: {:?}", model_path);
    eprintln!("[Rust Local AI] Binary exists: {}", bin_path.exists());
    eprintln!("[Rust Local AI] Model exists: {}", model_path.exists());
    
    let child = std::process::Command::new(&bin_path)
        .arg("-m")
        .arg(&model_path)
        .arg("--port")
        .arg("8080")
        .arg("-c")
        .arg("2048")
        .spawn();
        
    match child {
        Ok(c) => {
            eprintln!("[Rust Local AI] Server successfully spawned with PID: {}", c.id());
            *process_lock = Some(c);
            Ok(())
        }
        Err(e) => {
            eprintln!("[Rust Local AI] Failed to spawn server: {:?}", e);
            Err(e.to_string())
        }
    }
}

