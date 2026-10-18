// Repro : flux des points personnalisés (clic droit -> ajout -> affichage + clic droit sur le point).
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "ui") + "/";
const fixtureText = fs.readFileSync(root + "demo/data.json", "utf8");

const html = fs.readFileSync(root + "index.html", "utf8").replace(/<script[^>]*><\/script>/g, "").replace(/<link[^>]*>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
w.HTMLDialogElement.prototype.close = function () { this.open = false; };
Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { get: () => 1000 });
Object.defineProperty(w.HTMLElement.prototype, "clientHeight", { get: () => 700 });
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
w.HTMLCanvasElement.prototype.getContext = () => ctx2d;
w.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync(root + u, "utf8")) });

// Points existants : un valide (Customs) + un corrompu (sans y) qui doit être ignoré sans casser le reste.
w.localStorage.setItem("customPoints", JSON.stringify([
  { map: "customs", x: 111, y: 222, z: 0, name: "Ancien" },
  { map: "customs", x: 500 },              // corrompu : pas de y
  { map: "woods", x: "abc", y: null },     // corrompu : coordonnées non numériques
]));

const handlers = {}, calls = [];
w.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "get_state") return { screenshots_dir: "C:/s", logs_dir: null, delete_screenshots: false, lang: "fr", game_mode: "PvP", always_on_top: false, auto_start: false, close_to_tray: false, start_minimized: false, check_updates: true, map: null, position: null, warnings: [] };
      if (cmd === "load_cache") return fixtureText;
      if (cmd === "load_progress") return null;
      if (cmd === "save_progress") return null;
      return null;
    },
  },
  event: { listen: async (n, cb) => { handlers[n] = cb; return () => {}; } },
};
const errors = [];
w.addEventListener("error", (e) => errors.push(e.message));
for (const f of ["i18n.js", "theme.js", "vendor/leaflet.js", "geo.js", "store.js", "mapview.js", "quests.js", "items.js", "catchup.js", "tour.js", "app.js"]) w.eval(fs.readFileSync(root + f, "utf8"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  FAIL ") + msg); if (!cond) failed++; };
const emit = (n, payload) => handlers[n]({ payload });
const layerCount = (g) => { let n = 0; if (g && g.eachLayer) g.eachLayer(() => n++); return n; };

(async () => {
  await wait(300);
  const d = w.document, TT = w.TT;

  emit("map", { raw: "bigmap", slug: "customs" });
  await wait(80);
  console.log("map affichée:", TT.mapview.current().slug);

  // 0) Le point corrompu est ignoré, le point valide reste affiché.
  ok(layerCount(TT.mapview.current().groups.customPoints) === 1, "au démarrage : seul le point valide est dessiné (le corrompu est ignoré)");

  // 1) Clic droit sur la carte -> menu "Ajouter"
  const mapEl = d.getElementById("map");
  const ev = new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 350 });
  mapEl.dispatchEvent(ev);
  await wait(30);
  const menu = d.querySelector(".context-menu");
  ok(!!menu && /Ajouter/.test(menu.textContent), "clic droit sur la carte : menu 'ajouter un point'");

  // 2) Ajouter un point
  menu.querySelector(".cm-item").click();
  await wait(30);
  const dlg = d.querySelector(".custom-point-dialog");
  ok(!!dlg, "le dialogue d'ajout s'ouvre");
  d.getElementById("cp-name").value = "Test point";
  d.getElementById("cp-ok").click();
  await wait(30);

  const stored = JSON.parse(w.localStorage.getItem("customPoints") || "[]");
  const added = stored.find((p) => p.name === "Test point");
  ok(!!added, "le point est enregistré dans localStorage");
  ok(isFinite(added.x) && isFinite(added.y), "le point enregistré a des coordonnées valides");

  const g = TT.mapview.current().groups.customPoints;
  ok(layerCount(g) === 2, "le nouveau marqueur apparaît immédiatement (sans refresh)");
  ok(/Test point/.test(d.getElementById("map-side").innerHTML), "la barre latérale liste le nouveau point");

  // 3) Le marqueur est bien placé au point cliqué (x = lng, y = lat).
  let placed = null;
  g.eachLayer((l) => { if (l.getLatLng) { const ll = l.getLatLng(); if (Math.abs(ll.lng - added.x) < 1e-6 && Math.abs(ll.lat - added.y) < 1e-6) placed = ll; } });
  ok(!!placed, "le marqueur est placé aux coordonnées du clic (pas sur une ligne fixe)");

  // 4) Clic droit sur le marqueur -> modifier / supprimer
  const cpEl = d.querySelector(".custom-point");
  ok(!!cpEl, "un élément de point est dans le DOM");
  const ev2 = new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 500, clientY: 350 });
  cpEl.dispatchEvent(ev2);
  await wait(30);
  const menu2 = d.querySelector(".context-menu");
  ok(!!menu2 && /Modifier/.test(menu2.textContent) && /Supprimer/.test(menu2.textContent), "clic droit sur le point : menu modifier/supprimer");
  ok(!/Ajouter un point/.test(menu2.textContent), "le menu du fond de carte ne remplace pas le menu du point");

  // 5) Suppression via le menu
  const beforeDel = JSON.parse(w.localStorage.getItem("customPoints")).length;
  [...menu2.querySelectorAll(".cm-item")].find((b) => /Supprimer/.test(b.textContent)).click();
  await wait(30);
  ok(layerCount(TT.mapview.current().groups.customPoints) === beforeDel - 1, "suppression : le point disparaît de la carte");
  ok(JSON.parse(w.localStorage.getItem("customPoints")).length === beforeDel - 1, "suppression : retiré du stockage");

  ok(errors.length === 0, "aucune erreur JS" + (errors.length ? " : " + errors.join(" | ") : ""));
  console.log(failed ? `\n${failed} échec(s)` : "\nTout est bon");
  process.exit(failed ? 1 : 0);
})();
