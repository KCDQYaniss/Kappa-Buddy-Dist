#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod data;
mod ocr;
mod overlay;
mod priority;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tarkov_core::{self as core, paths, Config, Event, MapInfo, Position};
use tauri::{Manager, State};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, WindowEvent};
use tauri_plugin_updater::UpdaterExt;
use overlay::{OverlayConfig, OverlayState};

#[derive(Serialize, Deserialize, Clone, Default)]
struct Settings {
    screenshots_dir: Option<String>,
    logs_dir: Option<String>,
    #[serde(default)]
    delete_screenshots: bool,
    /// Langue des données (fr, en, de, es, ru). Sert à choisir le fichier de progression et le cache.
    #[serde(default)]
    lang: Option<String>,
    /// « PvP », « PvE » ou « Season ». Sépare la progression de quêtes par mode de jeu.
    #[serde(default)]
    game_mode: Option<String>,
    #[serde(default)]
    always_on_top: bool,
    #[serde(default)]
    auto_start: bool,
    #[serde(default)]
    close_to_tray: bool,
    #[serde(default)]
    start_minimized: bool,
    /// Vérifier les mises à jour au démarrage. Absent = activé (comportement par défaut).
    #[serde(default)]
    check_updates: Option<bool>,
    /// Overlay curseur dans le jeu (style Blitz)
    #[serde(default)]
    cursor_overlay_enabled: bool,
    /// Opacity de l'overlay (0.0 - 1.0)
    #[serde(default)]
    cursor_overlay_opacity: f64,
}

/// Normalise le mode de jeu reçu de l'interface.
fn normalize_mode(mode: Option<&str>) -> String {
    match mode.map(|m| m.trim().to_ascii_lowercase()).as_deref() {
        Some("pve") => "pve",
        Some("season") | Some("saison") => "season",
        _ => "pvp",
    }
    .to_string()
}

impl Settings {
    fn mode(&self) -> String {
        normalize_mode(self.game_mode.as_deref())
    }
    fn lang(&self) -> String {
        let l = self.lang.as_deref().unwrap_or("fr").trim().to_ascii_lowercase();
        if l.is_empty() || l.len() > 3 || !l.chars().all(|c| c.is_ascii_lowercase()) { "fr".to_string() } else { l }
    }
    fn check_updates(&self) -> bool {
        self.check_updates.unwrap_or(true)
    }
}

#[derive(Default)]
struct AppState {
    settings: Mutex<Settings>,
    watchers: Mutex<Option<core::Handle>>,
    map: Mutex<Option<MapInfo>>,
    position: Mutex<Option<Position>>,
    warnings: Mutex<Vec<String>>,
}

/// Ce que l'interface reçoit au démarrage et après chaque changement de réglages.
#[derive(Serialize)]
struct StateDto {
    screenshots_dir: String,
    logs_dir: Option<String>,
    delete_screenshots: bool,
    lang: String,
    game_mode: String,
    always_on_top: bool,
    auto_start: bool,
    close_to_tray: bool,
    start_minimized: bool,
    check_updates: bool,
    cursor_overlay_enabled: bool,
    cursor_overlay_opacity: f64,
    map: Option<MapInfo>,
    position: Option<Position>,
    warnings: Vec<String>,
}

fn effective_config(s: &Settings) -> Config {
    let screenshots_dir = s
        .screenshots_dir
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .or_else(paths::default_screenshots_dir)
        .unwrap_or_default();
    let logs_dir = s
        .logs_dir
        .as_deref()
        .filter(|p| !p.trim().is_empty())
        .map(PathBuf::from)
        .or_else(paths::detect_logs_dir);
    Config { screenshots_dir, logs_dir, delete_screenshots: s.delete_screenshots }
}

fn dispatch(app: &AppHandle, ev: Event) {
    let st = app.state::<AppState>();
    match ev {
        Event::Position(p) => {
            *st.position.lock().unwrap() = Some(p.clone());
            let _ = app.emit("position", &p);
        }
        Event::Map(m) => {
            *st.map.lock().unwrap() = Some(m.clone());
            let _ = app.emit("map", &m);
        }
        Event::Task(t) => {
            let _ = app.emit("task", &t);
        }
        Event::Warning(w) => {
            st.warnings.lock().unwrap().push(w.clone());
            let _ = app.emit("warning", &w);
        }
    }
}

fn start_watchers(app: &AppHandle) {
    let st = app.state::<AppState>();
    // On arrête les anciens watchers AVANT d'en démarrer de nouveaux.
    st.watchers.lock().unwrap().take();
    st.warnings.lock().unwrap().clear();
    let cfg = effective_config(&st.settings.lock().unwrap());
    let a = app.clone();
    let handle = core::start(cfg, move |ev| dispatch(&a, ev));
    *st.watchers.lock().unwrap() = Some(handle);
}

fn snapshot(st: &AppState) -> StateDto {
    let s = st.settings.lock().unwrap().clone();
    let cfg = effective_config(&s);
    StateDto {
        screenshots_dir: cfg.screenshots_dir.display().to_string(),
        logs_dir: cfg.logs_dir.map(|p| p.display().to_string()),
        delete_screenshots: cfg.delete_screenshots,
        lang: s.lang(),
        game_mode: s.game_mode.clone().unwrap_or_else(|| "PvP".into()),
        always_on_top: s.always_on_top,
        auto_start: s.auto_start,
        close_to_tray: s.close_to_tray,
        start_minimized: s.start_minimized,
        check_updates: s.check_updates(),
        cursor_overlay_enabled: s.cursor_overlay_enabled,
        cursor_overlay_opacity: s.cursor_overlay_opacity,
        map: st.map.lock().unwrap().clone(),
        position: st.position.lock().unwrap().clone(),
        warnings: st.warnings.lock().unwrap().clone(),
    }
}

fn settings_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("settings.json"))
}

/// Écrit les réglages sur disque (atomique).
fn save_settings_file(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    if let Some(file) = settings_file(app) {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        let tmp = file.with_extension("json.tmp");
        std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Active/désactive le démarrage automatique avec Windows (entrée « Run » du registre, utilisateur courant).
#[cfg(windows)]
fn apply_auto_start(on: bool) {
    const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    const NAME: &str = "TarkovTracker";
    let mut cmd = std::process::Command::new("reg");
    if on {
        match std::env::current_exe() {
            Ok(exe) => {
                cmd.args(["add", KEY, "/v", NAME, "/t", "REG_SZ", "/d", &format!("\"{}\"", exe.display()), "/f"]);
            }
            Err(_) => return,
        }
    } else {
        cmd.args(["delete", KEY, "/v", NAME, "/f"]);
    }
    let _ = cmd.output();
}

#[cfg(not(windows))]
fn apply_auto_start(_on: bool) {}

#[cfg(windows)]
fn auto_start_enabled() -> bool {
    const KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    std::process::Command::new("reg")
        .args(["query", KEY, "/v", "TarkovTracker"])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn auto_start_enabled() -> bool {
    false
}

/// Applique l'état « toujours au premier plan » à la fenêtre principale (utile pendant un raid).
fn apply_always_on_top(app: &AppHandle, on: bool) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_always_on_top(on);
    }
}

/// Affiche et met au premier plan la fenêtre principale (depuis la zone de notification).
fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Icône de la zone de notification : menu « Afficher / Quitter », clic gauche pour rouvrir.
fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Afficher Tarkov Tracker", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Tarkov Tracker")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// Explique pourquoi la map ou les quêtes ne sont pas détectées (réglages manuels uniquement : la
/// détection automatique est relancée à l'intérieur).
#[tauri::command]
fn diagnose(state: State<AppState>) -> core::diag::Diagnostics {
    let s = state.settings.lock().unwrap().clone();
    let cfg = effective_config(&s);
    let manual = s.logs_dir.as_deref().filter(|p| !p.trim().is_empty()).map(PathBuf::from);
    core::diag::diagnose(manual.as_deref(), &cfg.screenshots_dir)
}

/// Relit tous les logs de notifications et renvoie l'historique des quêtes (resynchronisation manuelle).
#[tauri::command]
async fn rescan_quests(state: State<'_, AppState>) -> Result<core::logs::ScanReport, String> {
    let cfg = effective_config(&state.settings.lock().unwrap());
    let dir = cfg.logs_dir.ok_or("Dossier des logs introuvable : renseigne-le dans Réglages.")?;
    tauri::async_runtime::spawn_blocking(move || core::logs::scan_task_history_report(&dir)).await.map_err(|e| e.to_string())
}

/// Liste les images de capture d'écran du jeu, de la plus récente à la plus ancienne.
#[tauri::command]
fn screenshots_list(state: State<'_, AppState>) -> Vec<String> {
    let cfg = effective_config(&state.settings.lock().unwrap());
    if !cfg.screenshots_dir.is_dir() {
        return Vec::new();
    }
    ocr::list_screenshots(&cfg.screenshots_dir)
        .into_iter()
        .map(|p| p.display().to_string())
        .collect()
}

/// Lit le texte d'une capture d'écran (OCR Windows). Si `path` est vide, lit la plus récente.
#[tauri::command]
async fn read_screen_text(state: State<'_, AppState>, path: Option<String>) -> Result<Vec<String>, String> {
    let cfg = effective_config(&state.settings.lock().unwrap());
    let target = match path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => {
            if !cfg.screenshots_dir.is_dir() {
                return Err("Aucune capture d'écran trouvée dans le dossier configuré.".into());
            }
            match ocr::list_screenshots(&cfg.screenshots_dir).into_iter().next() {
                Some(p) => p,
                None => return Err("Aucune capture d'écran trouvée dans le dossier configuré.".into()),
            }
        }
    };
    if !target.is_file() {
        return Err(format!("Fichier introuvable : {}", target.display()));
    }
    tauri::async_runtime::spawn_blocking(move || ocr::read_lines(&target))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
fn get_state(state: State<AppState>) -> StateDto {
    snapshot(&state)
}

#[tauri::command]
fn apply_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> Result<StateDto, String> {
    let prev_mode = state.settings.lock().unwrap().mode();
    save_settings_file(&app, &settings)?;
    *state.settings.lock().unwrap() = settings.clone();
    apply_always_on_top(&app, settings.always_on_top);
    apply_auto_start(settings.auto_start);
    start_watchers(&app);
    if normalize_mode(settings.game_mode.as_deref()) != prev_mode {
        let _ = app.emit("game_mode_changed", settings.game_mode.clone().unwrap_or_else(|| "PvP".into()));
    }
    Ok(snapshot(&state))
}

/// Bascule « toujours au premier plan » sans ouvrir les réglages (bouton de la barre du bas).
#[tauri::command]
fn set_always_on_top(app: AppHandle, state: State<AppState>, on: bool) -> Result<StateDto, String> {
    apply_always_on_top(&app, on);
    {
        let mut s = state.settings.lock().unwrap();
        s.always_on_top = on;
    }
    let s = state.settings.lock().unwrap().clone();
    save_settings_file(&app, &s)?;
    Ok(snapshot(&state))
}

/// Indique si le démarrage automatique avec Windows est actif (lit le registre).
#[tauri::command]
fn get_auto_start(state: State<AppState>) -> bool {
    if state.settings.lock().unwrap().auto_start { true } else { auto_start_enabled() }
}

/// Active/désactive le démarrage automatique avec Windows.
#[tauri::command]
fn set_auto_start(app: AppHandle, state: State<AppState>, on: bool) -> Result<StateDto, String> {
    apply_auto_start(on);
    {
        let mut s = state.settings.lock().unwrap();
        s.auto_start = on;
    }
    let s = state.settings.lock().unwrap().clone();
    save_settings_file(&app, &s)?;
    Ok(snapshot(&state))
}

/// Change le mode de jeu (PvP/PvE/Season) : la progression est stockée séparément par mode.
#[tauri::command]
fn set_game_mode(app: AppHandle, state: State<AppState>, mode: String) -> Result<StateDto, String> {
    let norm = normalize_mode(Some(&mode));
    {
        let mut s = state.settings.lock().unwrap();
        s.game_mode = Some(norm.clone());
    }
    let s = state.settings.lock().unwrap().clone();
    save_settings_file(&app, &s)?;
    let _ = app.emit("game_mode_changed", mode);
    Ok(snapshot(&state))
}

/* ---------- Overlay Control ---------- */

#[tauri::command]
fn start_overlay(config: OverlayConfig) {
    overlay::start(config);
}

#[tauri::command]
fn stop_overlay() {
    overlay::stop();
}

#[tauri::command]
fn get_overlay_state() -> OverlayState {
    overlay::get_state()
}

#[tauri::command]
fn set_overlay_config(enabled: bool, opacity: f64) {
    let config = OverlayConfig {
        enabled,
        opacity,
        ..Default::default()
    };
    overlay::start(config);
}

/* ---------- Mises à jour ---------- */

/// Résultat d'une vérification de mise à jour, tel que l'interface l'affiche.
#[derive(Serialize)]
struct UpdateInfo {
    version: String,
    current: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Interroge le serveur de mises à jour (GitHub Releases par défaut).
#[tauri::command]
async fn check_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let found = updater.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone(),
        date: u.date.map(|d| d.to_string()),
    }))
}

/// Télécharge et installe la mise à jour. Sur Windows, l'application se ferme et l'installeur
/// enchaîne tout seul : la nouvelle version redémarre à la fin.
#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater_builder().build().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?.ok_or("Aucune mise à jour disponible.")?;
    update.download_and_install(|_chunk, _total| {}, || {}).await.map_err(|e| e.to_string())
}

/// Ouvre la page des versions dans le navigateur par défaut : filet de sécurité si la mise à
/// jour automatique échoue (réseau, signature…). L'URL est dérivée de l'adresse de mise à jour
/// configurée, donc elle reste exacte même si le dépôt change.
#[tauri::command]
fn open_releases(app: AppHandle) -> Result<String, String> {
    let endpoint = app
        .config()
        .plugins
        .0
        .get("updater")
        .and_then(|u| u.get("endpoints"))
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
        .and_then(|v| v.as_str())
        .ok_or("Adresse de mise à jour introuvable.")?;
    // `…/OWNER/REPO/releases/latest/download/latest.json` → `…/OWNER/REPO/releases/latest`
    let base = endpoint.split("/releases/").next().ok_or("Adresse de mise à jour inattendue.")?;
    let url = format!("{base}/releases/latest");
    if !url.starts_with("https://") {
        return Err("Adresse de mise à jour non sécurisée.".into());
    }
    open_browser(&url)?;
    Ok(url)
}

#[cfg(target_os = "windows")]
fn open_browser(url: &str) -> Result<(), String> {
    std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn().map(|_| ()).map_err(|e| e.to_string())
}
#[cfg(not(target_os = "windows"))]
fn open_browser(url: &str) -> Result<(), String> {
    let cmd = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    std::process::Command::new(cmd).arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

fn main() {
    priority::lower();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .setup(|app| {
            let handle = app.handle().clone();
            let mut start_minimized = false;
            if let Some(file) = settings_file(&handle) {
                if let Ok(txt) = std::fs::read_to_string(file) {
                    if let Ok(s) = serde_json::from_str::<Settings>(&txt) {
                        apply_always_on_top(&handle, s.always_on_top);
                        start_minimized = s.start_minimized;
                        *handle.state::<AppState>().settings.lock().unwrap() = s;
                    }
                }
            }
            if let Err(e) = build_tray(&handle) {
                eprintln!("icône de la zone de notification indisponible : {e}");
            }
            if let Some(win) = handle.get_webview_window("main") {
                let w = win.clone();
                // Fermeture : si l'option est active, on masque au lieu de quitter (l'icône reste visible).
                win.on_window_event(move |ev| {
                    if let WindowEvent::CloseRequested { api, .. } = ev {
                        let st = w.app_handle().state::<AppState>();
                        if st.settings.lock().unwrap().close_to_tray {
                            api.prevent_close();
                            let _ = w.hide();
                        }
                    }
                });
                if start_minimized {
                    let _ = win.hide();
                }
            }
            start_watchers(&handle);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_state,
            diagnose,
            rescan_quests,
            apply_settings,
            set_always_on_top,
            get_auto_start,
            set_auto_start,
            set_game_mode,
            check_update,
            install_update,
            open_releases,
            data::load_cache,
            data::refresh_data,
            data::load_progress,
            data::save_progress,
            screenshots_list,
            read_screen_text,
            start_overlay,
            stop_overlay,
            get_overlay_state,
            set_overlay_config,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Tarkov Tracker");
}
