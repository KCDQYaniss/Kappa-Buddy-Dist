#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod data;
mod ocr;
mod overlay;
mod priority;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::Mutex;
use tarkov_core::{self as core, paths, Config, Event, MapInfo, Position};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_updater::UpdaterExt as _;

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
    /// Raccourci global qui déclenche une capture + lecture du prix (défaut « F2 »).
    #[serde(default)]
    overlay_capture_hotkey: Option<String>,
    /// Raccourci global qui affiche / masque la carte (défaut « Shift+F2 »).
    /// N'agit que sur l'affichage : le sidecar continue de tourner.
    #[serde(default)]
    overlay_toggle_hotkey: Option<String>,
    /// Langue du client de jeu, utilisée pour l'OCR (en, fr, de, es, ru).
    /// Doit correspondre à la langue du jeu, pas à celle de l'interface.
    #[serde(default)]
    overlay_game_lang: Option<String>,
    /// Durée d'affichage de la carte après une capture, en secondes (0 = reste affichée).
    #[serde(default)]
    overlay_autohide_sec: Option<u32>,
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
    fn overlay_capture_hotkey(&self) -> String {
        self.overlay_capture_hotkey.clone().unwrap_or_else(|| "F2".to_string())
    }
    fn overlay_toggle_hotkey(&self) -> String {
        self.overlay_toggle_hotkey.clone().unwrap_or_else(|| "Shift+F2".to_string())
    }
    /// Langue du *jeu* (celle que l'OCR doit reconnaître). Par défaut l'anglais :
    /// c'est le choix le plus sûr quand on ne sait pas, et le sidecar retombe
    /// toujours sur le texte brut si aucun objet ne correspond.
    fn overlay_game_lang(&self) -> String {
        let l = self.overlay_game_lang.as_deref().unwrap_or("en").trim().to_ascii_lowercase();
        if l.is_empty() || l.len() > 3 || !l.chars().all(|c| c.is_ascii_lowercase()) { "en".to_string() } else { l }
    }
    /// Durée d'affichage de la carte après une capture (0 = reste affichée).
    fn overlay_autohide_sec(&self) -> u32 {
        self.overlay_autohide_sec.unwrap_or(8).min(300)
    }
    /// Vocabulaire du sidecar Python : « regular » ou « pve ».
    fn overlay_sidecar_mode(&self) -> String {
        if self.mode() == "pve" { "pve".to_string() } else { "regular".to_string() }
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

/// Les deux raccourcis globaux de l'overlay. On garde le `Shortcut` déjà
/// analysé pour comparer par égalité dans le gestionnaire — ça évite toutes les
/// ambiguïtés de format entre « Shift+F2 » et « shift+f2 ».
#[derive(Default)]
struct HotkeySlots {
    capture: Option<Shortcut>,
    toggle: Option<Shortcut>,
}
struct Hotkeys(Mutex<HotkeySlots>);

/// Dernier résultat d'overlay, interrogé par le frontend en polling.
static LAST_OVERLAY_RESULT: Mutex<Option<serde_json::Value>> = Mutex::new(None);
static LAST_OVERLAY_STATUS: Mutex<String> = Mutex::new(String::new());
/// Compteur monotone : le frontend ne traite un résultat que si ce numéro a
/// changé. C'est ce qui évite à la fois le spam de l'auto-masquage et le
/// « une seule fois puis plus rien » d'un flag booléen collé.
static OVERLAY_SEQ: AtomicU64 = AtomicU64::new(0);

/// (Re)enregistre les deux raccourcis globaux. Une chaîne vide libère le slot.
/// Appelée au démarrage et à chaque enregistrement des réglages.
fn apply_overlay_hotkeys(app: &AppHandle, capture: &str, toggle: &str) -> Result<(), String> {
    let gs = app.global_shortcut();
    let state = app.state::<Hotkeys>();
    let mut cfg = state.0.lock().unwrap();

    if let Some(old) = cfg.capture.take() {
        let _ = gs.unregister(old);
    }
    if let Some(old) = cfg.toggle.take() {
        let _ = gs.unregister(old);
    }

    if !capture.trim().is_empty() {
        let parsed = capture
            .parse::<Shortcut>()
            .map_err(|e| format!("Raccourci de capture « {capture} » invalide : {e}"))?;
        gs.register(parsed.clone())
            .map_err(|e| format!("Impossible d'enregistrer le raccourci de capture « {capture} » : {e}"))?;
        cfg.capture = Some(parsed);
    }

    if !toggle.trim().is_empty() {
        let parsed = toggle
            .parse::<Shortcut>()
            .map_err(|e| format!("Raccourci d'affichage « {toggle} » invalide : {e}"))?;
        println!("[hotkey] registering toggle: {:?} (from {})", parsed, toggle);
        match gs.register(parsed.clone()) {
            Ok(()) => { cfg.toggle = Some(parsed); println!("[hotkey] toggle registered OK"); }
            Err(e) => { println!("[hotkey] toggle registration FAILED: {e}"); return Err(format!("Impossible d'enregistrer le raccourci d'affichage « {toggle} » : {e}")); }
        }
    }

    println!("[hotkey] capture=\"{capture}\" toggle=\"{toggle}\"");
    Ok(())
}

/// Stocke le résultat pour que le frontend le récupère par polling.
/// Chaque appel incrémente `seq` : le frontend ignore tout payload dont le
/// numéro n'a pas changé, et traite chaque nouvelle capture exactement une fois.
fn store_overlay(payload: serde_json::Value) {
    let status = payload.get("status").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let seq = OVERLAY_SEQ.fetch_add(1, AtomicOrdering::SeqCst) + 1;
    let mut payload = payload;
    if let Some(obj) = payload.as_object_mut() {
        obj.insert("seq".to_string(), serde_json::json!(seq));
    }
    let mut s = LAST_OVERLAY_RESULT.lock().unwrap();
    *s = Some(payload);
    println!("[overlay] stored seq={seq} status={status}");
    let mut st = LAST_OVERLAY_STATUS.lock().unwrap();
    *st = status;
}

/// Capture + OCR + prix, déclenché par le raccourci ou par le bouton de test.
/// L'ordre compte : on affiche d'abord l'état « lecture en cours » pour que
/// l'appui sur la touche soit ressenti comme instantané, l'OCR prenant ~1s.
async fn run_overlay_capture(app: &AppHandle) {
    let (lang, mode, autohide) = {
        let st = app.state::<AppState>();
        let s = st.settings.lock().unwrap();
        (s.overlay_game_lang(), s.overlay_sidecar_mode(), s.overlay_autohide_sec())
    };

    if !overlay::is_tarkov_foreground() {
        println!("[overlay] capture ignorée : Tarkov n'est pas au premier plan");
        let _ = overlay::show_overlay_window(app);
        store_overlay(serde_json::json!({
            "status": "not-in-game",
            "autohide": 4,
        }));
        return;
    }

    let _ = overlay::show_overlay_window(app);
    store_overlay(serde_json::json!({ "status": "loading" }));

    match overlay::lookup_once(&lang, &mode).await {
        Ok(result) => {
            let has_item = result.get("item_name").map(|v| !v.is_null()).unwrap_or(false);
            println!("[overlay] lookup ok (item={has_item})");
            store_overlay(serde_json::json!({
                "status": "ok",
                "result": result,
                "autohide": autohide,
            }));
        }
        Err(e) => {
            eprintln!("[overlay] lookup échoué : {e}");
            store_overlay(serde_json::json!({
                "status": "error",
                "message": e,
                "autohide": autohide,
            }));
        }
    }
}

/// Déclenche la capture depuis le gestionnaire de raccourci (contexte non-async).
fn spawn_overlay_capture(app: &AppHandle) {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        run_overlay_capture(&handle).await;
    });
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
    overlay_capture_hotkey: String,
    overlay_toggle_hotkey: String,
    overlay_game_lang: String,
    overlay_autohide_sec: u32,
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
        overlay_capture_hotkey: s.overlay_capture_hotkey(),
        overlay_toggle_hotkey: s.overlay_toggle_hotkey(),
        overlay_game_lang: s.overlay_game_lang(),
        overlay_autohide_sec: s.overlay_autohide_sec(),
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
    // (Re)enregistre les raccourcis avec les nouvelles valeurs.
    if let Err(e) = apply_overlay_hotkeys(&app, &settings.overlay_capture_hotkey(), &settings.overlay_toggle_hotkey()) {
        eprintln!("[main] apply_settings: {e}");
    }
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

/// Retourne le dernier résultat d'overlay pour le frontend (polling).
#[tauri::command]
fn get_overlay_data() -> Option<serde_json::Value> {
    LAST_OVERLAY_RESULT.lock().unwrap().clone()
}

/// Test: stocke un résultat factice pour vérifier le frontend.
#[tauri::command]
fn debug_overlay_test() {
    store_overlay(serde_json::json!({
        "status": "ok",
        "result": {
            "item_name": "Test Item",
            "flea_price": 50000,
            "trader_price": 30000,
            "width": 2,
            "used_in_tasks": [{"name": "Test Quest"}],
            "barters_for": [{"trader": "Prapor", "level": 2, "items": [{"count": 1, "name": "Bandage"}]}],
            "needed_for_hideout": [{"station": "Medstation", "level": 2, "count": 3}]
        },
        "autohide": 0
    }));
    println!("[overlay] debug_overlay_test: stored fake result");
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

/// Active/désactive le sidecar + la fenêtre overlay en réponse à la case
/// « s-cursor-overlay » des réglages.
#[tauri::command]
async fn toggle_overlay(app: AppHandle, enabled: bool) -> Result<(), String> {
    overlay::toggle_overlay(&app, enabled).await
}

/// Capture manuelle déclenchée depuis l'UI (ex: un bouton « tester » dans les
/// réglages). Équivalent à appuyer sur le raccourci de capture.
#[tauri::command]
fn capture_overlay(app: AppHandle) -> Result<(), String> {
    spawn_overlay_capture(&app);
    Ok(())
}

/// Ajuste la fenêtre overlay à la taille exacte de la carte (appelée par le
/// frontend après chaque rendu). La fenêtre ne déborde donc jamais de la carte,
/// ce qui évite le grand rectangle gris du WebView2 derrière elle.
#[tauri::command]
fn set_overlay_size(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
    println!("[overlay] set_overlay_size {width}x{height}");
    overlay::resize_overlay_window(&app, width, height)
}

/// Cache la fenêtre overlay (utilisée par l'auto-masquage côté carte).
#[tauri::command]
fn hide_overlay(app: AppHandle) -> Result<(), String> {
    println!("[overlay] hide_overlay");
    overlay::hide_overlay_window(&app)
}

#[tauri::command]
fn is_tarkov_running_cmd() -> bool {
    overlay::is_tarkov_foreground()
}

#[tauri::command]
fn get_cursor_position() -> (i32, i32) {
    overlay::get_cursor_position()
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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    let state = app.state::<Hotkeys>();
                    let cfg = state.0.lock().unwrap();
                    // Comparaison directe des Shortcut (PartialEq natif).
                    let kind = if cfg.capture.as_ref() == Some(shortcut) {
                        Some("capture")
                    } else if cfg.toggle.as_ref() == Some(shortcut) {
                        Some("toggle")
                    } else {
                        None
                    };
                    let Some(kind) = kind else {
                        println!("[hotkey] {shortcut:?} pressed but unmapped");
                        return;
                    };
                    println!("[hotkey] {kind} ({shortcut:?}) triggered");

                    // On ne montre la fenêtre que si le jeu est au premier plan —
                    // sinon on capture juste le bureau et le UI devient bruyant.
                    if kind == "capture" && !overlay::is_tarkov_foreground() {
                        println!("[hotkey] capture ignored: Tarkov not in foreground");
                        return;
                    }

                    match kind {
                        "toggle" => {
                            // Affichage seulement — le sidecar continue de tourner.
                            let autohide = app
                                .state::<AppState>()
                                .settings
                                .lock()
                                .unwrap()
                                .overlay_autohide_sec();
                            drop(cfg); // unlock before toggle
                            match overlay::toggle_overlay_window(app) {
                                Ok(true) => {
                                    // Ré-affiche la dernière carte si elle existe,
                                    // sinon un contenu vide transparent resterait.
                                    // `autohide` évite qu'un Shift+F2 isolé laisse
                                    // une fenêtre vide ouverte indéfiniment.
                                    store_overlay(serde_json::json!({
                                        "status": "show",
                                        "autohide": autohide,
                                    }));
                                }
                                _ => {}
                            }
                        }
                        "capture" => {
                            drop(cfg); // unlock before async spawn
                            if let Some(window) = app.get_webview_window("overlay") {
                                // Reveal sans voler le focus (ESC/Tab restent dans le jeu).
                                overlay::reveal_overlay_no_activate(&window);
                            }
                            spawn_overlay_capture(app);
                        }
                        _ => {}
                    }
                })
                .build(),
        )
        .manage(AppState::default())
        .manage(Hotkeys(Mutex::new(HotkeySlots::default())))
        .setup(|app| {
            let handle = app.handle().clone();

            // Check and download sidecar automatically at startup
            tauri::async_runtime::spawn_blocking(move || {
                let exe_path = std::env::current_exe().unwrap_or_default();
                let exe_dir = exe_path.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf();
                let internal_dir = exe_dir.join("_internal");
                let sidecar_path = internal_dir.join("tarkov-server.exe");

                if sidecar_path.exists() {
                    println!("[main] Sidecar found at {}", sidecar_path.display());
                } else {
                    println!("[main] Sidecar not found, downloading...");
                    match overlay::download_latest_sidecar() {
                        Ok(()) => println!("[main] Sidecar downloaded successfully!"),
                        Err(e) => eprintln!("[main] Sidecar download failed: {}", e),
                    }
                }
            });

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

            // (Re)enregistre les raccourcis globaux au démarrage.
            {
                let st = handle.state::<AppState>();
                let s = st.settings.lock().unwrap();
                let _ = apply_overlay_hotkeys(&handle, &s.overlay_capture_hotkey(), &s.overlay_toggle_hotkey());
            }

        // Démarrage du sidecar en arrière-plan. Le sidecar est léger (port
            // 8765) et reste inactif tant qu'aucune capture ne provient du
            // raccourci. On le lance toujours au démarrage pour éviter de
            // devoir attendre le download/extraction quand l'utilisateur active
            // l'option pour la première fois.
            tauri::async_runtime::spawn(async move {
                if let Err(e) = overlay::start_overlay(overlay::OverlayConfig { enabled: true, ..Default::default() }).await {
                    eprintln!("[main] startup: failed to start overlay sidecar: {e}");
                } else {
                    println!("[main] Sidecar started at startup");
                }
            });

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
            // Le scan initial des logs (jusqu'à plusieurs Mo) peut prendre
            // quelques centaines de ms. On le sort du chemin critique du
            // setup : la fenêtre s'affiche tout de suite, les évènements de
            // position/quête arrivent dès que le scan est terminé.
            let watcher_handle = handle.clone();
            tauri::async_runtime::spawn_blocking(move || {
                start_watchers(&watcher_handle);
            });

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
            toggle_overlay,
            capture_overlay,
            set_overlay_size,
            hide_overlay,
            is_tarkov_running_cmd,
            get_cursor_position,
            get_overlay_data,
            debug_overlay_test,
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Tarkov Tracker");
}
