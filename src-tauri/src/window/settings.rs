use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const SETTINGS_WIDTH: f64 = 1080.0;
const SETTINGS_HEIGHT: f64 = 720.0;
const LABEL: &str = "settings";

pub fn open(app: &AppHandle) -> Result<(), String> {
    // Opening Settings makes the app a normal foreground app: show it in the
    // macOS Dock (and give it a proper app menu / focus).
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);

    // If already exists, just show and focus
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    let url = WebviewUrl::App("renderer/settings/index.html".into());

    let window = WebviewWindowBuilder::new(app, LABEL, url)
        .title("MiniPet Settings")
        .inner_size(SETTINGS_WIDTH, SETTINGS_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .accept_first_mouse(true)
        .skip_taskbar(false)
        .devtools(cfg!(debug_assertions))
        .build()
        .map_err(|e| e.to_string())?;

    // Closing the Settings window doesn't quit the app — it just hides the
    // window and drops the app back to a background (tray-only) process:
    // no Dock icon on macOS, no taskbar button on Windows. The tray keeps it
    // alive; reopening Settings brings the Dock/taskbar entry back.
    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Some(win) = app_handle.get_webview_window(LABEL) {
                let _ = win.hide();
            }
            #[cfg(target_os = "macos")]
            let _ = app_handle.set_activation_policy(tauri::ActivationPolicy::Accessory);
        }
    });

    Ok(())
}
