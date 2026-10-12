/// The desktop shell is intentionally thin: it hosts the same web build and adds native open/save dialogs
/// (see `src/platform/index.ts`). Everything else — editing, 3D, export, the local AI proxy calls — is the web app.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("error while running Duplex Designer");
}
