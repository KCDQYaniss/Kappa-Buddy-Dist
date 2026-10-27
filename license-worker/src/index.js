// =====================================================================
// Kappa Buddy — Worker de licence (Cloudflare Workers + D1, plan gratuit)
// =====================================================================
// Modèle (décisions du 27 oct) :
//   • un achat itch = une download key = une licence à vie ;
//   • 1 appareil par clé (MAX_BINDS=1), swap self-service 1×/30 jours ;
//   • token Ed25519 PERMA (aucune expiration) vérifié hors-ligne par l'app :
//     la révocation n'empêche que la ré-activation ailleurs (choix assumé) ;
//   • vie privée : uniquement des SHA-256 (clé, empreinte machine) — jamais
//     la clé en clair, jamais d'IP, jamais d'email, jamais d'User-Agent.
//
// L'app ne contacte ce Worker que pour ACTIVER une machine ou SWAPPER.
//
// Vérification itch (docs itch.io « Serverside API reference ») :
//   GET https://itch.io/api/1/{GAME_ID}/{DOWNLOAD_KEY}
//     → { download_key: { key, game_id, owner: {...}, ... } }
//     → { errors: ["invalid download key"] } = inconnue/révoquée/autre jeu
//   Plan B (endpoint vendeur, clé API itch en secret) :
//     GET https://itch.io/api/1/{SELLER_KEY}/my-game/{GAME_ID}/download_keys
//         ?download_key=...
//   ⚠ les deux patterns sont revalidés au déploiement avec une VRAIE clé
//     (achat réel) avant que l'app n'active le gate.
//
// Tests locaux SANS Cloudflare : node license-worker/test.js
//   (fausse D1 via node:sqlite, fausse itch via fetch stub, Ed25519 natif)
// =====================================================================

const TOKEN_PREFIX = "KB1";

// ------------------------------------------------------------- utilitaires

const enc = new TextEncoder();

/** Uint8Array → base64url (btoa existe dans Workers et Node récents). */
function b64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url → Uint8Array (tolère aussi le base64 standard pour les secrets). */
function b64urlDecode(s) {
  s = String(s).trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

/** SHA-256 d'une chaîne → hex. */
async function sha256hex(s) {
  const d = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Réponse JSON uniforme (no-store partout). CORS large sur /v1/* : aucune
 *  donnée ne passe sans la clé itch en corps, donc rien à voler par origine. */
function rjson(status, obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
    },
  });
}

/** Erreur HTTP : fail(403, "revoked") → {"error":"revoked",...extra} */
const fail = (status, error, extra) => rjson(status, { error, ...(extra || {}) });

/** Erreur d'usage levée par les handlers, convertie en réponse HTTP. */
class Bad extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.extra = extra;
  }
}

/** Comparaison en temps constant (SHA-256 des deux chaînes, 32 octets). */
async function safeEqual(a, b) {
  const da = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(a ?? ""))));
  const db = new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(String(b ?? ""))));
  let diff = 0;
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i];
  return diff === 0;
}

/** L'acheteur peut coller la clé brute OU l'URL itch complète. On extrait,
 *  on trimme, on retire espaces/tirets ; le hash est TOUJOURS recalculé après. */
function normalizeKey(input) {
  let s = String(input == null ? "" : input).trim();
  if (s.includes("/")) s = (s.split("?")[0].replace(/\/+$/, "").split("/").pop() || "").trim();
  return s.replace(/[\s\-_.]+/g, "");
}

// ------------------------------------------------------------------ itch.io

/**
 * Vérifie une download key auprès de itch.io :
 *  → { ok: true, itch_name } | { ok: false, code: "invalid_key" |
 *      "config_error" (401 du pattern vendeur) | "itch_unreachable" }
 */
async function checkKeyWithItch(env, rawKey) {
  if (!env.GAME_ID) throw new Error("config: GAME_ID manquant (wrangler.toml [vars])");
  const gid = encodeURIComponent(String(env.GAME_ID));
  const k = encodeURIComponent(rawKey);

  // Pattern 1 (docs itch) : vérification directe, sans clé vendeur.
  const targets = [`https://itch.io/api/1/${gid}/${k}`];
  // Pattern 2 (plan B, docs itch) : endpoint vendeur si la clé API est mise.
  if (env.ITCH_API_KEY) {
    const sk = encodeURIComponent(env.ITCH_API_KEY);
    targets.push(`https://itch.io/api/1/${sk}/my-game/${gid}/download_keys?download_key=${k}`);
  }

  let authError = false; // 401/403 sur l'endpoint VENDEUR → configuration fausse
  let netFail = false;   // réseau injoignable, réponse non-JSON, rate-limit
  for (let i = 0; i < targets.length; i++) {
    const direct = i === 0;
    let resp;
    try {
      // cacheTtl 0 : JAMAIS de cache d'edge sur une requête qui porte une clé.
      resp = await fetch(targets[i], {
        headers: { accept: "application/json" },
        cf: { cacheTtl: 0, cacheEverything: false },
      });
    } catch {
      netFail = true;
      continue;
    }
    if (!direct && (resp.status === 401 || resp.status === 403)) {
      authError = true;
      continue;
    }
    let data = null;
    try {
      data = await resp.json();
    } catch {
      netFail = true; // 404 HTML ou status inattendu → pattern suivant
      continue;
    }
    const res = itchExtract(data, rawKey, env);
    if (res === "invalid") return { ok: false, code: "invalid_key" };
    if (res) return { ok: true, itch_name: res.itch_name };
    // shape inconnu → pattern suivant
  }
  return { ok: false, code: authError ? "config_error" : "itch_unreachable" };
}

/** D'un body itch connu : "invalid" (définitif) | null (shape inconnu) |
 *  { itch_name }. Une liste affirmative sans notre clé = invalide. */
function itchExtract(data, rawKey, env) {
  if (!data || typeof data !== "object") return null;
  if (Array.isArray(data.errors)) return "invalid";
  const recs =
    (data.download_key && [data.download_key]) ||
    (Array.isArray(data.download_keys) ? data.download_keys : null) ||
    (Array.isArray(data.results) ? data.results : null);
  if (!recs) return null;
  const hit = recs.find((r) => r && (r.key === rawKey || r.download_key === rawKey));
  if (!hit) return "invalid";
  if (hit.game_id != null && String(hit.game_id) !== String(env.GAME_ID)) return "invalid";
  const owner = hit.owner || {};
  return { itch_name: owner.display_name || owner.username || null };
}

// ------------------------------------------------------------ token / Ed25519

let signKeyCache = null;

/** Importe la clé privée pkcs8 (secret, base64) une fois par isolate. */
async function getSignKey(env) {
  if (!signKeyCache) {
    const b64 = env.LICENSE_PRIVATE_PKCS8_B64;
    if (!b64) throw new Error("config: secret LICENSE_PRIVATE_PKCS8_B64 manquant");
    signKeyCache = await crypto.subtle.importKey("pkcs8", b64urlDecode(b64), { name: "Ed25519" }, false, ["sign"]);
  }
  return signKeyCache;
}

/** Token : KB1.<payload_base64url>.<sig_base64url>, payload { v,k,d,iat }.
 *  k = hash de la clé, d = hash de l'empreinte machine, iat = ms (info). */
async function issueToken(env, keyHash, deviceHash) {
  const payload = { v: 1, k: keyHash, d: deviceHash, iat: Date.now() };
  const head = `${TOKEN_PREFIX}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign("Ed25519", await getSignKey(env), enc.encode(head));
  return `${head}.${b64url(new Uint8Array(sig))}`;
}

// ----------------------------------------------------------------- requêtes

function getLicense(env, khash) {
  return env.DB.prepare("SELECT key_hash, itch_name, status, last_swap_at, created_at FROM licenses WHERE key_hash = ?").bind(khash).first();
}

async function getDevices(env, khash) {
  const r = await env.DB.prepare("SELECT device_hash, label, bound_at, last_token_at FROM devices WHERE key_hash = ?").bind(khash).all();
  return (r && r.results) || [];
}

function insertLicense(env, khash, itchName, t) {
  return env.DB.prepare("INSERT OR IGNORE INTO licenses (key_hash, itch_name, created_at, status, last_swap_at) VALUES (?, ?, ?, 'active', 0)").bind(khash, itchName || null, t).run();
}

function insertDevice(env, khash, dhash, label, t) {
  return env.DB.prepare("INSERT OR IGNORE INTO devices (key_hash, device_hash, label, bound_at, last_token_at) VALUES (?, ?, ?, ?, ?)").bind(khash, dhash, label || null, t, t).run();
}

function touchDevice(env, khash, dhash, t) {
  return env.DB.prepare("UPDATE devices SET last_token_at = ? WHERE key_hash = ? AND device_hash = ?").bind(t, khash, dhash).run();
}

function deleteOtherDevices(env, khash, keepHash) {
  if (keepHash == null) {
    return env.DB.prepare("DELETE FROM devices WHERE key_hash = ?").bind(khash).run();
  }
  return env.DB.prepare("DELETE FROM devices WHERE key_hash = ? AND device_hash <> ?").bind(khash, keepHash).run();
}

function setLastSwap(env, khash, t) {
  return env.DB.prepare("UPDATE licenses SET last_swap_at = ? WHERE key_hash = ?").bind(t, khash).run();
}

function setLicenseStatus(env, khash, status) {
  return env.DB.prepare("UPDATE licenses SET status = ? WHERE key_hash = ?").bind(status, khash).run();
}

function logEvent(env, khash, action, detail, t) {
  return env.DB.prepare("INSERT INTO events (ts, key_hash, action, detail) VALUES (?, ?, ?, ?)").bind(t, khash, action, detail).run();
}

// ------------------------------------------------------------------ routes

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/** L'app envoie l'empreinte en SHA-256 hex minuscule (64 caractères). */
function readDevice(body) {
  const d = String(body.device ?? "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(d)) {
    throw new Bad(400, "invalid_device", { hint: "attendu : SHA-256 hex (64 car.) de l'empreinte machine" });
  }
  return d;
}

function labelOf(body) {
  const s = String(body.label ?? "").trim();
  return s ? s.slice(0, 80) : null;
}

function cooldownMs(env) {
  return Math.max(0, Number(env.SWAP_COOLDOWN_DAYS ?? 30) || 0) * 86400000;
}

/** Corps de succès partagé activate/swap : token + signatures courtes. */
async function licensePayload(env, khash, dhash, itchName) {
  return {
    token: await issueToken(env, khash, dhash),
    key_hash: khash.slice(0, 16),
    device_hash: dhash.slice(0, 16),
    ...(itchName ? { itch_name: itchName } : {}),
  };
}

/** Échec itch normalisé en Bad ; « fail-closed » : pas de liaison sans preuve. */
function itchVerdictOrThrow(verdict) {
  if (verdict.code === "invalid_key") {
    throw new Bad(403, "invalid_key", { hint: "clé inconnue, révoquée ou d'un autre jeu itch" });
  }
  if (verdict.code === "config_error") {
    throw new Bad(500, "config_error", { hint: "Worker mal configuré (GAME_ID / ITCH_API_KEY) — voir logs" });
  }
  throw new Bad(502, "itch_unreachable", { hint: "itch.io injoignable — réessayer plus tard" });
}

async function handleActivate(env, body) {
  const t = Date.now();
  const key = normalizeKey(body.key ?? "");
  if (!key) throw new Bad(400, "missing_key", { hint: "coller la download key itch" });
  const dhash = readDevice(body);
  const khash = await sha256hex(key);

  const lic = await getLicense(env, khash);
  const devices = await getDevices(env, khash);

  // Révocation LOCALE (admin) : bloque tout, sans même appeler itch.
  if (lic && lic.status !== "active") throw new Bad(403, "revoked");

  // Appareil déjà lié : idempotent — on ré-émet un token sans rappeler itch.
  if (devices.some((d) => d.device_hash === dhash)) {
    await touchDevice(env, khash, dhash, t);
    return rjson(200, await licensePayload(env, khash, dhash, lic && lic.itch_name));
  }

  // Nouvel appareil : la clé doit être prouvée auprès d'itch.
  const verdict = await checkKeyWithItch(env, key);
  if (!verdict.ok) itchVerdictOrThrow(verdict);

  const maxBinds = Math.max(1, Number(env.MAX_BINDS ?? 1) || 1);
  if (!lic) await insertLicense(env, khash, verdict.itch_name, t);
  const cdMs = cooldownMs(env);
  const lastSwap = (lic && lic.last_swap_at) || 0;

  if (devices.length >= maxBinds) {
    const nextSwap = lastSwap + cdMs;
    throw new Bad(409, "already_bound", { max_binds: maxBinds, can_swap: nextSwap <= t, next_swap_at: nextSwap });
  }

  await insertDevice(env, khash, dhash, labelOf(body), t);
  const after = await getDevices(env, khash);
  if (!after.some((d) => d.device_hash === dhash)) {
    // Course entre deux activations simultanées : la place a été prise.
    throw new Bad(409, "already_bound", { max_binds: maxBinds, can_swap: nextSwap <= t, next_swap_at: lastSwap + cdMs });
  }

  await logEvent(env, khash, "activate", dhash.slice(0, 8), t);
  const fresh = lic || (await getLicense(env, khash));
  return rjson(200, await licensePayload(env, khash, dhash, verdict.itch_name || (fresh && fresh.itch_name)));
}

async function handleSwap(env, body) {
  const t = Date.now();
  const key = normalizeKey(body.key ?? "");
  if (!key) throw new Bad(400, "missing_key", { hint: "coller la download key itch" });
  const dhash = readDevice(body);
  const khash = await sha256hex(key);

  const lic = await getLicense(env, khash);
  if (!lic) throw new Bad(403, "unknown_key", { hint: "l'activation initiale se fait via /v1/activate" });
  if (lic.status !== "active") throw new Bad(403, "revoked");

  const devices = await getDevices(env, khash);
  const mine = devices.some((d) => d.device_hash === dhash);
  const cdMs = cooldownMs(env);

  // Déjà lié ici : rien à libérer — nouveau token, sans rappeler itch.
  if (mine) {
    await touchDevice(env, khash, dhash, t);
    return rjson(200, await licensePayload(env, khash, dhash, lic.itch_name));
  }

  // Libération d'un AUTRE appareil : cooledown self-service 1×/30 j.
  if (devices.length > 0) {
    const nextSwap = lic.last_swap_at + cdMs;
    if (t < nextSwap) {
      throw new Bad(429, "cooldown", { next_swap_at: nextSwap, hint: "libération self-service : 1 fois / 30 jours" });
    }
  }

  // Un swap = une nouvelle preuve d'achat vérifiée auprès d'itch.
  const verdict = await checkKeyWithItch(env, key);
  if (!verdict.ok) itchVerdictOrThrow(verdict);

  await deleteOtherDevices(env, khash, dhash);
  await insertDevice(env, khash, dhash, labelOf(body), t);
  await setLastSwap(env, khash, t);
  await logEvent(env, khash, devices.length > 0 ? "swap" : "activate", dhash.slice(0, 8), t);
  return rjson(200, await licensePayload(env, khash, dhash, verdict.itch_name || lic.itch_name));
}

async function handleStatus(env, body) {
  const key = normalizeKey(body.key ?? "");
  if (!key) throw new Bad(400, "missing_key");
  const khash = await sha256hex(key);

  const lic = await getLicense(env, khash);
  if (!lic) throw new Bad(404, "unknown_key");

  const devices = await getDevices(env, khash);
  const cdMs = cooldownMs(env);
  return rjson(200, {
    status: lic.status,
    devices: devices.map((d) => ({ label: d.label, bound_at: d.bound_at, device_hash: d.device_hash.slice(0, 16) })),
    next_swap_at: lic.last_swap_at + cdMs,
    can_swap: lic.last_swap_at + cdMs <= Date.now(),
  });
}

async function handleHealth(env) {
  let dbOk = false;
  let keyOk = false;
  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first();
    dbOk = !!(row && row.ok === 1);
  } catch {
    dbOk = false;
  }
  try {
    if (env.LICENSE_PRIVATE_PKCS8_B64) await getSignKey(env);
    keyOk = true;
  } catch {
    keyOk = false;
  }
  const gameOk = !!env.GAME_ID;
  const status = dbOk && keyOk && gameOk ? 200 : 503;
  return rjson(status, {
    service: "kappa-license",
    status: status === 200 ? "ok" : "degraded",
    db: dbOk ? "ok" : "error",
    sign_key: keyOk ? "ok" : "missing_or_invalid",
    game_id: gameOk ? "ok" : "missing",
  });
}

// ------------------------------------------------------------------- admin

async function resolveKeyHash(env, body) {
  if (typeof body.key_hash === "string" && /^[0-9a-f]{64}$/.test(body.key_hash)) return body.key_hash;
  const key = normalizeKey(body.key ?? "");
  return key ? await sha256hex(key) : null;
}

async function listLicenses(env) {
  const rows = await env.DB.prepare("SELECT key_hash, itch_name, status, created_at, last_swap_at FROM licenses ORDER BY created_at DESC LIMIT 500").all();
  const devs = await env.DB.prepare("SELECT key_hash, device_hash, label, bound_at FROM devices").all();
  const idx = new Map((((rows && rows.results) || [])).map((r) => [r.key_hash, { ...r, devices: [] }]));
  for (const d of ((devs && devs.results) || [])) {
    const t = idx.get(d.key_hash);
    if (t) t.devices.push({ device_hash: d.device_hash, label: d.label, bound_at: d.bound_at });
  }
  return [...idx.values()];
}

async function handleAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    throw new Bad(503, "config_error", { hint: "secret ADMIN_PASSWORD manquant (wrangler secret put)" });
  }
  const got = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(await safeEqual(got, env.ADMIN_PASSWORD))) throw new Bad(401, "unauthorized");

  const body = await readJson(request);
  switch (String(body.action ?? "")) {
    case "list":
      return rjson(200, { licenses: await listLicenses(env) });
    case "events": {
      const r = await env.DB.prepare("SELECT ts, key_hash, action, detail FROM events ORDER BY ts DESC LIMIT 200").all();
      return rjson(200, { events: (r && r.results) || [] });
    }
    case "revoke": {
      const k = await resolveKeyHash(env, body);
      if (!k) throw new Bad(404, "unknown_license");
      await setLicenseStatus(env, k, "revoked");
      await logEvent(env, k, "admin_revoke", null, Date.now());
      return rjson(200, { ok: true, key_hash: k.slice(0, 16) });
    }
    case "unrevoke": {
      const k = await resolveKeyHash(env, body);
      if (!k) throw new Bad(404, "unknown_license");
      await setLicenseStatus(env, k, "active");
      await logEvent(env, k, "admin_unrevoke", null, Date.now());
      return rjson(200, { ok: true, key_hash: k.slice(0, 16) });
    }
    case "unbind": {
      const k = await resolveKeyHash(env, body);
      if (!k) throw new Bad(404, "unknown_license");
      const before = (await getDevices(env, k)).length;
      await deleteOtherDevices(env, k, null);
      await logEvent(env, k, "admin_unbind", null, Date.now());
      return rjson(200, { ok: true, cleared: before });
    }
    case "refund": {
      // Remboursement itch : révoke ET délie tout (l'app déjà activée reste
      // débloquée : conséquence assumée du token perma, voir README).
      const k = await resolveKeyHash(env, body);
      if (!k) throw new Bad(404, "unknown_license");
      await setLicenseStatus(env, k, "revoked");
      await deleteOtherDevices(env, k, null);
      await logEvent(env, k, "admin_refund", null, Date.now());
      return rjson(200, { ok: true, key_hash: k.slice(0, 16) });
    }
    default:
      throw new Bad(400, "unknown_action", { actions: ["list", "events", "revoke", "unrevoke", "unbind", "refund"] });
  }
}

// -------------------------------------------------------------- page admin

function adminPageHtml() {
  return [
    "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>Kappa Buddy — licences</title>",
    "<style>",
    "body{font:14px/1.5 system-ui,Segoe UI,sans-serif;max-width:980px;margin:40px auto;padding:0 12px;color:#e8e6e3;background:#16161b}",
    "h1{font-size:20px} table{border-collapse:collapse;width:100%;margin-top:12px}",
    "th,td{border:1px solid #333;padding:6px 8px;text-align:left;vertical-align:top}",
    "th{background:#222} code{background:#222;padding:2px 5px;border-radius:4px;font-size:12px}",
    "input,button{font:inherit} button{cursor:pointer;background:#3b7dd8;color:#fff;border:0;border-radius:6px;padding:6px 10px;margin:2px}",
    "button.warn{background:#a33} button.ok{background:#2e7d43}",

    "#out{white-space:pre-wrap;background:#111;border:1px solid #333;padding:10px;margin-top:12px;display:none;max-height:60vh;overflow:auto}",
    ".mut{color:#888;font-size:12px}",
    "</style></head><body>",
    "<h1>Kappa Buddy — licences</h1>",
    "<p><input type=\"password\" id=\"pw\" placeholder=\"Mot de passe admin\" style=\"width:280px\"> ",
    "<button onclick=\"act('list')\">Voir les licences</button> ",
    "<button onclick=\"act('events')\">Journal</button></p>",
    "<div id=\"out\"></div>",
    "<p class=\"mut\">Les clés ne sont stockées QUE hachées (SHA-256). ",
    "Révoquer = bloque la ré-activation ailleurs ; délier = libère les appareils (l'acheteur réactive aussitôt).</p>",
    "<script>",
    "async function act(action, extra){",
    "  const pw = document.getElementById('pw').value;",
    "  if (!pw) { return show({error:'mot de passe requis'}, false); }",
    "  const r = await fetch('/admin/api', {method:'POST',",
    "    headers:{authorization:'Bearer '+pw, 'content-type':'application/json'},",
    "    body: JSON.stringify(Object.assign({action:action}, extra||{}))});",
    "  let j; try { j = await r.json(); } catch(e){ j = {error:'réponse illisible'}; }",
    "  show(j, r.ok);",
    "  if (r.ok && action!=='list' && action!=='events') { act('list'); }",
    "}",
    "function show(j, ok){",
    "  const d = document.getElementById('out'); d.style.display='block';",
    "  d.textContent = (ok ? '' : 'ERREUR — ') + JSON.stringify(j, null, 2);",
    "  if (j && j.licenses) { d.innerHTML = renderLicenses(j.licenses); }",
    "}",
    "function esc(s){return String(s==null?'':s).replace(/[&<>\\\"']/g, c => ",
    "  ({'&':'&amp;','<':'&lt;','>':'&gt;','\\\"':'&quot;',\"'\":'&#39;'}[c]));}",
    "function fmtDate(ms){ return ms ? new Date(ms).toISOString().slice(0,16).replace('T',' ') : '—'; }",
    "function renderLicenses(list){",
    "  let h = '<table><tr><th>clé (hash)</th><th>pseudo itch</th><th>statut</th><th>créée</th><th>prochain swap possible</th><th>appareils</th><th>actions</th></tr>';",
    "  for (const L of list){",
    "    h += '<tr><td><code>'+esc(L.key_hash.slice(0,16))+'…</code></td>'",
    "      + '<td>'+esc(L.itch_name||'—')+'</td>'",
    "      + '<td>'+esc(L.status)+'</td>'",
    "      + '<td>'+fmtDate(L.created_at)+'</td>'",
    "      + '<td>'+fmtDate(L.last_swap_at + 30*86400000)+'</td>'",
    "      + '<td>' + (L.devices.length ? L.devices.map(d=>esc(d.label||'[sans nom]')+' — '+esc(d.device_hash.slice(0,12))+'… ('+fmtDate(d.bound_at)+')').join('<br>') : 'aucun') + '</td>'",
    "      + '<td>'",
    "      +   (L.status==='active' ? '<button class=warn onclick=act(\\\"revoke\\\",{key_hash:\\\"'+L.key_hash+'\\\"})>Révoquer</button>' : '<button class=ok onclick=act(\\\"unrevoke\\\",{key_hash:\\\"'+L.key_hash+'\\\"})>Réactiver</button>')",
    "      +   ' <button class=warn onclick=act(\\\"unbind\\\",{key_hash:\\\"'+L.key_hash+'\\\"})>Délier tout</button>'",
    "      + '</td></tr>';",
    "  }",
    "  return h + '</table>';",
    "}",
    "</script></body></html>",
  ].join("");
}

// ------------------------------------------------------------------ export

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
        },
      });
    }
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/v1/health" && request.method === "GET") {
        return await handleHealth(env);
      }
      if (pathname === "/v1/activate" || pathname === "/v1/swap" || pathname === "/v1/status") {
        // POST uniquement : la clé ne doit jamais transiter en query string
        // (elle finirait dans des journaux d'accès).
        if (request.method !== "POST") {
          throw new Bad(405, "method_not_allowed", { hint: "POST, clé itch dans le corps JSON" });
        }
        const body = await readJson(request);
        if (pathname === "/v1/activate") return await handleActivate(env, body);
        if (pathname === "/v1/swap") return await handleSwap(env, body);
        return await handleStatus(env, body);
      }
      if (pathname === "/admin" && request.method === "GET") {
        return new Response(adminPageHtml(), {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" },
        });
      }
      if (pathname === "/admin/api" && request.method === "POST") {
        return await handleAdmin(request, env);
      }
      if (pathname === "/" && request.method === "GET") {
        return rjson(200, { service: "kappa-license", endpoints: ["/v1/health", "/v1/activate", "/v1/swap", "/v1/status", "/admin"] });
      }
      return fail(404, "not_found");
    } catch (e) {
      if (e instanceof Bad) return fail(e.status, e.message, e.extra);
      console.log("kappa-license: erreur interne", pathname, "-", String(e && e.message));
      return fail(500, "internal");
    }
  },
};

