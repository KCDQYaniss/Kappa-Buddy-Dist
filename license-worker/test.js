#!/usr/bin/env node
// =====================================================================
// Kappa Buddy — suite locale du Worker de licence (license-worker/test.js)
// =====================================================================
// Tourne SANS Cloudflare et SANS réseau : fausse D1 en mémoire
// (node:sqlite + schema.sql réel), fausse itch (fetch substitué),
// Ed25519 natif de Node. La signature des tokens est vérifiée à part,
// avec la clé publique — exactement comme le fera license.rs.
//
//   node license-worker/test.js
//
// Couvert : health, activation, idempotence, refus 2e appareil, swap +
// cooldown, ré-échange après 31 jours, clé inconnue/clé d'un autre jeu,
// status, admin (401 / list / revoke / unrevoke / unbind / refund / events),
// entrées malformées, normalisation URL, fallback endpoint vendeur,
// itch injoignable, confidentialité (aucune clé brute dans les réponses).
// =====================================================================
"use strict";

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import nc from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOST = "http://kappa-license.test";

const sha256hex = (s) => nc.createHash("sha256").update(s).digest("hex");

// Empreintes machines (comme l'app : SHA-256 hex de MachineGuid)
const H1 = sha256hex("machine-guid-1");
const H2 = sha256hex("machine-guid-2");
const H3 = sha256hex("machine-guid-3");

// Clés de test (format itch : 20 car. alphanumériques sensibles à la casse)
const KEY_A = "AbCdEfGhIjKlMnOpQrSt"; // acheteur A (Acheteur Test)
const KEY_B = "ZzYyXwVuTsRqPoNmLkJi"; // acheteur B (Deuxieme Acheteur)
const KEY_C = "RrSsTtUuVvWwXxYyZz01"; // jamais vendue / autre jeu
const GAME_ID = "123456";

const ALL_RAW_KEYS = [KEY_A, KEY_B, KEY_C];

// ------------------------------------------------------------- D1 en mémoire

/** Façade D1 minimale sur node:sqlite (:memory:) — appelle le schema.sql réel,
 *  comme `wrangler d1 execute --local` le fera le jour du déploiement. */
function makeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec(fs.readFileSync(path.join(HERE, "schema.sql"), "utf8"));
  return {
    _db: db,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            first: async () => db.prepare(sql).get(...args) ?? null,
            all: async () => ({ results: db.prepare(sql).all(...args) }),
            run: async () => void db.prepare(sql).run(...args),
          };
        },
        first: async (...args) => db.prepare(sql).get(...args) ?? null,
        all: async (...args) => ({ results: db.prepare(sql).all(...args) }),
        run: async (...args) => void db.prepare(sql).run(...args),
      };
    },
  };
}

// ---------------------------------------------------------------- fausse itch

/**
 * Substitut de fetch pour itch.io/api/1/...
 * modes :
 *   "normal"        — direct répond ; si l'appel est l'endpoint vendeur, il répond aussi
 *   "html-404"      — le pattern direct renvoie un 404 HTML ; pattern vendeur OK
 *   "net-down"      — exception réseau pour tout appel itch
 *   "bad-config"    — direct 404 HTML ET vendeur 401 (doit donner config_error)
 * validKeys : Map clé → { name, game_id }
 */
function makeItch(mode, validKeys) {
  const calls = [];
  const original = globalThis.fetch;
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (mode === "net-down") throw new Error("stub: réseau coupé");

    const tail = url.slice("https://itch.io/api/1/".length).split("/");
    const sellerStyle = tail.length >= 4 && tail[1] === "my-game";
    const gid = sellerStyle ? tail[2] : tail[0];
    const key = sellerStyle
      ? new URL(url).searchParams.get("download_key") || ""
      : tail[1];

    if (mode === "html-404" && !sellerStyle) return new Response("<html>not found</html>", { status: 404 });
    if (mode === "bad-config" && !sellerStyle) return new Response("<html>not found</html>", { status: 404 });
    if (mode === "bad-config" && sellerStyle) return json({ errors: ["unauthorized"] }, 401);

    const rec = validKeys.get(key);
    if (!rec || rec.game_id !== gid) return json({ errors: ["invalid download key"] });

    const owner = { display_name: rec.name, username: "buyer", id: 1994 };
    const payload = { key, game_id: rec.game_id, id: 124, created_at: "2014-02-28T00:25:09Z", owner };
    return sellerStyle ? json({ download_keys: [payload] }) : json({ download_key: payload });
  };

  return { calls, restore: () => void (globalThis.fetch = original) };
}

// ------------------------------------------------------------------ chantier

// Couple Ed25519 réellement signé (comme le secret du Worker) + vérif à part
const pair = nc.generateKeyPairSync("ed25519");
const PKCS8_B64 = pair.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const PUB_SPKI_DER = pair.publicKey.export({ type: "spki", format: "der" });

const RAW_VALID_KEYS = new Map([
  [KEY_A, { name: "Acheteur Test", game_id: GAME_ID }],
  [KEY_B, { name: "Deuxieme Acheteur", game_id: GAME_ID }],
]);

function makeEnv({ itchMode = "normal", itchKeys = RAW_VALID_KEYS, itchSellerKey = undefined } = {}) {
  const env = {
    DB: makeD1(),
    GAME_ID,
    MAX_BINDS: "1",                 // comme vars wrangler : chaînes
    SWAP_COOLDOWN_DAYS: "30",
    ADMIN_PASSWORD: "test-admin-pw",
    LICENSE_PRIVATE_PKCS8_B64: PKCS8_B64,
  };
  if (itchSellerKey) env.ITCH_API_KEY = itchSellerKey;
  env._itch = makeItch(itchMode, itchKeys);
  return env;
}

const REAL_NOW = Date.now();
const BASE = REAL_NOW;
const DAY = 86400000;

async function main() {
  const worker = (await import(pathToFileURL(path.join(HERE, "src", "index.js")).href)).default;
  const bodies = []; // tous les JSON renvoyés au fil de l'eau (audit privacy)

  async function call(req, env) {
    const resp = await worker.fetch(req, env, { waitUntil() {} });
    let obj = null;
    let text = null;
    try {
      obj = await resp.clone().json();
      bodies.push(JSON.stringify(obj));
    } catch {
      // pas du JSON (page admin HTML) : on capture le texte à la place
      try {
        text = await resp.text();
        bodies.push(text);
      } catch {}
    }
    return { status: resp.status, json: obj, resp, text };
  }

  const post = (path, body, headers) =>
    new Request(HOST + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers || {}) },
      body: JSON.stringify(body),
    });
  const get = (path, headers) => new Request(HOST + path, { method: "GET", headers });

  const checks = [];
  const fail = [];
  const check = (name, cond, extra) => {
    checks.push(name);
    if (!cond) {
      fail.push(name + (extra ? ` — ${extra}` : ""));
      console.log(`  ✗ ${name}${extra ? " — " + extra : ""}`);
    } else {
      console.log(`  ✓ ${name}`);
    }
  };

  // Vérification du token exactement comme le fera l'app (Ed25519 natif)
  function verifyToken(token) {
    const parts = String(token).split(".");
    if (parts.length !== 3 || parts[0] !== "KB1") return null;
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
    const sig = Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const msg = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
    const ok = nc.verify(null, msg, pair.publicKey, sig);
    return ok ? payload : null;
  }

  // [TESTS]
  console.log("license-worker/test.js — suite locale");
  console.log(`  Ed25519 pkcs8 ${PKCS8_B64.length} b64, spki ${(PUB_SPKI_DER.length)} o — Node ${process.version}`);

  // Remise à zéro du temps réel à la toute fin : les sections manipulent NOW.
  const restore = () => void (Date.now = REAL_NOW);

  // [SECTIONS2]

  {
    console.log("\n— S1 : health, preflight, routes inconnues");
    const env = makeEnv();
    const h = await call(get("/v1/health"), env);
    check("health 200/ok", h.status === 200 && h.json.status === "ok" && h.json.service === "kappa-license");
    check("health : db + sign_key + game_id ok", h.json.db === "ok" && h.json.sign_key === "ok" && h.json.game_id === "ok");
    const pf = await worker.fetch(new Request(HOST + "/v1/activate", { method: "OPTIONS" }), env, { waitUntil() {} });
    check("preflight OPTIONS → 204 + CORS", pf.status === 204 && pf.headers.get("access-control-allow-methods").includes("POST"));
    const nf = await call(get("/v1/nonexistent"), env);
    check("route inconnue → 404", nf.status === 404 && nf.json.error === "not_found");
    const gm = await call(get("/v1/status"), env);
    check("GET /v1/status → 405 (la clé ne transite jamais en query string)", gm.status === 405 && gm.json.error === "method_not_allowed", JSON.stringify(gm.json));
    env._itch.restore();
  }

  {
    console.log("\n— S2 : entrées malformées");
    const env = makeEnv();
    const noKey = await call(post("/v1/activate", { device: H1 }), env);
    check("activate sans clé → 400 missing_key", noKey.status === 400 && noKey.json.error === "missing_key");
    const badDev = await call(post("/v1/activate", { key: KEY_A, device: "zz" }), env);
    check("activate device invalide → 400 invalid_device", badDev.status === 400 && badDev.json.error === "invalid_device");
    const noKeyS = await call(post("/v1/swap", { device: H1 }), env);
    check("swap sans clé → 400 missing_key", noKeyS.status === 400);
    env._itch.restore();
  }

  {
    console.log("\n— S3 : activation du premier appareil + token");
    const env = makeEnv();
    const r = await call(post("/v1/activate", { key: KEY_A, device: H1, label: "PC fixe" }), env);
    check("activate → 200", r.status === 200, JSON.stringify(r.json));
    check("réponse contient un token", typeof r.json.token === "string" && !r.json.token.includes(KEY_A));
    const pay = verifyToken(r.json.token);
    check("signature Ed25519 valide (vérif avec la clé publique)", !!pay);
    check("payload { v, k, d, iat }", pay && pay.v === 1 && pay.d === H1 && pay.k === sha256hex(KEY_A) && pay.iat >= BASE);
    check("itch_name remonté d'itch", r.json.itch_name === "Acheteur Test");
    check("key_hash abrégé cohérent", r.json.key_hash === sha256hex(KEY_A).slice(0, 16));
    check("l'appel itch suit le pattern direct documenté",
      env._itch.calls.length === 1 && env._itch.calls[0] === `https://itch.io/api/1/${GAME_ID}/${KEY_A}`, env._itch.calls[0]);
    const row = env.DB._db.prepare("SELECT label, bound_at FROM devices WHERE key_hash = ?").get(sha256hex(KEY_A));
    check("device lié en base (clé hachée uniquement)", row && row.label === "PC fixe");
    const lic = env.DB._db.prepare("SELECT status, itch_name FROM licenses").get();
    check("license 'active' avec pseudo itch", lic && lic.status === "active" && lic.itch_name === "Acheteur Test");
    env._itch.restore();
  }

  {
    console.log("\n— S4 : idempotence (même appareil, sans reconsulter itch)");
    const env = makeEnv();
    await call(post("/v1/activate", { key: KEY_A, device: H1 }), env);
    const before = env._itch.calls.length;
    const r = await call(post("/v1/activate", { key: KEY_A, device: H1 }), env);
    check("ré-activation même appareil → 200", r.status === 200, JSON.stringify(r.json));
    check("aucun nouvel appel itch (idempotent)", env._itch.calls.length === before);
    const tok1 = verifyToken(r.json.token);
    check("nouveau token signé, même device", tok1 && tok1.d === H1);
    env._itch.restore();
  }

  {
    console.log("\n— S5 : refus d'un second appareil (409 already_bound)");
    const env = makeEnv();
    await call(post("/v1/activate", { key: KEY_A, device: H1 }), env);
    const r = await call(post("/v1/activate", { key: KEY_A, device: H2, label: "PC portable" }), env);
    check("second appareil → 409 already_bound", r.status === 409 && r.json.error === "already_bound");
    check("can_swap true (jamais swappé) + next_swap_at déjà écoulé", r.json.can_swap === true && r.json.next_swap_at <= Date.now(), JSON.stringify(r.json));
    check("aucun hash d'appareil supplémentaire en base",
      env.DB._db.prepare("SELECT COUNT(*) AS n FROM devices").get().n === 1);
    env._itch.restore();
  }

  {
    console.log("\n— S6 : swap self-service + cooldown");
    const env = makeEnv();
    await call(post("/v1/activate", { key: KEY_A, device: H1, label: "PC fixe" }), env);
    const s = await call(post("/v1/swap", { key: KEY_A, device: H2, label: "PC portable" }), env);
    check("swap → 200", s.status === 200, JSON.stringify(s.json));
    const pay = verifyToken(s.json.token);
    check("token du swap signé pour le NOUVEL appareil", pay && pay.d === H2);
    check("ancien appareil délié, un seul device en base",
      env.DB._db.prepare("SELECT device_hash FROM devices").get().device_hash === H2);
    check("l'ancien PC re-activerait → 409",
      (await call(post("/v1/activate", { key: KEY_A, device: H1 }), env)).status === 409);
    const r2 = await call(post("/v1/swap", { key: KEY_A, device: H1 }), env);
    check("swap immédiat → 429 cooldown", r2.status === 429 && r2.json.error === "cooldown");
    check("next_swap_at ≈ maintenant + 30 j", Math.abs(r2.json.next_swap_at - (Date.now() + 30 * DAY)) < 3000);
    env._itch.restore();
  }

  // Les sections suivantes manipulent le temps : thermostat global.
  let NOW = BASE;
  Date.now = () => NOW;

  {
    console.log("\n— S7 : ré-échange après 31 jours");
    const env = makeEnv();
    await call(post("/v1/activate", { key: KEY_A, device: H1 }), env); // t = BASE
    await call(post("/v1/swap", { key: KEY_A, device: H2 }), env);     // last_swap = BASE
    NOW = BASE + 31 * DAY;
    const s2 = await call(post("/v1/swap", { key: KEY_A, device: H1, label: "PC neuf" }), env);
    check("swap autorisé après 31 j → 200", s2.status === 200, JSON.stringify(s2.json));
    check("device actif = le nouveau", env.DB._db.prepare("SELECT device_hash FROM devices").get().device_hash === H1);
    const a2 = await call(post("/v1/activate", { key: KEY_A, device: H2 }), env);
    check("l'ancien appareil en 409 avec can_swap FALSE (cooldown reparti)", a2.status === 409 && a2.json.can_swap === false, JSON.stringify(a2.json));
    const st = await call(post("/v1/status", { key: KEY_A }), env);
    check("status : 1 device, label, can_swap false", st.status === 200 && st.json.devices.length === 1 && st.json.devices[0].label === "PC neuf" && st.json.can_swap === false, JSON.stringify(st.json));
    env._itch.restore();
  }

  {
    console.log("\n— S8 : négatifs itch et indisponibilité (fail-closed)");
    const envWrong = makeEnv({ itchKeys: new Map([[KEY_C, { name: "X", game_id: "999" }]]) });
    const w = await call(post("/v1/activate", { key: KEY_C, device: H1 }), envWrong);
    check("clé d'un autre jeu → 403 invalid_key", w.status === 403 && w.json.error === "invalid_key");
    envWrong._itch.restore();

    const envNet = makeEnv({ itchMode: "net-down" });
    const n = await call(post("/v1/activate", { key: KEY_A, device: H1 }), envNet);
    check("itch injoignable + liaison nouvelle → 502 (fail-closed)", n.status === 502 && n.json.error === "itch_unreachable");
    envNet._itch.restore();

    const env404 = makeEnv({ itchMode: "html-404" }); // direct mort, PAS de clé vendeur
    const q = await call(post("/v1/activate", { key: KEY_A, device: H1 }), env404);
    check("pattern direct 404 sans clé vendeur → 502 (pas de fail-open)", q.status === 502 && q.json.error === "itch_unreachable", JSON.stringify(q.json));
    env404._itch.restore();

    const envSw = makeEnv();
    const su = await call(post("/v1/swap", { key: KEY_C, device: H1 }), envSw);
    check("swap d'une licence jamais activée → 403 unknown_key", su.status === 403 && su.json.error === "unknown_key");
    envSw._itch.restore();
  }

  {
    console.log("\n— S9 : plan B valide (endpoint vendeur) et plan B cassé");
    const env = makeEnv({ itchMode: "html-404", itchSellerKey: "seller-key-TEST" });
    const r = await call(post("/v1/activate", { key: KEY_B, device: H3, label: "Second acheteur" }), env);
    check("activation via l'endpoint vendeur → 200", r.status === 200, JSON.stringify(r.json));
    check("2 appels itch : direct (404 HTML) puis vendeur ?download_key=",
      env._itch.calls.length === 2 && env._itch.calls[1].includes(`/my-game/${GAME_ID}/download_keys?download_key=${KEY_B}`), env._itch.calls.join(" | "));
    check("pseudo remonté via le plan B", r.json.itch_name === "Deuxieme Acheteur");
    env._itch.restore();

    const envBad = makeEnv({ itchMode: "bad-config", itchSellerKey: "seller-key-TEST" });
    const b = await call(post("/v1/activate", { key: KEY_A, device: H1 }), envBad);
    check("direct 404 + vendeur 401 → 500 config_error (détectable au déploiement)", b.status === 500 && b.json.error === "config_error");
    envBad._itch.restore();
  }

  {
    console.log("\n— S10 : administration (mot de passe, list, revoke, unbind, journal)");
    const env = makeEnv();
    await call(post("/v1/activate", { key: KEY_A, device: H1, label: "PC fixe" }), env);
    const page = await call(get("/admin"), env);
    check("page admin HTML servie", page.status === 200 && (page.text || "").includes("Mot de passe admin"));
    const unauth = await call(post("/admin/api", { action: "list" }, { authorization: "Bearer mauvais" }), env);
    check("mauvais mot de passe → 401", unauth.status === 401 && unauth.json.error === "unauthorized");
    const noAuth = await call(post("/admin/api", { action: "list" }), env);
    check("sans bearer → 401", noAuth.status === 401);
    const AUTH = { authorization: "Bearer test-admin-pw" };
    const list = await call(post("/admin/api", { action: "list" }, AUTH), env);
    check("list → 1 licence, hash uniquement (pas de clé brute)",
      list.status === 200 && list.json.licenses.length === 1 && list.json.licenses[0].devices.length === 1 && !JSON.stringify(list.json).includes(KEY_A));
    const rev = await call(post("/admin/api", { action: "revoke", key: KEY_A }, AUTH), env);
    check("revoke au départ de la clé brute → hash abrégé", rev.status === 200 && rev.json.key_hash === sha256hex(KEY_A).slice(0, 16));
    const blocked = await call(post("/v1/activate", { key: KEY_A, device: H1 }), env);
    check("appareil LIÉ bloqué par la révocation locale, sans rappeler itch", blocked.status === 403 && blocked.json.error === "revoked" && env._itch.calls.length === 1);
    const ev = await call(post("/admin/api", { action: "events" }, AUTH), env);
    check("journal : activate + admin_revoke présents",
      ev.status === 200 && ev.json.events.some((e) => e.action === "activate") && ev.json.events.some((e) => e.action === "admin_revoke"));
    const unrev = await call(post("/admin/api", { action: "unrevoke", key: KEY_A }, AUTH), env);
    const stAfter = await call(post("/v1/status", { key: KEY_A }), env);
    check("unrevoke → status 'active'", unrev.status === 200 && stAfter.json.status === "active");
    const unbind = await call(post("/admin/api", { action: "unbind", key: KEY_A }, AUTH), env);
    check("unbind → cleared : 1", unbind.status === 200 && unbind.json.cleared === 1);
    const reag = await call(post("/v1/activate", { key: KEY_A, device: H2, label: "Post-unbind" }), env);
    check("après unbind admin, ré-activation libre → 200 (le cooldown n'entrave que le self-service)", reag.status === 200, JSON.stringify(reag.json));
    env._itch.restore();
  }

  {
    console.log("\n— S11 : remboursement itch (refund)");
    const env = makeEnv();
    await call(post("/v1/activate", { key: KEY_B, device: H3 }), env);
    const AUTH = { authorization: "Bearer test-admin-pw" };
    const ref = await call(post("/admin/api", { action: "refund", key: KEY_B }, AUTH), env);
    check("refund → ok", ref.status === 200 && ref.json.key_hash === sha256hex(KEY_B).slice(0, 16));
    const st = await call(post("/v1/status", { key: KEY_B }), env);
    check("statut 'revoked', appareils vidés", st.json.status === "revoked" && st.json.devices.length === 0);
    const a = await call(post("/v1/activate", { key: KEY_B, device: H3 }), env);
    check("réactivation refusée (403 revoked)", a.status === 403 && a.json.error === "revoked");
    env._itch.restore();
  }

  {
    console.log("\n— S12 : normalisation des entrées (URL collée, bruit, casse)");
    const env = makeEnv();
    const noisy = `  https://buyer.itch.io/kappa-buddy/download/${KEY_A}?source=copy\n`;
    const r = await call(post("/v1/activate", { key: noisy, device: " " + H1.toUpperCase() + " ", label: "L".repeat(500) }), env);
    check("URL bruitée + empreinte majuscule → 200", r.status === 200, JSON.stringify(r.json));
    const nLic = env.DB._db.prepare("SELECT COUNT(*) AS n FROM licenses").get().n;
    const dev = env.DB._db.prepare("SELECT label, device_hash FROM devices").get();
    check("une seule licence en base (hash identifié)", nLic === 1);
    check("device hash normalisé = H1 et label tronqué à 80", dev.device_hash === H1 && dev.label.length === 80);
    env._itch.restore();
  }

  // ————————————————————————————— fin : audit de confidentialité + bilan
  check("confidentialité : AUCUN corps de réponse ne contient une clé brute",
    ALL_RAW_KEYS.every((k) => !bodies.join("\n").includes(k)));

  restore();
  const nOk = checks.length - fail.length;
  console.log(`\n${nOk}/${checks.length} vérifications passent`);
  if (fail.length) {
    console.error("ÉCHECS :\n - " + fail.join("\n - "));
    process.exitCode = 1;
  } else {
    console.log("license-worker : TOUS les tests passent ✓");
  }
}

main().then(
  () => {},
  (e) => {
    console.error("CRASH de la suite :", e);
    process.exitCode = 1;
  }
);

