// Tests de la chaîne de publication : nommage des assets, URL, extraction des notes et
// vérification de signature minisign (mode préhashé BLAKE2b-512 + Ed25519, comme Tauri).
const crypto = require("crypto");
const { normalizeAssetName, assetUrl, changelogNotes, assetPathSegment } = require("../tools/lib/release-utils.js");
const minisign = require("../tools/lib/minisign.js");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  ÉCHEC ") + msg); if (!cond) failed++; };

console.log("Nommage des assets et URL de mise à jour");
// GitHub transforme les espaces en points : le nom local, l'URL et l'asset doivent coïncider.
ok(normalizeAssetName("Tarkov Tracker_0.7.2_x64-setup.exe") === "Tarkov.Tracker_0.7.2_x64-setup.exe", "les espaces deviennent des points");
ok(normalizeAssetName("sans_espace.exe") === "sans_espace.exe", "un nom sans espace est inchangé");
ok(assetPathSegment("Tarkov Tracker_0.7.2_x64-setup.exe") === "Tarkov.Tracker_0.7.2_x64-setup.exe", "segment d'URL normalisé");
const url = assetUrl("KCDQYaniss/Tarkov-Tracker", "v0.7.2", "Tarkov Tracker_0.7.2_x64-setup.exe");
ok(url === "https://github.com/KCDQYaniss/Tarkov-Tracker/releases/download/v0.7.2/Tarkov.Tracker_0.7.2_x64-setup.exe", "URL sans %20 (le bug 404 ne peut pas revenir)");
ok(!url.includes("%20"), "aucun espace encodé dans l'URL");

console.log("Notes de version extraites du CHANGELOG");
const sample = [
  "# Changelog", "",
  "## 0.7.2 — titre", "",
  "### FR", "- point un", "- point deux", "",
  "### EN", "- item one", "- item two", "",
  "## 0.7.1 — autre", "", "### FR", "- ancien",
].join("\n");
const notes = changelogNotes("0.7.2", sample);
ok(notes.includes("[FR]") && notes.includes("[EN]"), "les deux langues sont présentes");
ok(notes.includes("point un") && notes.includes("point deux"), "les puces FR sont extraites");
ok(notes.includes("item one") && notes.includes("item two"), "les puces EN sont extraites");
ok(!notes.includes("ancien"), "les versions suivantes ne sont pas incluses");
ok(changelogNotes("9.9.9", sample) === "", "version inconnue → chaîne vide");

console.log("Vérification de signature minisign");
// On fabrique une signature « ED » (préhashée) comme Tauri, avec une paire Ed25519 jetable.
function makeFixture(fileBuf, opts) {
  opts = opts || {};
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12); // 32 octets
  const keyId = opts.keyId || crypto.randomBytes(8);
  const pubBox = Buffer.concat([Buffer.from("Ed", "latin1"), keyId, raw]); // 42 octets
  const pubField = Buffer.from(`untrusted comment: minisign public key: ${keyId.toString("hex")}\n${pubBox.toString("base64")}`, "utf8").toString("base64");

  const message = crypto.createHash("blake2b512").update(fileBuf).digest();
  const sig64 = crypto.sign(null, message, privateKey); // 64 octets
  const sigBox = Buffer.concat([Buffer.from("ED", "latin1"), opts.sigKeyId || keyId, sig64]); // 74 octets
  const sigField = Buffer.from(
    `untrusted comment: signature from tauri secret key\n${sigBox.toString("base64")}\ntrusted comment: timestamp:1\tfile:x\tversion:0.7.2\n${sigBox.toString("base64")}`,
    "utf8"
  ).toString("base64");
  return { pubField, sigField };
}

const payload = Buffer.from("contenu de test de l'installateur", "utf8");
const fx = makeFixture(payload);
const good = minisign.verify(payload, fx.sigField, fx.pubField);
ok(good.ok === true, "signature préhashée valide acceptée");
ok(good.signedVersion === "0.7.2", "version signée lue depuis le commentaire de confiance");

const tampered = minisign.verify(Buffer.from("contenu altéré", "utf8"), fx.sigField, fx.pubField);
ok(tampered.ok === false, "contenu altéré rejeté");

const wrongKey = minisign.verify(payload, makeFixture(payload, { sigKeyId: crypto.randomBytes(8) }).sigField, fx.pubField);
ok(wrongKey.ok === false && /clé de signature/.test(wrongKey.reason || ""), "clé de signature différente rejetée");

// Signature héritée « Ed » (Ed25519 direct sur le fichier).
(() => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(12);
  const keyId = crypto.randomBytes(8);
  const pubBox = Buffer.concat([Buffer.from("Ed", "latin1"), keyId, raw]);
  const pubField = Buffer.from(`untrusted comment: minisign public key: ${keyId.toString("hex")}\n${pubBox.toString("base64")}`, "utf8").toString("base64");
  const sigBox = Buffer.concat([Buffer.from("Ed", "latin1"), keyId, crypto.sign(null, payload, privateKey)]);
  const sigField = Buffer.from(`untrusted comment: signature\n${sigBox.toString("base64")}\ntrusted comment: v\n${sigBox.toString("base64")}`, "utf8").toString("base64");
  ok(minisign.verify(payload, sigField, pubField).ok === true, "signature héritée « Ed » acceptée");
})();

console.log(failed ? `\n${failed} échec(s)` : "\nTout est bon");
process.exit(failed ? 1 : 0);
