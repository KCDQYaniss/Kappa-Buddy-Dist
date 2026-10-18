// Vérifie les données de cartes générées par tools/prepare_maps.py : étages, fichiers et cohérence.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "ui");
const maps = JSON.parse(fs.readFileSync(path.join(root, "maps.json"), "utf8"));

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  ÉCHEC ") + msg); if (!cond) failed++; };

const FLOOR_ID = /^(Ground_Level|Ground_Floor|Underground_Level|Underground|Basement|Bunkers|Tunnels|(First|Second|Third|Fourth|Fifth|Sixth|Seventh|Eighth)_Floor)$/;
const exists = (rel) => fs.existsSync(path.join(root, rel));

console.log("Cartes");
const slugs = maps.map((m) => m.slug);
ok(new Set(slugs).size === slugs.length, "aucun doublon de slug");
ok(maps.length >= 13, `${maps.length} cartes`);
for (const m of maps) {
  if (!m.image && !m.tiles) { ok(false, `${m.slug} : aucun visuel (image ou tuiles)`); continue; }
  if (m.image) ok(exists(m.image), `${m.slug} : image de base présente`);
  if (m.tiles) ok(/^https:\/\/assets\.tarkov\.dev\//.test(m.tiles), `${m.slug} : tuiles distantes`);
  if (!m.floors) continue;
  ok(m.floors.length >= 2, `${m.slug} : ${m.floors.length} étages déclarés`);
  ok(m.floors[0].name && m.floors.every((f) => f.name), `${m.slug} : chaque étage a un nom`);
  ok(m.floors.every((f) => f.image || f.tiles), `${m.slug} : chaque étage a un visuel`);
  m.floors.forEach((f, i) => {
    if (f.image) {
      ok(exists(f.image), `${m.slug} étage ${i + 1} : fichier présent`);
      const svg = fs.readFileSync(path.join(root, f.image), "utf8");
      const ids = [...svg.matchAll(/<g[^>]*\bid="([^"]+)"/g)].map((x) => x[1]);
      // Les groupes imbriqués reprennent des noms proches : on ne regarde que la racine via l'ordre du document.
      const top = ids.filter((id) => FLOOR_ID.test(id));
      const distinct = new Set(top);
      ok(distinct.size === 1, `${m.slug} étage ${i + 1} : un seul niveau dessiné (${[...distinct].join(", ") || "aucun"})`);
    }
    if (f.ylim) ok(Array.isArray(f.ylim) && f.ylim.length === 2 && f.ylim[0] <= f.ylim[1], `${m.slug} étage ${i + 1} : plage de hauteur cohérente`);
  });
}

console.log(failed ? `\n${failed} échec(s)` : "\nTout est bon");
process.exit(failed ? 1 : 0);
