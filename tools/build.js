#!/usr/bin/env node
// Construit l'installateur.
//
//   npm run build
//
// Si la clé de signature des mises à jour existe (%USERPROFILE%\.tauri\tarkov-tracker.key),
// l'installateur est signé : les mises à jour automatiques fonctionnent.
// Sinon, on construit quand même (sans artefacts de mise à jour) pour pouvoir tester.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const KEY = path.join(os.homedir(), ".tauri", "tarkov-tracker.key");
const signed = fs.existsSync(KEY);

const args = ["tauri", "build", "--bundles", "nsis"];
if (!signed) {
  console.warn("Clé de signature absente : construction SANS mise à jour automatique.");
  console.warn(`Pour la créer une fois :  npx tauri signer generate -w "${KEY}"`);
  args.push("--config", JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
} else {
  console.log("Signature activée (mises à jour automatiques prises en charge).");
}

execFileSync("npx", args, {
  cwd: ROOT,
  stdio: "inherit",
  env: signed ? Object.assign({}, process.env, { TAURI_SIGNING_PRIVATE_KEY: KEY }) : process.env,
  shell: process.platform === "win32",
});
