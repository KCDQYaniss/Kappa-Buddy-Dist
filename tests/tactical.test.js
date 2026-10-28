// Test du générateur de fond tactique (ui/tactical.js) : projection alignée sur
// la calibration, filtrage par étage, étiquettes de zones traduites, dangers,
// thèmes, cache. Aucun DOM requis : le module est pur.
"use strict";
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "ui") + "/";

require(root + "geo.js");           // pose globalThis.Geo (utilisé par tactical)
const tactical = require(root + "tactical.js");

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ok   " + msg); }
  else { failed++; console.error("  ÉCHEC " + msg); }
}

// Définition type Customs (transform/rotation/bounds réels de ui/maps.json).
const def = {
  slug: "customs", name: "Customs",
  transform: [0.239, 168.65, 0.239, 136.35], rotation: 180,
  bounds: [[698, -307], [-372, 237]],
  floors: [
    { name: "Ground Floor" },
    { name: "2nd Floor", ylim: [2.7, 1000] },
    { name: "Underground", ylim: [-1000, 0.5] },
  ],
};
const md = {
  containers: [
    { position: { x: 100, y: 0, z: 0 } },
    { position: { x: 200, y: 5, z: 50 } },
  ],
  loose: [{ position: { x: 150, y: 0, z: 20 }, items: [] }],
  spawns: [
    { position: { x: 90, y: 0, z: -10 }, zoneName: "ZoneDormitory", categories: ["player"] },
    { position: { x: 95, y: 0, z: -12 }, zoneName: "ZoneDormitory", categories: ["player"] },
    { position: { x: 92, y: 0, z: -11 }, zoneName: "ZoneDormitory", categories: ["player"] },
    { position: { x: 300, y: 0, z: 100 }, zoneName: "ZoneGasStation", categories: ["bot"] },
  ],
  hazards: [{ hazardType: "minefield", outline: [{ x: 0, z: 0 }, { x: 50, z: 0 }, { x: 50, z: 50 }, { x: 0, z: 50 }] }],
  bosses: [{ name: "Reshala", spawnLocations: [{ name: "ZoneDormitory", positions: [{ x: 100, y: 0, z: 10 }] }] }],
};

const count = (svg, re) => (svg.match(re) || []).length;

console.log("Génération de base");
const g = tactical.build(def, md, 0, "dark", "fr");
ok(g.startsWith("<svg") && g.endsWith(">"), "SVG valide produit");
ok(/viewBox="-?\d+(\.\d+)? -?\d+(\.\d+)? \d+(\.\d+)? \d+(\.\d+)?"/.test(g), "viewBox numérique présent");
ok(!g.includes("NaN") && !g.includes("undefined"), "aucun NaN/undefined dans le rendu");

console.log("Contenu du fond");
ok(count(g, /<circle /g) === 2 + 1 + 4, "tous les points dessinés au sol (2 conteneurs + 1 loose + 4 spawns)");
ok(/<polygon /.test(g), "polygone de danger (champ de mines) dessiné");
ok(g.includes("Dortoir"), "étiquette de zone traduite en français (ZoneDormitory → Dortoir)");
ok(g.includes("Reshala"), "zone de boss nommée");
ok(/rotate\(-180 /.test(g), "textes contre-rotatés (rotation CRS 180°)");
ok(/100 m/.test(g), "échelle 100 m présente");
ok(/>N</.test(g), "boussole présente");

console.log("Filtrage par étage");
const f1 = tactical.build(def, md, 1, "dark", "fr");
ok(count(f1, /<circle /g) === 1, "étage 2 : seul le point y=5 (ylim 2.7–1000) est dessiné");
const fu = tactical.build(def, md, 2, "dark", "fr");
ok(count(fu, /<circle /g) === 6, "sous-sol (ylim ≤ 0.5) : les 6 points y=0 y appartiennent, comme floorIdxOf des marqueurs");

console.log("Étiquettes de zones");
ok(tactical.zoneLabel("ZoneDormitory", "en") === "Dormitory", "zoneLabel en anglais");
ok(tactical.zoneLabel("ZoneGasStation", "fr") === "Station-service", "zoneLabel composé traduit");
ok(tactical.zoneLabel("ZoneInconnuMachin", "fr") === "Inconnu Machin", "mot inconnu → passe tel quel (lisible)");

console.log("Thèmes et cache");
const gLight = tactical.build(def, md, 0, "light", "fr");
ok(gLight.includes("#e9ede2") && !gLight.includes("#0b0f0d"), "thème clair : palette appliquée");
ok(tactical.build(def, md, 0, "dark", "fr") === g, "cache : même entrée → même chaîne (sans recalcul)");
tactical.invalidate();
ok(tactical.build(def, md, 0, "dark", "fr") === g, "après invalidate() : régénération identique (déterministe)");

console.log("Robustesse");
ok(tactical.build(null, md, 0, "dark", "fr") === "", "def absent → chaîne vide (repli communauté)");
ok(tactical.build(def, null, 0, "dark", "fr") === "", "données absentes → chaîne vide (repli communauté)");
const sparse = tactical.build(def, { containers: [], loose: [], spawns: [], hazards: [], bosses: [] }, 0, "dark", "fr");
ok(sparse.startsWith("<svg") && /<line /.test(sparse), "carte sans données : fond (grille) quand même généré");

console.log(`\nTOTAL: ${passed} passés, ${failed} échoués`);
process.exit(failed ? 1 : 0);
