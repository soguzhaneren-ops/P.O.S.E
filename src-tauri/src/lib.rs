use tauri::{WebviewUrl, WebviewWindowBuilder};

// Fixed port for the production-only localhost server (see capabilities/default.json
// "remote" grant, which must match this port for the IPC bridge to be trusted).
const LOCALHOST_PORT: u16 = 47420;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_http::init())
    .plugin(
      tauri_plugin_localhost::Builder::new(LOCALHOST_PORT)
        .host("127.0.0.1".to_string())
        .build(),
    )
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // WKWebView doesn't send a Referer header for the tauri:// custom protocol,
      // which breaks the YouTube embed in production builds. Serving from a real
      // http://localhost origin via tauri-plugin-localhost fixes that. Dev mode
      // already loads from the real Vite dev server, so it's unaffected.
      let url = if cfg!(debug_assertions) {
        WebviewUrl::App(Default::default())
      } else {
        // Must match the .host("127.0.0.1") passed to the plugin above. Without pinning
        // both sides to the same literal IP, the plugin's default "localhost" bind can
        // resolve to ::1 or 127.0.0.1 nondeterministically between runs (whichever the
        // system's getaddrinfo() order picks that time), leaving the window pointed at
        // an address nothing is actually listening on and the page silently blank.
        let localhost_url: tauri::Url = format!("http://127.0.0.1:{}", LOCALHOST_PORT)
          .parse()
          .expect("failed to parse localhost URL");
        WebviewUrl::External(localhost_url)
      };

      WebviewWindowBuilder::new(app, "main", url)
        .title("TACTICAL_TELEMETRY // CONSOLE")
        .inner_size(1280.0, 720.0)
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .center()
        .disable_drag_drop_handler()
        .build()?;

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
