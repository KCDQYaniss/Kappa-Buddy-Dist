//! Messages destinés à l'utilisateur, sous forme codée : `code` ou `code {"k":v,…}`.
//!
//! Le Rust ne traduit pas : il émet un code stable avec ses paramètres JSON, et
//! l'interface résout la traduction dans la langue choisie (i18n.js). Un code que
//! l'interface ne connaît pas s'affiche tel quel — compatibilité avant/arrière
//! garantie sans couplage entre les deux côtés.

use serde_json::{json, Value};

/// Message codé sans paramètre : le message est le code seul.
pub fn code(code: &str) -> String {
    code.to_string()
}

/// Message codé avec paramètres : `code {"k":v,…}` (JSON compact après un espace).
/// Sans paramètre utile, retombe sur le code seul.
pub fn msg(code: &str, params: Value) -> String {
    match params.as_object() {
        Some(o) if !o.is_empty() => format!("{code} {}", Value::Object(o.clone())),
        _ => code.to_string(),
    }
}

/// Variante pratique quand les paramètres sont construits à la main.
pub fn msg_empty(code: &str) -> String {
    code.to_string()
}

/// Valeur de paramètre pratique : `json!({"e": err.to_string()})` reste l'usage
/// courant ; ce helper évite juste le bruit sur les appels sans paramètre.
pub fn no_params() -> Value {
    json!({})
}
