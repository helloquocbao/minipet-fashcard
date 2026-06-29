//! On-demand translation.
//!
//! Two trigger modes (chosen in Settings):
//!  - "hotkey": a global shortcut (Cmd/Ctrl+Shift+T) copies the current
//!    selection and translates it.
//!  - "auto":  a background watcher translates text whenever the clipboard
//!    changes (i.e. every time the user copies something).
//!
//! The translated text is shown by the pet via the existing `pet:say` event.
//! Translation runs through Gemini (key stored in settings). Keeping the HTTP
//! call in Rust avoids the webview CSP restrictions on `googleapis.com`.

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::AppState;

/// Max clipboard length (in chars) we'll auto-translate, so copying a whole
/// document/file path doesn't fire off a huge request.
const MAX_AUTO_LEN: usize = 500;

/// Gemini model used for translation. `gemini-2.0-flash` was deprecated on
/// 2026-06-01 (removed from the free tier → "quota limit: 0"), so we use the
/// 2.5 Flash-Lite model which has the largest free-tier allowance.
const GEMINI_MODEL: &str = "gemini-2.5-flash-lite";

/// Map an app language code to a full language name for the prompt.
fn lang_name(code: &str) -> &'static str {
    match code {
        "vi" => "Vietnamese",
        "fr" => "French",
        "zh" => "Chinese",
        "it" => "Italian",
        "ko" => "Korean",
        _ => "English",
    }
}

fn no_key_message(lang: &str) -> String {
    match lang {
        "vi" => "⚠️ Hãy nhập Gemini API key trong Cài đặt để dùng dịch nhé!".to_string(),
        _ => "⚠️ Add your Gemini API key in Settings to use translation.".to_string(),
    }
}

fn error_message(lang: &str) -> String {
    match lang {
        "vi" => "😵 Dịch thất bại. Kiểm tra mạng hoặc API key giúp mình.".to_string(),
        _ => "😵 Translation failed. Check your network or API key.".to_string(),
    }
}

fn loading_message(lang: &str) -> String {
    match lang {
        "vi" => "🌐 Đang dịch…".to_string(),
        _ => "🌐 Translating…".to_string(),
    }
}

/// Emit a `pet:say` event for one pet to speak. `priority` bypasses the
/// inter-pet speech cooldown so the translation always shows.
fn emit_say(app: &AppHandle, text: &str, priority: bool) {
    let _ = app.emit(
        "pet:say",
        serde_json::json!({ "text": text, "priority": priority }),
    );
}

/// Read the current clipboard text, or None if empty/unavailable.
fn read_clipboard(app: &AppHandle) -> Option<String> {
    match app.clipboard().read_text() {
        Ok(t) if !t.trim().is_empty() => Some(t),
        _ => None,
    }
}

/// Call Gemini to translate `text` into the target language (or to English if
/// the text is already in the target language).
async fn gemini_translate(
    client: &reqwest::Client,
    api_key: &str,
    text: &str,
    lang: &str,
) -> Result<String, String> {
    let target = lang_name(lang);
    let prompt = format!(
        "You are a translation engine. Translate the text below into {target}. \
         If the text is already in {target}, translate it into English instead. \
         Output ONLY the translated text — no quotes, no labels, no explanations.\n\nText:\n{text}"
    );

    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        GEMINI_MODEL, api_key
    );
    let body = serde_json::json!({
        "contents": [{ "parts": [{ "text": prompt }] }],
        "generationConfig": { "temperature": 0.2 }
    });

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = resp.status();
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    if !status.is_success() {
        let msg = json
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("Gemini API error");
        return Err(msg.to_string());
    }

    let out = json
        .get("candidates")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("content"))
        .and_then(|c| c.get("parts"))
        .and_then(|p| p.get(0))
        .and_then(|p| p.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .trim()
        .to_string();

    if out.is_empty() {
        return Err("Empty translation".to_string());
    }
    Ok(out)
}

/// Translate the given text and make the pet say the result.
/// Shows a helpful bubble if no API key is configured.
pub async fn translate_and_say(app: &AppHandle, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }

    let state = app.state::<AppState>();
    let (api_key, lang, client) = {
        let mgr = state.pet_manager.lock().await;
        let s = mgr.get_settings();
        (
            s.gemini_api_key.clone(),
            s.language.clone(),
            state.reqwest_client.clone(),
        )
    };

    if api_key.trim().is_empty() {
        emit_say(app, &no_key_message(&lang), true);
        return;
    }

    // Immediate feedback while the request is in flight.
    emit_say(app, &loading_message(&lang), true);

    match gemini_translate(&client, &api_key, text, &lang).await {
        Ok(translation) => {
            eprintln!("[Translate] ({}) {:?} -> {:?}", lang, text, translation);
            emit_say(app, &format!("🌐 {}", translation), true);
        }
        Err(e) => {
            eprintln!("[Translate] error: {}", e);
            emit_say(app, &error_message(&lang), true);
        }
    }
}

/// macOS: synthesize Cmd+C to copy the current selection in the frontmost app.
/// Requires Accessibility permission (same as the context-monitoring feature).
/// No-op on other platforms — there the user copies manually before the hotkey.
async fn copy_selection() {
    #[cfg(target_os = "macos")]
    {
        let _ = tokio::process::Command::new("osascript")
            .arg("-e")
            .arg("tell application \"System Events\" to keystroke \"c\" using command down")
            .output()
            .await;
    }
}

/// Hotkey handler: copy the selection, then translate it.
pub async fn translate_selection(app: AppHandle) {
    let state = app.state::<AppState>();
    let (enabled, mode) = {
        let mgr = state.pet_manager.lock().await;
        let s = mgr.get_settings();
        (s.translate_enabled, s.translate_mode.clone())
    };
    if !enabled || mode != "hotkey" {
        return;
    }

    copy_selection().await;
    // Give the OS a moment to put the selection on the clipboard.
    tokio::time::sleep(std::time::Duration::from_millis(180)).await;

    if let Some(text) = read_clipboard(&app) {
        translate_and_say(&app, &text).await;
    }
}

/// Background loop for "auto" mode: translate whenever the clipboard changes.
pub async fn start_clipboard_watcher(app: AppHandle) {
    // Seed last_clipboard with the current value so we don't translate whatever
    // was already on the clipboard at launch.
    {
        let state = app.state::<AppState>();
        if let Some(t) = read_clipboard(&app) {
            let mut last = state.last_clipboard.lock().await;
            *last = t;
        }
    }

    loop {
        tokio::time::sleep(std::time::Duration::from_millis(900)).await;

        let state = app.state::<AppState>();

        let current = match read_clipboard(&app) {
            Some(t) => t,
            None => continue,
        };

        // Detect a clipboard change and record it regardless of mode, so that
        // toggling into "auto" later doesn't re-translate stale content.
        let changed = {
            let mut last = state.last_clipboard.lock().await;
            if *last == current {
                false
            } else {
                *last = current.clone();
                true
            }
        };
        if !changed {
            continue;
        }

        let (enabled, mode) = {
            let mgr = state.pet_manager.lock().await;
            let s = mgr.get_settings();
            (s.translate_enabled, s.translate_mode.clone())
        };
        if !enabled || mode != "auto" {
            continue;
        }

        let trimmed = current.trim();
        if trimmed.is_empty() || trimmed.chars().count() > MAX_AUTO_LEN {
            continue;
        }
        translate_and_say(&app, trimmed).await;
    }
}

/// Register or unregister the global translation hotkey based on settings.
/// Hotkey is Cmd+Shift+T on macOS, Ctrl+Shift+T elsewhere.
#[cfg(desktop)]
pub fn sync_global_shortcut(app: &AppHandle, enabled: bool, mode: &str) {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

    #[cfg(target_os = "macos")]
    let mods = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let mods = Modifiers::CONTROL | Modifiers::SHIFT;

    let shortcut = Shortcut::new(Some(mods), Code::KeyT);
    let gs = app.global_shortcut();

    // Always clear first so toggling settings can't leave a stale registration.
    let _ = gs.unregister(shortcut);

    if enabled && mode == "hotkey" {
        if let Err(e) = gs.register(shortcut) {
            eprintln!("[Translate] Failed to register hotkey: {}", e);
        }
    }
}
