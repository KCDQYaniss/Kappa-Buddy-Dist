#!/usr/bin/env node
// Publie une release construite par `npm run release` sur itch.io via Butler.
//
//   npm run publish-itch
//
// Butler pousse dans le canal "windows" du projet itch kappa-buddy/kappa-buddy,
// le manifeste latest.json est hébergé comme asset téléchargeable.
//
// Prérequis :
//   - itch.io account et Butler installé/autorisé (`butler login`) ;
//   - la release a été construite une fois (npm run release) ;
//   - le jeu itch "kappa-buddy" créé avec un canal "windows".
//
// Le manifeste latest.json sert à Tauri pour la vérification hors-ligne :
// on le pousse en même temps que l'installateur, sous le nom latest.json.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ROOT, repoConfig, requireSyncedVersion, normalizeAssetName } = require("./lib/release-utils.js");

const cfg = repoConfig();
const version = requireSyncedVersion();
const tag = `v${version}`;

// Butler channel cible (κappa-buddy/kappa-buddy/windows par défaut).
// Override possible via itch.json ou env : BUTLER_CHANNEL.
const channel = process.env.BUTLER_CHANNEL || "kappa-buddy/kappa-buddy/windows";
const channelParts = (channel.includes("/") && channel.split("/").length >= 3) ? channel : `kappa-buddy/kappa-buddy/windows`;

console.log(`\nPub Butcher ${version} → itch:${channelParts}\n`);

// 1) Collecte les artefacts produits par npm run release.
const bundle = path.join(ROOT, "target", "release", "bundle", "nsis");
const dist = path.join(ROOT, "dist");
const latestJson = path.join(dist, "latest.json");
const portable = path.join(dist, `KappaBuddy-${version}-portable.zip`);

const setupFiles = fs.existsSync(bundle)
  ? fs.readdirSync(bundle).filter((f) => f.toLowerCase().endsWith(".exe") && /setup/i.test(f) && f.includes(version))
  : [];
const setup = setupFiles
  .map((f) => ({ f, m: fs.statSync(path.join(bundle, f)).mtimeMs }))
  .sort((a, b) => b.m - a.m)[0];

if (!setup) {
  console.error(`\nInstallateur manquant dans ${bundle} pour ${version}.`);
  console.error("Lance d'abord : npm run release\n");
  process.exit(1);
}
const setupName = normalizeAssetName(setup.f);
const setupPath = path.join(bundle, setupName);

// 2) Butler pousse l'installateur + manifeste latest.json + zip portable.
//    Le manifeste doit être publié sous le nom "latest.json" pour que l'URL
//    fixe https://kappa-buddy.itch.io/kappa-buddy/download/kappa-buddy/latest.json
//    serve toujours la dernière version.
console.log("Envoi via Butler :");
console.log(`  • ${setupName}`);
console.log(`  • latest.json`);
if (fs.existsSync(portable)) console.log(`  • ${path.basename(portable)}`);

function butler(...args) {
  execFileSync("butler", args, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
}

// Le zip est poussé comme un "push" classique si présent.
if (fs.existsSync(portable)) {
  butler("push", portable, channelParts.replace(/\/windows$/, "/portable"));
}

// L'installateur + latest.json : Butler ne gère pas "latest.json" nativement
// comme un canal, on le pousse via butler push file itch-user/path:channel.
// Ici on utilise le canal "windows" pour l'installateur et on upload
// latest.json comme asset web (itchi.io le permet via butler push → web).
// Mais pour une mise à jour Tauri, le plus simple est de publier latest.json
// dans le même canal : les deux fichiers sont downloadables via l'URL fixe.
butler("push", setupPath, channelParts);
butler("push", latestJson, channelParts.replace(/\/windows$/, "") + "/latest.json");

console.log(`\n✅ Publié sur itch : https://kappa-buddy.itch.io/kappa-buddy`);
console.log(`    latest.json → https://kappa-buddy.itch.io/kappa-buddy/download/kappa-buddy/latest.json\n`);
