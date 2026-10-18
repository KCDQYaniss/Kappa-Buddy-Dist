#!/usr/bin/env node
// Audit avant redistribution : vérifie que rien de confidentiel, personnel ou trop lourd ne partira
// avec le paquet. N'analyse que ce qui est réellement embarqué (le dossier ui/ et le code source qui
// sert à recompiler), jamais node_modules, target ou .git.
//
// Usage : node tools/audit.js   (ou npm run audit)
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "target", ".git", ".vscode", "dist"]);
// Fichiers engendrés à la compilation : à ne pas livrer (ils se recréent).
const SKIP_PATHS = [/^src-tauri[\\/]gen[\\/]/];
// Extensions binaires qu'on ne peut pas lire ligne à ligne.
const BINARY = new Set([".png", ".ico", ".jpg", ".jpeg", ".gif", ".webp", ".ttf", ".otf", ".woff", ".woff2", ".zip", ".exe", ".dll"]);

// Motifs qui trahiraient une fuite. Chaque entrée : [nom, regex, explication].
const PATTERNS = [
  ["chemin utilisateur Windows", /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+/g, "chemin absolu vers un profil Windows"],
  ["chemin utilisateur Unix", /\/(home|Users)\/[a-z0-9._-]+\//gi, "chemin absolu vers un profil utilisateur"],
  ["clé d'API", /\b(api[_-]?key|apikey|access[_-]?token|secret[_-]?key)\b\s*[:=]\s*["'][^"']{8,}/gi, "secret en clair"],
  ["clé privée", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, "clé privée"],
  ["mot de passe", /\b(password|passwd|mot[_-]?de[_-]?passe)\b\s*[:=]\s*["'][^"']{4,}/gi, "identifiant en clair"],
  ["jeton Bearer", /Bearer\s+[A-Za-z0-9._-]{20,}/g, "jeton d'authentification"],
  ["jeton GitHub", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "jeton GitHub"],
  ["AWS", /\bAKIA[0-9A-Z]{16}\b/g, "clé AWS"],
  ["adresse e-mail", /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, "adresse e-mail (vérifier qu'elle est bien publique)"],
];

// Fichiers qui ne doivent jamais être livrés (données de l'utilisateur, secrets).
const FORBIDDEN_FILE = /(^|[\\/])(\.env(\..*)?|.*\.pem|.*\.key|.*\.pfx|.*\.p12|id_rsa.*|.*\.log|.*\.sqlite|.*\.db|credentials.*|.*\.secret)$/i;
// Données personnelles du joueur qu'un utilisateur ne veut pas partager.
const USER_DATA = /progress(-[a-z]+)?\.json$|settings\.json$|data-v2-.*\.json$/i;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(ROOT, full);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (SKIP_PATHS.some((re) => re.test(rel + path.sep))) continue;
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT, []);
const findings = [];
const huge = [];
let total = 0;
const byDir = {};
const licenseFiles = [];

for (const f of files) {
  const rel = path.relative(ROOT, f);
  const st = fs.statSync(f);
  total += st.size;
  const top = rel.split(path.sep)[0];
  byDir[top] = (byDir[top] || 0) + st.size;

  if (FORBIDDEN_FILE.test(rel)) findings.push([rel, 0, "fichier à ne pas livrer (" + path.basename(rel) + ")"]);
  if (USER_DATA.test(rel) && !rel.startsWith(path.join("ui", "demo"))) {
    findings.push([rel, 0, "donnée personnelle détectée : " + rel]);
  }
  if (st.size > 6 * 1024 * 1024) huge.push([rel, st.size]);
  if (/LICENSE|OFL|CREDITS/i.test(rel)) licenseFiles.push(rel);
  if (BINARY.has(path.extname(f).toLowerCase())) continue;

  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch (_) { continue; }
  for (const [name, re] of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split("\n").length;
      findings.push([rel, line, `${name} : ${m[0].slice(0, 60)}`]);
      if (!re.global) break;
    }
  }
}

const mb = (n) => (n / 1048576).toFixed(2) + " Mo";
console.log("Audit de redistribution — fichiers embarqués (hors node_modules, target, .git)");
console.log("=".repeat(72));
console.log(`${files.length} fichiers, ${mb(total)} au total\n`);
console.log("Répartition par dossier :");
for (const [d, s] of Object.entries(byDir).sort((a, b) => b[1] - a[1])) console.log(`  ${d.padEnd(14)} ${mb(s)}`);

console.log("\nFichiers de licence présents :");
licenseFiles.forEach((f) => console.log("  " + f));

if (huge.length) {
  console.log("\nFichiers volumineux (> 6 Mo) — vérifie qu'ils sont nécessaires :");
  huge.forEach(([f, s]) => console.log(`  ${f}  ${mb(s)}`));
}

console.log("\nRésultat de la recherche de fuites :");
if (!findings.length) {
  console.log("  Aucun secret ni chemin personnel détecté.");
} else {
  for (const [f, line, msg] of findings) console.log(`  ${f}${line ? ":" + line : ""}  ${msg}`);
}

console.log("\nRappel licences (à respecter pour redistribuer) :");
console.log("  - Cartes et étages (ui/maps/*.svg) : CC BY-NC-SA 4.0 — NON COMMERCIAL, attribution,");
console.log("    partage à l'identique. Voir CREDITS.md.");
console.log("  - Données de jeu : non redistribuables telles quelles ; l'app les télécharge à l'usage.");

const failed = findings.length > 0;
console.log("\n" + (failed ? findings.length + " point(s) à vérifier avant de distribuer." : "Rien à signaler : le paquet est propre."));
process.exit(failed ? 1 : 0);
