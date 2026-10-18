// Utilitaires partagés par la chaîne de publication (build → manifeste → upload → vérification).
// Aucune dépendance externe : uniquement la bibliothèque standard.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

/** Lit un JSON en échouant avec un message clair. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`JSON illisible : ${file} (${e.message})`);
  }
}

/** Configuration du dépôt (tools/release.config.json). */
function repoConfig() {
  const f = path.join(ROOT, "tools", "release.config.json");
  if (!fs.existsSync(f)) {
    throw new Error('Crée tools/release.config.json avec { "repo": "compte/dépôt", "notes": "" }');
  }
  const c = readJson(f);
  if (!c.repo || !/^[^/]+\/[^/]+$/.test(c.repo)) throw new Error('"repo" doit ressembler à "compte/dépôt"');
  return c;
}

/** Versions déclarées (package.json, tauri.conf.json, Cargo.toml) — doivent rester synchrones. */
function versions() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  const conf = readJson(path.join(ROOT, "src-tauri", "tauri.conf.json"));
  const cargo = fs.readFileSync(path.join(ROOT, "src-tauri", "Cargo.toml"), "utf8");
  const m = /^\s*version\s*=\s*"([^"]+)"/m.exec(cargo);
  return { pkg: pkg.version, tauri: conf.version, cargo: m ? m[1] : null };
}

/** Vérifie que les trois versions coïncident ; renvoie la version, sinon lève une erreur. */
function requireSyncedVersion() {
  const v = versions();
  if (v.pkg !== v.tauri || v.pkg !== v.cargo) {
    throw new Error(`versions désynchronisées : package.json=${v.pkg}, tauri.conf.json=${v.tauri}, Cargo.toml=${v.cargo}`);
  }
  return v.pkg;
}

/**
 * Notes de version extraites de CHANGELOG.md pour la version donnée.
 * Renvoie une chaîne avec les deux langues formatées [FR] / [EN],
 * ou "" si introuvable.
 *
 * Format attendu dans le fichier :
 *   ## 0.7.14 — titre
 *   ### FR
 *   - note 1
 *   ### EN
 *   - note 1
 */
function changelogNotes(version, changelog) {
  const text = changelog || fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${version.replace(/\./g, "\\.")}\\b`).test(l));
  if (start === -1) return "";
  const sections = {};
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^##\s/.test(l)) break;
    const m = l.match(/^###\s+(FR|EN)\s*$/i);
    if (m) { cur = m[1].toUpperCase(); sections[cur] = []; continue; }
    if (cur) sections[cur].push(l);
  }
  const parts = [];
  for (const lang of ["FR", "EN"]) {
    const body = (sections[lang] || []).join("\n").trim();
    if (body) parts.push(`[${lang}]\n${body}`);
  }
  return parts.join("\n\n");
}

/** Nom d'asset GitHub : les espaces deviennent des points (comportement de l'upload). */
function normalizeAssetName(name) {
  return name.replace(/\s+/g, ".");
}

/** URL publique d'un asset de release. */
function assetUrl(repo, tag, assetName) {
  return `https://github.com/${repo}/releases/download/${tag}/${encodeURIComponent(normalizeAssetName(assetName))}`;
}

/** Segment d'URL pour un asset (nom normalisé, encodé). */
function assetPathSegment(assetName) {
  return encodeURIComponent(normalizeAssetName(assetName));
}

/** Contenu du fichier .sig (déjà du base64 du texte minisign) → champ `signature` de latest.json. */
function signatureField(sigText) {
  return sigText.trim();
}

module.exports = { ROOT, readJson, repoConfig, versions, requireSyncedVersion, changelogNotes, normalizeAssetName, assetUrl, assetPathSegment, signatureField };
