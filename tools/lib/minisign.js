// Vérification des signatures minisign produites par Tauri (comme le fait l'updater).
//
// Tauri sérialise la clé publique et la signature en base64 du fichier minisign texte :
//   untrusted comment: ...
//   <base64 74 octets>
//   trusted comment: ...
//   <base64 74 octets>       (signature globale, contrôle l'intégrité du commentaire)
//
// Algorithme (identique à la caisse `minisign-verify` utilisée par Tauri) :
//   - signature « ED » = préhashée : BLAKE2b-512(fichier) puis Ed25519 pur sur l'empreinte
//   - signature « Ed » = héritée   : Ed25519 pur directement sur le fichier
//
// Ce module ne dépend que du module `crypto` de Node (OpenSSL) : aucune dépendance externe.
"use strict";
const crypto = require("crypto");

/** Décode une chaîne base64 en texte UTF-8 en tolérant les espaces/retours. */
function b64ToText(b64) {
  const cleaned = String(b64).replace(/\s+/g, "");
  return Buffer.from(cleaned, "base64").toString("utf8");
}

/** Clé publique Ed25519 (objet KeyObject) depuis le champ `pubkey` de tauri.conf.json. */
function publicKeyFromConfig(pubkeyField) {
  const text = b64ToText(pubkeyField);
  const line = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).find((l) => !l.startsWith("untrusted") && !l.startsWith("trusted"));
  if (!line) throw new Error("pubkey : aucune ligne de clé base64 trouvée");
  const raw = Buffer.from(line, "base64");
  if (raw.length !== 42) throw new Error(`pubkey : 42 octets attendus, reçu ${raw.length}`);
  const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw.subarray(10, 42)]);
  return { key: crypto.createPublicKey({ key: der, format: "der", type: "spki" }), keyId: raw.subarray(2, 10).toString("hex") };
}

/** Signature minisign décodée depuis le champ `signature` de latest.json. */
function signatureFromManifest(signatureField) {
  const text = b64ToText(signatureField);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const packet = lines.find((l) => !l.startsWith("untrusted") && !l.startsWith("trusted") && Buffer.from(l, "base64").length === 74);
  if (!packet) throw new Error("signature : aucune signature de 74 octets trouvée");
  const buf = Buffer.from(packet, "base64");
  const trusted = lines.find((l) => l.startsWith("trusted comment")) || "";
  return { bytes: buf, algorithm: buf.subarray(0, 2).toString("latin1"), keyId: buf.subarray(2, 10).toString("hex"), trustedComment: trusted.replace(/^trusted comment:\s*/, "") };
}

/** Version annoncée dans le commentaire de confiance (`version:0.7.2`), si présente. */
function signedVersion(trustedComment) {
  const m = /(?:^|\s)version:([^\s]+)/.exec(trustedComment || "");
  return m ? m[1].trim() : null;
}

/**
 * Vérifie `file` (Buffer) contre la signature et la clé.
 * @returns {{ok: boolean, reason?: string, keyId: string}}
 */
function verify(file, signatureField, pubkeyField) {
  const { key, keyId } = publicKeyFromConfig(pubkeyField);
  const sig = signatureFromManifest(signatureField);
  if (sig.keyId !== keyId) {
    return { ok: false, reason: `clé de signature (${sig.keyId}) ≠ clé publique (${keyId})`, keyId };
  }
  let message;
  if (sig.algorithm === "ED") {
    message = crypto.createHash("blake2b512").update(file).digest();
  } else if (sig.algorithm === "Ed") {
    message = file;
  } else {
    return { ok: false, reason: `algorithme inconnu « ${sig.algorithm} »`, keyId };
  }
  const ok = crypto.verify(null, message, key, sig.bytes.subarray(10, 74));
  return { ok, reason: ok ? undefined : "signature Ed25519 invalide", keyId, signedVersion: signedVersion(sig.trustedComment) };
}

module.exports = { verify, publicKeyFromConfig, signatureFromManifest, signedVersion, b64ToText };

if (require.main === module) {
  const fs = require("fs");
  const [, , file, sig, pub] = process.argv;
  if (!file || !sig || !pub) {
    console.error("usage: node tools/lib/minisign.js <fichier> <signature (champ latest.json)> <pubkey>");
    process.exit(2);
  }
  try {
    const r = verify(fs.readFileSync(file), sig, pub);
    console.log(r.ok ? "SIGNATURE VALIDE" : `SIGNATURE INVALIDE — ${r.reason}`);
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error("ERREUR:", e.message);
    process.exit(1);
  }
}
