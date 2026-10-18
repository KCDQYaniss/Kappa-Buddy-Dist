//! Diagnostic de la détection : dit précisément pourquoi la map ou les quêtes ne sont pas détectées.
//!
//! Le résultat est une liste de points (`issues`) : chacun dit ce qui a été observé, ce que ça
//! implique et quoi faire. L'interface les affiche en verdict clair, du plus grave au plus anodin.

use crate::{logs, paths};
use serde::Serialize;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Un point relevé par le diagnostic.
#[derive(Debug, Serialize, Clone, Default)]
pub struct Issue {
    /// « error » (empêche la détection), « warn » (gêne), « ok » (vérification réussie).
    pub severity: String,
    pub title: String,
    /// Ce qui a été observé, en clair.
    pub detail: String,
    /// Quoi faire. Vide pour un point qui va bien.
    pub fix: String,
}

pub const ERROR: &str = "error";
pub const WARN: &str = "warn";
pub const OK: &str = "ok";

#[derive(Debug, Serialize)]
pub struct FileInfo {
    pub name: String,
    pub bytes: u64,
    pub modified_secs_ago: Option<u64>,
}

#[derive(Debug, Serialize, Default)]
pub struct Diagnostics {
    pub logs_dir: Option<String>,
    pub logs_dir_source: String,
    /// Emplacements vérifiés automatiquement, avec « oui/non » selon qu'ils existent.
    pub tried: Vec<String>,
    pub sessions: usize,
    pub latest_session: Option<String>,
    pub files: Vec<FileInfo>,
    pub last_map_raw: Option<String>,
    pub last_map_slug: Option<String>,
    pub location_lines: usize,
    pub task_events_latest_session: usize,
    /// Dernières lignes du log de l'application (identifiants masqués) pour juger du format.
    pub recent_lines: Vec<String>,
    pub screenshots_dir: String,
    pub screenshots_dir_exists: bool,
    pub newest_screenshot: Option<String>,
    pub newest_screenshot_secs_ago: Option<u64>,
    /// Verdict structuré, prêt à afficher.
    pub issues: Vec<Issue>,
    /// Résumé texte de chaque point (compatibilité et copie de rapport).
    pub hints: Vec<String>,
}

impl Diagnostics {
    /// Enregistre un point : le titre sert aussi de résumé dans `hints`.
    fn issue(&mut self, severity: &str, title: impl Into<String>, detail: impl Into<String>, fix: impl Into<String>) {
        let title = title.into();
        self.hints.push(title.clone());
        self.issues.push(Issue { severity: severity.into(), title, detail: detail.into(), fix: fix.into() });
    }
}

fn ago(t: Option<SystemTime>) -> Option<u64> {
    SystemTime::now().duration_since(t?).ok().map(|d| d.as_secs())
}

fn read_tail(path: &Path, bytes: u64) -> String {
    let Ok(mut f) = File::open(path) else { return String::new() };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = f.seek(SeekFrom::Start(len.saturating_sub(bytes)));
    let mut buf = Vec::new();
    let _ = f.read_to_end(&mut buf);
    String::from_utf8_lossy(&buf).into_owned()
}

pub fn diagnose(manual_logs: Option<&Path>, screenshots: &Path) -> Diagnostics {
    let mut d = Diagnostics { screenshots_dir: screenshots.display().to_string(), screenshots_dir_exists: screenshots.is_dir(), ..Default::default() };

    // --- Où sont les logs ? ---
    let candidates = paths::log_dir_candidates();
    d.tried = candidates.iter().map(|p| format!("{} : {}", p.display(), if p.is_dir() { "existe" } else { "absent" })).collect();
    let logs: Option<PathBuf> = match manual_logs {
        Some(m) if m.is_dir() => {
            d.logs_dir_source = "réglage manuel".into();
            Some(m.to_path_buf())
        }
        Some(m) => {
            d.issue(
                ERROR,
                format!("Le dossier de logs indiqué n'existe pas : {}", m.display()),
                "Réglages → « Dossier des logs du jeu » pointe vers un dossier absent.".to_string(),
                "Corrige le chemin, ou vide le champ pour laisser la détection automatique.".to_string(),
            );
            d.logs_dir_source = "réglage manuel (introuvable)".into();
            None
        }
        None => {
            d.logs_dir_source = "détection automatique".into();
            paths::pick_log_dir(&candidates)
        }
    };
    d.logs_dir = logs.as_ref().map(|p| p.display().to_string());

    let Some(logs) = logs else {
        if manual_logs.is_none() {
            d.issue(
                ERROR,
                "Dossier des logs introuvable".to_string(),
                format!("Aucun emplacement connu ne contient de logs ({} vérifiés).", d.tried.len()),
                "Cherche un dossier « Logs » dans le dossier d'installation du jeu (avec Steam : …\\Escape from Tarkov\\build\\Logs) et colle son chemin dans Réglages.".to_string(),
            );
        }
        return finish(d, screenshots);
    };

    // --- Sessions et fichiers ---
    d.sessions = std::fs::read_dir(&logs)
        .map(|rd| rd.filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().starts_with("log_")).count())
        .unwrap_or(0);
    if d.sessions == 0 {
        d.issue(
            ERROR,
            "Ce dossier ne contient aucune session « log_… »".to_string(),
            format!("Le dossier {} n'a pas la structure des logs du jeu.", logs.display()),
            "Ce n'est probablement pas le bon dossier. Vise le dossier « Logs » du jeu (avec Steam : …\\Escape from Tarkov\\build\\Logs).".to_string(),
        );
        return finish(d, screenshots);
    }
    let Some(latest) = logs::latest_log_dir(&logs) else { return finish(d, screenshots) };
    d.latest_session = latest.file_name().map(|n| n.to_string_lossy().into_owned());

    let mut app_log: Option<(Option<SystemTime>, PathBuf)> = None;
    let mut notif_logs: Vec<PathBuf> = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&latest) {
        for e in rd.filter_map(Result::ok) {
            let p = e.path();
            let Ok(m) = e.metadata() else { continue };
            if p.extension().map_or(false, |x| x == "log") && d.files.len() < 20 {
                d.files.push(FileInfo { name: e.file_name().to_string_lossy().into_owned(), bytes: m.len(), modified_secs_ago: ago(m.modified().ok()) });
            }
            // Plusieurs fichiers de rotation possibles : pour la map on prend le plus récent, pour les quêtes on les lit tous.
            if logs::is_application_log(&p) && app_log.as_ref().map_or(true, |(t, _)| m.modified().ok() >= *t) {
                app_log = Some((m.modified().ok(), p.clone()));
            }
            if logs::is_notifications_log(&p) {
                notif_logs.push(p);
            }
        }
    }
    d.files.sort_by(|a, b| a.name.cmp(&b.name));
    let session_age = d.files.iter().filter_map(|f| f.modified_secs_ago).min();

    // --- Map ---
    match app_log {
        None => d.issue(
            ERROR,
            "Aucun fichier « application.log » dans la dernière session".to_string(),
            format!("Session {} : aucun fichier d'application trouvé.", d.latest_session.as_deref().unwrap_or("?")),
            "Lance une partie (au moins jusqu'au chargement du raid) puis relance ce diagnostic.".to_string(),
        ),
        Some((_, p)) => {
            let text = read_tail(&p, 4 * 1024 * 1024);
            d.location_lines = text.lines().filter(|l| l.contains("Location: ")).count();
            if let Some(hit) = text.lines().filter_map(logs::parse_map_any).last() {
                d.last_map_raw = Some(hit.raw);
                d.last_map_slug = hit.slug.map(str::to_string);
            }
            d.recent_lines = text.lines().rev().filter(|l| !l.trim().is_empty()).take(4).map(logs::redact).collect::<Vec<_>>().into_iter().rev().collect();
            if d.last_map_raw.is_none() {
                d.issue(
                    WARN,
                    "Le log ne contient aucune ligne de map".to_string(),
                    "Le fichier est lisible mais aucune ligne « Location: » n'y a été trouvée.".to_string(),
                    "Lance une partie jusqu'au chargement du raid, prends une capture d'écran, puis relance ce diagnostic.".to_string(),
                );
            } else if d.last_map_slug.is_none() {
                d.issue(
                    WARN,
                    format!("Map « {} » trouvée mais non reconnue", d.last_map_raw.as_deref().unwrap_or("")),
                    "Le nom de la carte dans le log ne correspond à aucune carte connue.".to_string(),
                    "Signale-le : la correspondance sera ajoutée dans une prochaine version.".to_string(),
                );
            }
        }
    }

    // --- Quêtes ---
    if notif_logs.is_empty() {
        d.issue(
            WARN,
            "Aucun fichier de notifications dans la dernière session".to_string(),
            "Sans lui, les quêtes démarrées ou terminées en jeu ne peuvent pas être détectées.".to_string(),
            "Vérifie le dossier des logs, puis lance une partie et relance ce diagnostic.".to_string(),
        );
    }
    for p in &notif_logs {
        let mut parser = logs::NotifParser::default();
        if let Ok(f) = File::open(p) {
            for raw in std::io::BufRead::split(std::io::BufReader::new(f), b'\n').filter_map(Result::ok) {
                if parser.push(String::from_utf8_lossy(&raw).trim_end_matches('\r')).is_some() {
                    d.task_events_latest_session += 1;
                }
            }
        }
    }
    if !notif_logs.is_empty() && d.task_events_latest_session == 0 {
        d.issue(
            WARN,
            "Aucun évènement de quête lu dans la dernière session".to_string(),
            format!("{} fichier(s) de notifications lu(s), aucun message de quête reconnu.", notif_logs.len()),
            "C'est normal si tu n'as pas démarré ni terminé de quête dans cette partie. Sinon, copie les détails ci-dessous dans un rapport.".to_string(),
        );
    }
    if let Some(age) = session_age {
        if age > 24 * 3600 {
            d.issue(
                WARN,
                "La dernière session de logs date d'il y a plus d'un jour".to_string(),
                format!("Fichiers modifiés il y a {} h.", age / 3600),
                "Le suivi en direct reprendra dès que le jeu écrira dans un nouveau log.".to_string(),
            );
        }
    }
    finish(d, screenshots)
}

fn finish(mut d: Diagnostics, screenshots: &Path) -> Diagnostics {
    if !d.screenshots_dir_exists {
        d.issue(
            ERROR,
            "Le dossier de captures n'existe pas".to_string(),
            format!("{} est absent.", screenshots.display()),
            "Sans captures, la position sur la carte ne peut pas être suivie. Il est créé par le jeu à la première capture ; prends-en une en jeu.".to_string(),
        );
    } else {
        let newest = std::fs::read_dir(screenshots)
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.file_name().to_string_lossy().into_owned())))
            .max_by_key(|(t, _)| *t);
        match newest {
            Some((t, n)) => {
                d.newest_screenshot = Some(n);
                d.newest_screenshot_secs_ago = ago(Some(t));
                if let Some(age) = d.newest_screenshot_secs_ago {
                    if age > 30 * 24 * 3600 {
                        d.issue(
                            WARN,
                            "Aucune capture d'écran récente".to_string(),
                            format!("La plus récente ({}) date de {} jours.", d.newest_screenshot.as_deref().unwrap_or("?"), age / 86400),
                            "Prends une capture en jeu avec la touche dédiée : la position se mettra à jour.".to_string(),
                        );
                    }
                }
            }
            None => d.issue(
                WARN,
                "Aucune capture d'écran dans le dossier".to_string(),
                format!("{} est vide.", screenshots.display()),
                "Prends une capture en jeu avec la touche dédiée : la position se mettra à jour.".to_string(),
            ),
        }
    }
    if d.issues.is_empty() {
        d.issue(
            OK,
            "Tout semble en ordre côté logs.".to_string(),
            "Logs, map et quêtes sont lisibles : la détection fonctionne.".to_string(),
            "".to_string(),
        );
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("tarkov-diag-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn dossier_manuel_inexistant() {
        let d = diagnose(Some(Path::new("Z:\\nulle part")), &tmp("s1"));
        assert!(d.logs_dir.is_none());
        assert!(d.hints.iter().any(|h| h.contains("n'existe pas")));
    }

    #[test]
    fn mauvais_dossier_sans_sessions() {
        let logs = tmp("l2");
        let d = diagnose(Some(&logs), &tmp("s2"));
        assert_eq!(d.sessions, 0);
        assert!(d.hints.iter().any(|h| h.contains("log_")));
    }

    #[test]
    fn map_et_quetes_detectees() {
        let logs = tmp("l3");
        let s = logs.join("log_2026.10.04_10-00-00_1.0");
        std::fs::create_dir_all(&s).unwrap();
        std::fs::write(s.join("x application.log"), "bruit\n2026-10-04 10:00:00.000 +02:00|1.0|Info|application|TRACE-NetworkGameCreate profileStatus: 'ProfileId: abc, Ip: 9.9.9.9, Location: bigmap, Sid: z'\n").unwrap();
        std::fs::write(s.join("x notifications.log"), "").unwrap();
        let d = diagnose(Some(&logs), &tmp("s3"));
        assert_eq!(d.last_map_slug.as_deref(), Some("customs"));
        assert_eq!(d.location_lines, 1);
        assert!(d.recent_lines.iter().all(|l| !l.contains("9.9.9.9") && !l.contains("abc")), "{:?}", d.recent_lines);
        assert_eq!(d.sessions, 1);
        assert_eq!(d.files.len(), 2);
    }

    #[test]
    fn quetes_comptees_dans_tous_les_fichiers_de_rotation() {
        let logs = tmp("l5");
        let s = logs.join("log_2026.10.04_10-00-00_1.0");
        std::fs::create_dir_all(&s).unwrap();
        let evt = |id: &str| format!("2026-10-04 10:00:00.000 +02:00|1.0|Info|push-notifications|Got notification | ChatMessageReceived\n{{\n \"message\": {{\n  \"type\": 12,\n  \"templateId\": \"{id} successMessageText 0\"\n }}\n}}\n");
        std::fs::write(s.join("x notifications_000.log"), evt("5936d90786f7742b1420ba5b")).unwrap();
        std::fs::write(s.join("x notifications_001.log"), evt("5a27b75b86f7742e97191958")).unwrap();
        let d = diagnose(Some(&logs), &tmp("s5"));
        assert_eq!(d.task_events_latest_session, 2);
        assert!(!d.hints.iter().any(|h| h.contains("Aucun fichier de notifications")));
    }

    #[test]
    fn log_sans_ligne_de_map() {
        let logs = tmp("l4");
        let s = logs.join("log_2026.10.04_10-00-00_1.0");
        std::fs::create_dir_all(&s).unwrap();
        std::fs::write(s.join("x application.log"), "rien d'utile\n").unwrap();
        let d = diagnose(Some(&logs), &tmp("s4"));
        assert!(d.last_map_raw.is_none());
        assert!(d.hints.iter().any(|h| h.contains("aucune ligne de map")));
    }
}
