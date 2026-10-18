#!/usr/bin/env node
// Fabrique une archive portable (repli si tu ne veux pas/pas pu générer l'installateur).
// L'exécutable de release embarque déjà l'interface : il suffit de le livrer avec les documents.
//
// Usage : node tools/zip.js   (ou npm run zip) — après `npm run build`.
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
// Le dossier de sortie dépend de l'organisation du workspace : à la racine (workspace Cargo) ou dans src-tauri.
const CANDIDATE_DIRS = [path.join(ROOT, "target", "release"), path.join(ROOT, "src-tauri", "target", "release")];

function findExe() {
  for (const dir of CANDIDATE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    const cands = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".exe"));
    // Le binaire principal ne porte pas le suffixe des outils de compilation.
    const main = cands.find((f) => /tarkov/i.test(f) && !/build-script|setup|uninstall/i.test(f));
    if (main) return path.join(dir, main);
  }
  return null;
}

function main() {
  const exe = findExe();
  if (!exe) {
    console.error("Exécutable introuvable. Lance d'abord :  npm run build");
    process.exit(1);
  }
  const dist = path.join(ROOT, "dist");
  fs.mkdirSync(dist, { recursive: true });
  const stage = path.join(dist, "portable");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  fs.copyFileSync(exe, path.join(stage, "TarkovTracker.exe"));
  for (const doc of ["README.md", "CREDITS.md", "CHANGELOG.md"]) {
    const src = path.join(ROOT, doc);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(stage, doc));
  }
  // Mode d'emploi minimal livré avec l'exécutable.
  fs.writeFileSync(
    path.join(stage, "LISEZ-MOI.txt"),
    [
      "Tarkov Tracker " + pkg.version,
      "",
      "Lance TarkovTracker.exe. Aucune installation n'est nécessaire.",
      "Windows 10/11 avec WebView2 (présent par défaut sur Windows 11 et la plupart des Windows 10).",
      "",
      "Au premier lancement, l'app télécharge les données du jeu (quelques dizaines de secondes).",
      "Ensuite elle fonctionne hors ligne.",
      "",
      "Licences et attribution : voir CREDITS.md (les cartes sont CC BY-NC-SA 4.0 : usage non commercial).",
    ].join("\r\n"),
    "utf8"
  );

  const zip = path.join(dist, `TarkovTracker-${pkg.version}-portable.zip`);
  fs.rmSync(zip, { force: true });
  // Compress-Archive est présent sur Windows PowerShell 5+.
  execFileSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
  const size = (fs.statSync(zip).size / 1048576).toFixed(1);
  console.log(`\nArchive portable : ${path.relative(ROOT, zip)}  (${size} Mo)`);
}

main();
