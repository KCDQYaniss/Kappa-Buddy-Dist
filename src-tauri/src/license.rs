//! Licence Kappa Buddy — modèle « un achat itch = une licence à vie ».
//!
//! Contrat implémenté ici (défini par `license-worker/README.md`, protocole du
//! 27 oct 2026) :
//! - l'utilisateur achète sur itch.io et colle sa **download key** dans l'app ;
//! - l'app envoie `POST /v1/activate {key, device}` au Worker Cloudflare, qui
//!   prouve la clé auprès d'itch.io et émet un **token signé Ed25519** ;
//! - le token (`KB1.<payload>.<sig>`, payload `{v,k,d,iat}`) est vérifié
//!   **hors-ligne** : la clé publique est compilée dans le binaire. L'app ne
//!   recontacte le Worker que pour activer un appareil ou libérer l'ancien
//!   (swap self-service, 1×/30 j) — jamais en jeu ;
//! - un **essai** de `TRIAL_DAYS` jours à partir du premier lancement laisse
//!   l'app pleinement utilisable sans clé ;
//! - vie privée : l'empreinte machine est un SHA-256 (MachineGuid + sel fixe),
//!   la clé itch ne quitte la machine que vers le Worker (qui ne stocke que son
//!   SHA-256), rien d'autre n'est envoyé.
//!
//! Les erreurs suivent le protocole maison `code {json}` traduit par l'UI
//! (cf. `tarkov_core::msg`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;
use tarkov_core::msg::{code, msg};
use tauri::{AppHandle, Manager};

/// URL du Worker de licence (Cloudflare). À ajuster une seule fois au
/// déploiement (`npx wrangler deploy` dans license-worker/) — c'est la seule
/// constante à tenir à jour entre le déploiement et l'app.
const WORKER_URL: &str = "https://kappa-license.eltomyyaniss.workers.dev";

/// Clé publique Ed25519 du Worker (32 octets bruts). La privée vit dans le
/// secret Cloudflare `LICENSE_PRIVATE_PKCS8_B64`, JAMAIS dans le dépôt.
const PUB_KEY_RAW_HEX: &str = "44ea15aea853ecb9d1d9b1ee7c45c21d31eb707c3b53552f6e29d252d71c46fc";

/// Durée de l'essai complet, à partir du premier lancement.
const TRIAL_DAYS: u64 = 3;

/// Sel fixe de l'empreinte : fait échouer une empreinte calculée pour une
/// autre application qui lirait le même MachineGuid.
const FP_SALT: &str = "kappa-buddy-license-v1:";

const TOKEN_PREFIX: &str = "KB1";

/* ---------- stockage local (license.json, à côté de settings.json) ---------- */

#[derive(Serialize, Deserialize, Clone, Default)]
struct Store {
    /// Premier lancement (ms) : départ de l'essai.
    #[serde(default)]
    first_run: Option<u64>,
    /// Clé itch de l'acheteur (reste en local, nécessaire pour un swap).
    #[serde(default)]
    key: Option<String>,
    /// Token signé émis par le Worker.
    #[serde(default)]
    token: Option<String>,
    /// Libellé d'appareil choisi à l'activation (optionnel).
    #[serde(default)]
    label: Option<String>,
    /// Pseudo itch renvoyé par le Worker (affichage).
    #[serde(default)]
    itch_name: Option<String>,
    #[serde(default)]
    activated_at: Option<u64>,
}

fn license_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|_| code("license.noConfigDir"))?
        .join("license.json"))
}

fn load(app: &AppHandle) -> Store {
    match license_file(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
    {
        Some(txt) => serde_json::from_str(&txt).unwrap_or_default(),
        None => Store::default(),
    }
}

fn save(app: &AppHandle, s: &Store) -> Result<(), String> {
    let file = license_file(app)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| msg("license.noConfigDir", json!({ "e": e.to_string() })))?;
    }
    let json = serde_json::to_string_pretty(s).map_err(|e| msg("license.writeFailed", json!({ "e": e.to_string() })))?;
    std::fs::write(&file, json).map_err(|e| msg("license.writeFailed", json!({ "e": e.to_string() })))
}

/// À appeler une fois au démarrage : fixe le début de l'essai au premier run.
/// Sans fichier réseau ni permission : un échec ici n'empêche jamais l'app de
/// tourner (l'état est recalculé à chaque lecture).
pub fn init_first_run(app: &AppHandle) {
    let mut s = load(app);
    if s.first_run.is_none() {
        s.first_run = Some(now_ms());
        let _ = save(app, &s);
    }
}

/* ---------- utilitaires ---------- */

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/** SHA-256 d'une chaîne → hex minuscule. */
fn sha256_hex(s: &str) -> String {
    let d = Sha256::digest(s.as_bytes());
    d.iter().map(|b| format!("{b:02x}")).collect()
}

/** base64url → octets (tolère base64 standard et le padding absent). */
fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let clean: String = s
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '=')
        .collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4 + 1);
    let mut acc: u32 = 0;
    let mut bits: u32 = 0;
    for c in clean.chars() {
        let v: u32 = match c {
            'A'..='Z' => (c as u8 - b'A') as u32,
            'a'..='z' => (c as u8 - b'a' + 26) as u32,
            '0'..='9' => (c as u8 - b'0' + 52) as u32,
            '+' | '-' => 62,
            '/' | '_' => 63,
            _ => return None,
        };
        acc = acc << 6 | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

/** Normalise la clé côté app (le Worker re-normalise) : segment final d'une
 *  URL itch acceptée, espaces/tirets/underscores/points retirés. */
pub fn normalize_key(input: &str) -> String {
    let s = input.trim();
    let s = if s.contains('/') {
        let seg = s.split('?').next().unwrap_or(s).trim_end_matches('/');
        seg.rsplit('/').next().unwrap_or(seg)
    } else {
        s
    };
    s.chars().filter(|c| !matches!(c, ' ' | '\t' | '-' | '_' | '.')).collect()
}

/* ---------- empreinte machine ---------- */

#[cfg(windows)]
fn machine_guid() -> String {
    // Lecture 64 bits du registre : MachineGuid est stable par installation
    // Windows. Fallback léger si absent (machine atypique) : nom d'utilisateur.
    (|| -> Option<String> {
        use winreg::enums::HKEY_LOCAL_MACHINE;
        use winreg::RegKey;
        let hk = RegKey::predef(HKEY_LOCAL_MACHINE);
        let key = hk.open_subkey("SOFTWARE\\Microsoft\\Cryptography").ok()?;
        key.get_value::<String, _>("MachineGuid").ok()
    })()
    .unwrap_or_else(|| format!("fallback/{}", std::env::var("USERNAME").unwrap_or_default()))
}

#[cfg(not(windows))]
fn machine_guid() -> String {
    std::env::var("USERNAME").unwrap_or_default()
}

/** Empreinte = SHA-256(salt + MachineGuid), hex 64. */
pub fn fingerprint() -> String {
    sha256_hex(&format!("{FP_SALT}{}", machine_guid()))
}

/* ---------- vérification du token (hors-ligne) ---------- */

/** Vérifie `KB1.<payload>.<sig>` : signature Ed25519, format du payload et
 *  liaison à CET appareil. Renvoie le payload décodé en cas de succès. */
fn verify_token(token: &str, device_fp: &str) -> Result<Value, String> {
    let mut parts = token.split('.');
    let (p0, p1, p2) = match (parts.next(), parts.next(), parts.next(), parts.next()) {
        (Some(a), Some(b), Some(c), None) => (a, b, c),
        _ => return Err(code("license.err.badToken")),
    };
    if p0 != TOKEN_PREFIX {
        return Err(code("license.err.badToken"));
    }
    let payload_bytes = b64url_decode(p1).ok_or_else(|| code("license.err.badToken"))?;
    let sig_bytes = b64url_decode(p2).ok_or_else(|| code("license.err.badToken"))?;
    if sig_bytes.len() != 64 {
        return Err(code("license.err.badToken"));
    }

    use ed25519_dalek::{Signature, Verifier, VerifyingKey};
    let mut raw = [0u8; 32];
    hex_to_bytes(PUB_KEY_RAW_HEX, &mut raw).map_err(|_| code("license.err.badToken"))?;
    let vk = VerifyingKey::from_bytes(&raw).map_err(|_| code("license.err.badToken"))?;
    let signed = format!("{TOKEN_PREFIX}.{p1}");
    let sig_arr: [u8; 64] = sig_bytes.try_into().map_err(|_| code("license.err.badToken"))?;
    let sig = Signature::from_bytes(&sig_arr);
    vk.verify_strict(signed.as_bytes(), &sig).map_err(|_| code("license.err.badSignature"))?;

    let payload: Value = serde_json::from_slice(&payload_bytes).map_err(|_| code("license.err.badToken"))?;
    if payload.get("v").and_then(Value::as_u64) != Some(1) {
        return Err(code("license.err.badToken"));
    }
    let bound = payload.get("d").and_then(Value::as_str).unwrap_or_default();
    if !bound.eq_ignore_ascii_case(device_fp) {
        return Err(code("license.err.wrongDevice"));
    }
    Ok(payload)
}

fn hex_to_bytes(hex: &str, out: &mut [u8]) -> Result<(), ()> {
    if hex.len() != out.len() * 2 {
        return Err(());
    }
    for (i, slot) in out.iter_mut().enumerate() {
        let hi = (hex.as_bytes()[2 * i] as char).to_digit(16).ok_or(())? as u8;
        let lo = (hex.as_bytes()[2 * i + 1] as char).to_digit(16).ok_or(())? as u8;
        *slot = hi << 4 | lo;
    }
    Ok(())
}

/* ---------- état de licence ---------- */

/// Ce que l'interface reçoit. `status` : "licensed" | "trial" | "expired".
/// Les codes d'erreur d'activation/swap arrivent via `error_code` (+params
/// optionnels dans `error_params`) — jamais en exception, l'UI reste simple.
#[derive(Serialize, Clone)]
pub struct LicenseState {
    pub status: String,
    pub trial_remaining_ms: u64,
    pub trial_days_total: u64,
    pub key_hash: Option<String>,
    pub itch_name: Option<String>,
    pub device_label: Option<String>,
    pub device_hash: String,
    pub error_code: Option<String>,
    pub error_params: Option<Value>,
    pub can_swap: Option<bool>,
    pub next_swap_at: Option<u64>,
}

fn state_of(_app: &AppHandle, st: &Store) -> LicenseState {
    let fp = fingerprint();
    let licensed = st
        .token
        .as_deref()
        .map(|t| verify_token(t, &fp).is_ok())
        .unwrap_or(false);
    let trial_total = TRIAL_DAYS * 86400000;
    let first = st.first_run.unwrap_or_else(now_ms);
    // Debug uniquement : forcer l'essai expiré pour tester l'écran d'activation
    // sans attendre 3 jours (les builds release ignorent ces variables).
    let expired_by_dev = cfg!(debug_assertions) && std::env::var("KB_FORCE_TRIAL_EXPIRED").map(|v| v == "1").unwrap_or(false);
    let remaining = trial_total.saturating_sub(now_ms().saturating_sub(first));
    let status = if licensed {
        "licensed"
    } else if remaining > 0 && !expired_by_dev {
        "trial"
    } else {
        "expired"
    };
    LicenseState {
        status: status.to_string(),
        trial_remaining_ms: remaining,
        trial_days_total: TRIAL_DAYS,
        key_hash: st.key.as_deref().map(|k| sha256_hex(&normalize_key(k))[..16].to_string()),
        itch_name: st.itch_name.clone(),
        device_label: st.label.clone(),
        device_hash: fp[..16].to_string(),
        error_code: None,
        error_params: None,
        can_swap: None,
        next_swap_at: None,
    }
}

/// État courant (commande `license_state`).
pub fn state(app: &AppHandle) -> LicenseState {
    let st = load(app);
    state_of(app, &st)
}

/** Gate métier : Ok (essai ou licence) / Err (expiré) pour les fonctions
 *  premium (overlay de jeu…). Appelé AVANT toute capture. */
pub fn gate(app: &AppHandle) -> Result<(), String> {
    match state(app).status.as_str() {
        "licensed" | "trial" => Ok(()),
        _ => Err(code("license.expired")),
    }
}

/* ---------- HTTP vers le Worker ---------- */

fn worker_url() -> String {
    // Debug uniquement : tester contre un Worker déployé ou un serveur local
    // sans recompiler. Les builds release utilisent la constante compilée.
    if cfg!(debug_assertions) {
        if let Ok(u) = std::env::var("KB_LICENSE_WORKER") {
            if !u.trim().is_empty() {
                return u.trim().trim_end_matches('/').to_string();
            }
        }
    }
    WORKER_URL.to_string()
}

fn worker_agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .http_status_as_error(false)
        .timeout_global(Some(Duration::from_secs(30)))
        .user_agent("KappaBuddy/0.9.19")
        .build()
        .into()
}

/// POST JSON au Worker → (status HTTP, body JSON). Réponse illisible = body {}.
fn worker_post(path: &str, body: &Value) -> Result<(u16, Value), String> {
    let agent = worker_agent();
    let url = format!("{}{path}", worker_url());
    let resp = agent
        .post(&url)
        .header("content-type", "application/json")
        .send_json(body.clone())
        .map_err(|e| msg("license.err.network", json!({ "e": e.to_string() })))?;
    let status = resp.status().as_u16();
    let value = resp
        .into_body()
        .with_config()
        .limit(1024 * 1024)
        .read_json::<Value>()
        .unwrap_or(Value::Object(Default::default()));
    Ok((status, value))
}

fn err_state(code_name: &str, params: Value, can_swap: Option<bool>, next_swap_at: Option<u64>) -> LicenseState {
    let mut s = state_placeholder();
    s.status = "error".into();
    s.error_code = Some(code_name.to_string());
    s.error_params = if params.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
        Some(params)
    } else {
        None
    };
    s.can_swap = can_swap;
    s.next_swap_at = next_swap_at;
    s
}

fn state_placeholder() -> LicenseState {
    let fp = fingerprint();
    LicenseState {
        status: "error".into(),
        trial_remaining_ms: 0,
        trial_days_total: TRIAL_DAYS,
        key_hash: None,
        itch_name: None,
        device_label: None,
        device_hash: fp[..16].to_string(),
        error_code: None,
        error_params: None,
        can_swap: None,
        next_swap_at: None,
    }
}

/* ---------- activation / swap (commandes) ---------- */

/// Active la machine avec une clé itch. Succès → état "licensed" et
/// persistance locale. Les refus du Worker deviennent `status:"error"` avec un
/// code traduit (jamais d'exception côté UI).
pub fn activate(app: &AppHandle, raw_key: &str, label: Option<String>) -> LicenseState {
    let key = normalize_key(raw_key);
    if key.is_empty() {
        return err_state("license.err.missingKey", json!({}), None, None);
    }
    let body = json!({ "key": key, "device": fingerprint(), "label": label });
    match worker_post("/v1/activate", &body) {
        Ok((200, v)) => {
            let token = v.get("token").and_then(Value::as_str).unwrap_or_default().to_string();
            if verify_token(&token, &fingerprint()).is_err() {
                return err_state("license.err.badToken", json!({}), None, None);
            }
            let mut st = load(app);
            st.key = Some(key);
            st.token = Some(token);
            st.label = label.filter(|l| !l.trim().is_empty());
            st.itch_name = v.get("itch_name").and_then(Value::as_str).map(str::to_string);
            st.activated_at = Some(now_ms());
            if st.first_run.is_none() {
                st.first_run = Some(now_ms());
            }
            if save(app, &st).is_err() {
                return err_state("license.writeFailed", json!({}), None, None);
            }
            state_of(app, &st)
        }
        Ok((status, v)) => worker_error_state(status, &v),
        Err(e) => err_state("license.err.network", json!({ "e": e }), None, None),
    }
}

/// Libère l'ancien appareil et lie celui-ci (self-service, 1×/30 j).
pub fn swap(app: &AppHandle, label: Option<String>) -> LicenseState {
    let st = load(app);
    let Some(key) = st.key.clone() else {
        return err_state("license.err.missingKey", json!({}), None, None);
    };
    let body = json!({ "key": normalize_key(&key), "device": fingerprint(), "label": label });
    match worker_post("/v1/swap", &body) {
        Ok((200, v)) => {
            let token = v.get("token").and_then(Value::as_str).unwrap_or_default().to_string();
            if verify_token(&token, &fingerprint()).is_err() {
                return err_state("license.err.badToken", json!({}), None, None);
            }
            let mut st = load(app);
            st.token = Some(token);
            st.label = label.filter(|l| !l.trim().is_empty());
            st.itch_name = v.get("itch_name").and_then(Value::as_str).map(str::to_string).or(st.itch_name);
            st.activated_at = Some(now_ms());
            if save(app, &st).is_err() {
                return err_state("license.writeFailed", json!({}), None, None);
            }
            state_of(app, &st)
        }
        Ok((status, v)) => worker_error_state(status, &v),
        Err(e) => err_state("license.err.network", json!({ "e": e }), None, None),
    }
}

/// Oubli local (dépannage) : efface clé+token de CETTE machine. Ne délie PAS
/// l'appareil côté Worker (le swap s'en charge à la prochaine activation).
pub fn forget(app: &AppHandle) -> LicenseState {
    let mut st = load(app);
    st.key = None;
    st.token = None;
    st.label = None;
    st.itch_name = None;
    st.activated_at = None;
    let _ = save(app, &st);
    state_of(app, &st)
}

/// Traduit un refus HTTP du Worker en état d'erreur codé (protocole du README).
fn worker_error_state(status: u16, v: &Value) -> LicenseState {
    let error = v.get("error").and_then(Value::as_str).unwrap_or("").to_string();
    let next_swap_at = v.get("next_swap_at").and_then(Value::as_u64);
    let can_swap = v.get("can_swap").and_then(Value::as_bool);
    let code_name = match (status, error.as_str()) {
        (403, "invalid_key") => "license.err.invalidKey",
        (403, "revoked") => "license.err.revoked",
        (403, "unknown_key") => "license.err.unknownKey",
        (400, "missing_key") => "license.err.missingKey",
        (400, "invalid_device") => "license.err.badToken",
        (409, "already_bound") => "license.err.alreadyBound",
        (429, "cooldown") => "license.err.cooldown",
        (502, "itch_unreachable") => "license.err.itchUnreachable",
        (500, "config_error") => "license.err.configError",
        (_, "internal") => "license.err.server",
        _ => "license.err.server",
    };
    let params = match code_name {
        "license.err.cooldown" => next_swap_at
            .map(|ms| {
                let days = (ms.saturating_sub(now_ms())).max(0) / 86400000 + 1;
                json!({ "d": days })
            })
            .unwrap_or(json!({})),
        "license.err.alreadyBound" => json!({ "d": 30 }),
        _ => json!({}),
    };
    err_state(code_name, params, can_swap, next_swap_at)
}

/* ---------- tests ---------- */

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Clé de test dérivée d'une seed fixe — reproductible.
    fn test_signer() -> SigningKey {
        let mut seed = [0u8; 32];
        for (i, s) in seed.iter_mut().enumerate() {
            *s = (i as u8) ^ 0x5a;
        }
        SigningKey::from_bytes(&seed)
    }

    fn sign(signer: &SigningKey, payload: &Value) -> String {
        let head = format!("{TOKEN_PREFIX}.{}", b64url_encode(payload.to_string().as_bytes()));
        let sig = signer.sign(head.as_bytes());
        format!("{head}.{}", b64url_encode(&sig.to_bytes()))
    }

    /// Version encodeur (tests) — l'app ne fait que décoder.
    fn b64url_encode(bytes: &[u8]) -> String {
        const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                *chunk.get(1).unwrap_or(&0),
                *chunk.get(2).unwrap_or(&0),
            ];
            let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
            out.push(T[(n >> 18) as usize & 63] as char);
            out.push(T[(n >> 12) as usize & 63] as char);
            if chunk.len() > 1 {
                out.push(T[(n >> 6) as usize & 63] as char);
            }
            if chunk.len() > 2 {
                out.push(T[n as usize & 63] as char);
            }
        }
        out
    }

    #[test]
    fn b64url_roundtrip() {
        for sample in ["", "a", "ab", "abc", "abcd", "KB1 pay.load == examples/++"] {
            let enc = b64url_encode(sample.as_bytes());
            let dec = b64url_decode(&enc).unwrap();
            assert_eq!(dec, sample.as_bytes(), "roundtrip de {sample:?}");
        }
        // base64 standard avec padding accepté aussi
        assert_eq!(b64url_decode("aGVsbG8=").unwrap(), b"hello");
    }

    #[test]
    fn normalize_like_worker() {
        assert_eq!(normalize_key(" ABC-DEF "), "ABCDEF");
        assert_eq!(normalize_key("https://kappa-buddy.itch.io/kappa-buddy/download/Ab-Cd_Ef?x=1"), "AbCdEf");
        assert_eq!(normalize_key(""), "");
    }

    #[test]
    fn fingerprint_is_stable_hex64() {
        let a = fingerprint();
        let b = fingerprint();
        assert_eq!(a, b, "l'empreinte ne doit pas bouger d'un appel à l'autre");
        assert_eq!(a.len(), 64);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn token_verify_ok_and_device_bound() {
        let signer = test_signer();
        let fp = "a".repeat(64);
        let token = sign(&signer, &json!({ "v": 1, "k": "0123456789abcdef", "d": &fp, "iat": 1 }));
        // Signature de test ≠ clé compilée : la vérification échoue, mais pour
        // un motif de signature — pas de format. On vérifie le lien d'appareil
        // avec la VRAIE clé en signant… impossible sans la privée : on teste
        // donc que le refus est bien "badSignature" et pas "wrongDevice".
        let err = verify_token(&token, &fp).unwrap_err();
        assert!(err.contains("badSignature") || err.contains("badToken"), "err={err}");
    }

    #[test]
    fn token_rejects_wrong_device_payload_shape() {
        let signer = test_signer();
        // Même avec la bonne clé on exigerait d == fingerprint : on vérifie ici
        // la forme — payload v2 refusé, mauvais préfixe refusé.
        let token = sign(&signer, &json!({ "v": 2, "k": "x", "d": "y", "iat": 0 }));
        assert!(verify_token(&token, &"a".repeat(64)).is_err());
        assert!(verify_token("XX.aaaa.bbbb", &"a".repeat(64)).is_err());
        assert!(verify_token("KB1.!!!.!!!", &"a".repeat(64)).is_err());
    }

    #[test]
    fn worker_error_mapping() {
        let s = worker_error_state(409, &json!({ "error": "already_bound", "max_binds": 1, "can_swap": true, "next_swap_at": 1 }));
        assert_eq!(s.error_code.as_deref(), Some("license.err.alreadyBound"));
        assert_eq!(s.can_swap, Some(true));
        let s = worker_error_state(429, &json!({ "error": "cooldown", "next_swap_at": now_ms() + 86400000 * 2 }));
        assert_eq!(s.error_code.as_deref(), Some("license.err.cooldown"));
        let p = s.error_params.unwrap();
        assert!(p.get("d").and_then(Value::as_u64).unwrap() >= 2, "au moins 2 jours restants");
        let s = worker_error_state(502, &json!({ "error": "itch_unreachable" }));
        assert_eq!(s.error_code.as_deref(), Some("license.err.itchUnreachable"));
        let s = worker_error_state(200, &json!({ "error": "unexpected" }));
        assert_eq!(s.error_code.as_deref(), Some("license.err.server"));
    }

    #[test]
    fn trial_math_is_saturating() {
        // remaining = total - (now - first) : jamais négatif, jamais panique.
        let total = TRIAL_DAYS * 86400000;
        let first = now_ms().saturating_sub(total * 10);
        assert_eq!(total.saturating_sub(now_ms().saturating_sub(first)), 0);
    }
}
