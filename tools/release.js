#!/usr/bin/env node
// Construit et signe la version, puis écrit dist/latest.json — prêt à publier.
//
//   npm run release
//
// Étapes :
//   1) vérifie que package.json, tauri.conf.json et Cargo.toml portent la même version ;
//   2) synchronise l'URL de mise à jour du dépôt dans tauri.conf.json ;
//   3) construit l'installateur signé (clé privée dans %USERPROFILE%\.tauri) ;
//   4) vérifie localement que la signature correspond au binaire construit et à la clé publique ;
//   5) fabrique l'archive portable ;
//   6) écrit dist/latest.json (signature, URL, notes issues du CHANGELOG).
//
// La publication sur GitHub et la vérification de bout en bout sont faites par `npm run publish`.
//
// La clé privée ne doit JAMAIS être versionnée : elle vit hors du dépôt.
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const {
  ROOT, readJson, repoConfig, requireSyncedVersion, changelogNotes, normalizeAssetName, assetUrl, signatureField,
} = require("./lib/release-utils.js");
const { verify } = require("./lib/minisign.js");

const CONF = path.join(ROOT, "src-tauri", "tauri.conf.json");
const KEY = path.join(os.homedir(), ".tauri", "tarkov-tracker.key");

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/** Installateur le plus récent du dossier de bundles (les anciens builds y restent). */
function newestSetup(bundle) {
  const files = fs.readdirSync(bundle).filter((f) => f.toLowerCase().endsWith(".exe") && /setup/i.test(f));
  if (!files.length) return null;
  return files.reduce((acc, f) => (fs.statSync(path.join(bundle, f)).mtimeMs > fs.statSync(path.join(bundle, acc)).mtimeMs ? f : acc), files[0]);
}

function main() {
  const cfg = repoConfig();
  const version = requireSyncedVersion();
  const tag = `v${version}`;
  const endpoint = `https://github.com/${cfg.repo}/releases/latest/download/latest.json`;

  // 1) L'application interroge cette adresse : on la garde synchronisée avec le dépôt.
  const conf = readJson(CONF);
  conf.plugins = conf.plugins || {};
  conf.plugins.updater = Object.assign({}, conf.plugins.updater, { endpoints: [endpoint] });
  writeJson(CONF, conf);
  console.log(`Version                : ${version}`);
  console.log(`Dépôt                  : ${cfg.repo}`);
  console.log(`Adresse de mise à jour : ${endpoint}`);

  // 2) La clé privée est indispensable : sans elle, pas de mise à jour vérifiable.
  if (!fs.existsSync(KEY)) {
    console.error(`\nClé privée introuvable : ${KEY}`);
    console.error('Génère-la une fois avec :  npx tauri signer generate -w "%USERPROFILE%\\.tauri\\tarkov-tracker.key"');
    process.exit(1);
  }

  // 3) Construction signée.
  console.log("\nConstruction de l'installateur signé…");
  const env = Object.assign({}, process.env, { TAURI_SIGNING_PRIVATE_KEY: KEY });
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD !== undefined) {
    env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  }
  execFileSync("npx", ["tauri", "build", "--bundles", "nsis"], { cwd: ROOT, stdio: "inherit", env, shell: process.platform === "win32" });

  // 4) Installateur + signature.
  const bundle = path.join(ROOT, "target", "release", "bundle", "nsis");
  const exe = newestSetup(bundle);
  if (!exe) {
    console.error("Installateur introuvable dans " + bundle);
    process.exit(1);
  }
  // GitHub transforme les espaces en points dans les noms d'asset : on normalise ici pour que
  // le nom local, l'URL du manifeste et l'asset publié soient rigoureusement identiques.
  const assetName = normalizeAssetName(exe);
  if (assetName !== exe) {
    fs.renameSync(path.join(bundle, exe), path.join(bundle, assetName));
    fs.renameSync(path.join(bundle, exe + ".sig"), path.join(bundle, assetName + ".sig"));
  }
  const exePath = path.join(bundle, assetName);
  const sigPath = exePath + ".sig";
  if (!fs.existsSync(sigPath)) {
    console.error("Signature introuvable : " + sigPath);
    process.exit(1);
  }
  const signature = signatureField(fs.readFileSync(sigPath, "utf8"));

  // 5) Vérification locale : la signature doit correspondre au binaire ET à la clé publique
  //    compilée dans l'application. Sans ça, mieux vaut s'arrêter tout de suite.
  const check = verify(fs.readFileSync(exePath), signature, conf.plugins.updater.pubkey);
  if (!check.ok) {
    console.error(`\nSignature locale invalide : ${check.reason}`);
    console.error("La clé privée utilisée pour signer ne correspond pas à la clé publique de tauri.conf.json.");
    process.exit(1);
  }
  console.log(`\nSignature locale vérifiée ✅ (clé ${check.keyId})`);

  // 6) Archive portable (repli sans installateur), puis manifeste de mise à jour.
  execFileSync("node", [path.join(ROOT, "tools", "zip.js")], { cwd: ROOT, stdio: "inherit" });

  const notes = changelogNotes(version) || cfg.notes || "";
  const latest = {
    version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: assetUrl(cfg.repo, tag, exe),
      },
    },
  };
  const dist = path.join(ROOT, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const out = path.join(dist, "latest.json");
  writeJson(out, latest);

  console.log(`\nInstallateur : ${exePath}`);
  console.log(`Manifeste    : ${out}`);
  console.log(`\nProchaine étape :  npm run publish   (envoie tout sur GitHub et vérifie la mise à jour publiée)`);
}

main();
