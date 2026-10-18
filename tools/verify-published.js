// Vérifie de bout en bout la mise à jour publiée :
//   1) le latest.json servi par l'endpoint public ;
//   2) l'installateur qu'il référence (téléchargé depuis GitHub) ;
//   3) la signature minisign contre la clé publique de tauri.conf.json ;
//   4) la cohérence avec dist/latest.json local (si présent).
//
//   node tools/verify-published.js [--json]
//
// Code de sortie : 0 = tout est bon, 1 = problème.
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");
const { verify } = require("./lib/minisign.js");

const ROOT = path.resolve(__dirname, "..");
const CONF = JSON.parse(fs.readFileSync(path.join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
const PUBKEY = CONF.plugins.updater.pubkey;
const ENDPOINT = CONF.plugins.updater.endpoints[0];

function fetchBuffer(url, accept, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 6) return reject(new Error("trop de redirections"));
    https.get(url, { headers: { "User-Agent": "tarkov-tracker-verify", Accept: accept || "*/*", "Cache-Control": "no-cache" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(res.headers.location, accept, hops + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} pour ${url}`));
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function main() {
  const report = { endpoint: ENDPOINT, checks: [], problems: [] };
  const add = (label, ok, detail) => { report.checks.push({ label, ok, detail }); if (!ok) report.problems.push(label + (detail ? ` — ${detail}` : "")); };

  // 1) Manifeste publié (avec anti-cache).
  const bust = ENDPOINT + (ENDPOINT.includes("?") ? "&" : "?") + "t=" + Date.now();
  const hostedBuf = await fetchBuffer(bust, "application/json");
  const hosted = JSON.parse(hostedBuf.toString("utf8"));
  add("latest.json public lisible", true, `version ${hosted.version}`);
  const plat = hosted.platforms["windows-x86_64"];
  if (!plat || !plat.url || !plat.signature) {
    add("latest.json contient url + signature", false);
    return finish(report);
  }
  add("latest.json contient url + signature", true, plat.url);

  // 2) Cohérence avec le manifeste local (ce qu'on a construit).
  const localPath = path.join(ROOT, "dist", "latest.json");
  if (fs.existsSync(localPath)) {
    const local = JSON.parse(fs.readFileSync(localPath, "utf8"));
    add("version locale = version publiée", local.version === hosted.version, `local ${local.version} / publié ${hosted.version}`);
    add("signature locale = signature publiée", local.platforms["windows-x86_64"].signature === plat.signature);
    add("url locale = url publiée", local.platforms["windows-x86_64"].url === plat.url);
  }

  // 3) Installateur publié.
  const exe = await fetchBuffer(plat.url, "application/octet-stream");
  add("installateur téléchargeable", true, `${(exe.length / 1048576).toFixed(2)} Mo, sha256 ${sha256(exe).slice(0, 16)}…`);

  // 4) Signature.
  const res = verify(exe, plat.signature, PUBKEY);
  add("signature minisign valide", res.ok, res.ok ? `clé ${res.keyId}` : res.reason);
  if (res.signedVersion) add("version signée = version annoncée", res.signedVersion === hosted.version, `signée ${res.signedVersion} / annoncée ${hosted.version}`);

  return finish(report);
}

function finish(report) {
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nVérification de la mise à jour publiée\n  endpoint : ${report.endpoint}\n`);
    for (const c of report.checks) console.log(`  ${c.ok ? "✅" : "❌"} ${c.label}${c.detail ? ` — ${c.detail}` : ""}`);
    console.log(report.problems.length ? `\n❌ ${report.problems.length} problème(s).\n` : "\n✅ Mise à jour publiée cohérente et signée.\n");
  }
  process.exit(report.problems.length ? 1 : 0);
}

main().catch((e) => { console.error("ERREUR:", e.message); process.exit(1); });
