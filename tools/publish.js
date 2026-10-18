#!/usr/bin/env node
// Publie la version sur GitHub Releases puis **vérifie de bout en bout** que la mise à jour
// fonctionne. C'est l'étape qui garantit qu'aucun utilisateur ne tombera sur un 404 ou une
// signature invalide.
//
//   npm run publish
//
// Prérequis :
//   - `npm run release` a déjà construit l'installateur signé, dist/latest.json et le zip portable ;
//   - la CLI `gh` est installée et authentifiée (`gh auth login`).
//
// Ce script envoie TOUS les fichiers (installateur, manifeste, archive portable) en une fois,
// puis télécharge le manifeste et l'installateur depuis les URLs publiques pour rejouer la
// vérification de signature comme le ferait l'application.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT, repoConfig, requireSyncedVersion, changelogNotes, normalizeAssetName } = require("./lib/release-utils.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gh(args, opts) {
  return execFileSync("gh", args, Object.assign({ env: Object.assign({}, process.env, { GH_REPO: REPO }), stdio: "inherit" }, opts || {}));
}

let REPO;

/** Rassemble les fichiers à publier et échoue clairement si l'un manque. */
function collectArtifacts(version) {
  const bundle = path.join(ROOT, "target", "release", "bundle", "nsis");
  const files = fs.existsSync(bundle)
    ? fs.readdirSync(bundle).filter((f) => f.toLowerCase().endsWith(".exe") && /setup/i.test(f) && f.includes(version))
    : [];
  const setup = files.map((f) => ({ f, m: fs.statSync(path.join(bundle, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
  const latest = path.join(ROOT, "dist", "latest.json");
  const portable = path.join(ROOT, "dist", `TarkovTracker-${version}-portable.zip`);

  const missing = [];
  if (!setup) missing.push(`installateur signé (target/release/bundle/nsis/*setup*.exe pour ${version})`);
  if (!setup || !fs.existsSync(path.join(bundle, setup.f + ".sig"))) missing.push("signature de l'installateur (.sig)");
  if (!fs.existsSync(latest)) missing.push("dist/latest.json");
  if (!fs.existsSync(portable)) missing.push(path.relative(ROOT, portable));
  if (missing.length) {
    console.error("\nFichiers manquants :\n  - " + missing.join("\n  - "));
    console.error("\nLance d'abord :  npm run release\n");
    process.exit(1);
  }

  const setupName = normalizeAssetName(setup.f);
  const setupPath = path.join(bundle, setupName);
  // Le nom doit être déjà normalisé (fait par release.js) ; on tolère les anciens builds.
  return {
    assets: [setupPath, latest, portable],
    releaseAssets: [setupName, "latest.json", path.basename(portable)],
  };
}

async function main() {
  const cfg = repoConfig();
  REPO = cfg.repo;
  const version = requireSyncedVersion();
  const tag = `v${version}`;
  console.log(`\nPublication de ${tag} sur ${REPO}\n`);

  const { assets, releaseAssets } = collectArtifacts(version);
  const notes = changelogNotes(version) || cfg.notes || `Version ${version}`;

  // 1) Crée la release si besoin (sans asset), sinon la réutilise.
  let exists = true;
  try {
    execFileSync("gh", ["release", "view", tag], { env: Object.assign({}, process.env, { GH_REPO: REPO }), stdio: "ignore" });
  } catch {
    exists = false;
  }
  if (!exists) {
    console.log(`Création de la release ${tag}…`);
    gh(["release", "create", tag, "--title", tag, "--notes", notes]);
  } else {
    console.log(`Release ${tag} déjà présente — mise à jour des fichiers.`);
  }

  // 2) Envoi de TOUS les fichiers en une seule commande (limite la fenêtre d'incohérence).
  console.log("\nEnvoi des fichiers…");
  gh(["release", "upload", tag, ...assets, "--clobber"]);
  console.log(`  ${releaseAssets.join("\n  ")}`);

  // 3) Vérification de bout en bout, avec quelques tentatives le temps que le CDN se mette à jour.
  console.log("\nVérification de la mise à jour publiée…");
  for (let attempt = 1; attempt <= 4; attempt++) {
    await sleep(attempt === 1 ? 2000 : 6000);
    try {
      execFileSync("node", [path.join(ROOT, "tools", "verify-published.js")], { cwd: ROOT, stdio: "inherit" });
      console.log(`\n✅ ${tag} publiée et vérifiée.`);
      console.log(`   https://github.com/${REPO}/releases/tag/${tag}`);
      return;
    } catch {
      if (attempt < 4) console.log(`\n…nouvelle tentative (${attempt + 1}/4)`);
    }
  }
  console.error(`\n❌ La vérification de la mise à jour publiée a échoué après 4 tentatives.`);
  console.error(`   Réessaie plus tard, ou lance : npm run verify-release`);
  process.exit(1);
}

main().catch((e) => { console.error("\nERREUR:", e.message); process.exit(1); });
