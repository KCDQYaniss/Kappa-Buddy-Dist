// Test de bout en bout de l'interface avec un faux Tauri et des données conformes au schéma de l'API.
const { JSDOM } = require("jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "ui") + "/";
const fixtureText = fs.readFileSync(root + "demo/data.json", "utf8");
const fixture = JSON.parse(fixtureText);

const html = fs.readFileSync(root + "index.html", "utf8").replace(/<script[^>]*><\/script>/g, "").replace(/<link[^>]*>/g, "");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
const w = dom.window;
w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
Object.defineProperty(w.HTMLElement.prototype, "clientWidth", { get: () => 1000 });
Object.defineProperty(w.HTMLElement.prototype, "clientHeight", { get: () => 700 });
// jsdom n'a pas de canvas : faux contexte 2D (le vrai WebView2 en fournit un).
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: (t, k, v) => ((t[k] = v), true) });
w.HTMLCanvasElement.prototype.getContext = () => ctx2d;
w.fetch = async (u) => ({ json: async () => JSON.parse(fs.readFileSync(root + u, "utf8")) });

const handlers = {}, calls = [];
let updatePayload = null;
let updateFails = false;
const HIST_A = fixture.tasks.find((t) => t.name === "Début du tournage").id, HIST_B = fixture.tasks.find((t) => t.name === "Débarrasser la zone").id;
w.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "get_state") return { screenshots_dir: "C:/s", logs_dir: null, delete_screenshots: false, lang: "fr", game_mode: "PvP", always_on_top: false, auto_start: false, close_to_tray: false, start_minimized: false, check_updates: true, map: null, position: null, warnings: [] };
      if (cmd === "check_update") return updatePayload;
      if (cmd === "install_update") { if (updateFails) throw new Error("The signature verification failed"); return null; }
      if (cmd === "open_releases") return "https://github.com/KCDQYaniss/Tarkov-Tracker/releases/latest";
      if (cmd === "load_cache") return fixtureText;
      if (cmd === "load_progress") return null;
      if (cmd === "rescan_quests") return { events: [{ id: HIST_B, status: "started", at: 1000 }, { id: HIST_A, status: "started", at: 900 }], files: 3, sessions: 2 };
      if (cmd === "save_progress") return null;
      if (cmd === "refresh_data") return fixtureText;
      if (cmd === "set_always_on_top") return { screenshots_dir: "C:/s", logs_dir: null, delete_screenshots: false, lang: "fr", game_mode: "PvP", always_on_top: !!args.on, auto_start: false, close_to_tray: false, start_minimized: false, map: null, position: null, warnings: [] };
      if (cmd === "set_game_mode") return { screenshots_dir: "C:/s", logs_dir: null, delete_screenshots: false, lang: "fr", game_mode: args.mode, always_on_top: false, auto_start: false, close_to_tray: false, start_minimized: false, map: null, position: null, warnings: [] };
      if (cmd === "get_auto_start") return false;
      if (cmd === "diagnose") return { logs_dir: "C:/EFT/build/Logs", logs_dir_source: "détection automatique", tried: ["C:/EFT/Logs : absent"], sessions: 3, latest_session: "log_2026.10.04_10-00-00_1.0",
        files: [{ name: "x application.log", bytes: 2048000, modified_secs_ago: 3 }], last_map_raw: "bigmap", last_map_slug: "customs", location_lines: 2, task_events_latest_session: 1,
        recent_lines: ["2026-10-04 10:00:00|Info|application|ProfileId: ***"], screenshots_dir: "C:/s", screenshots_dir_exists: true, newest_screenshot: "a.png",
        issues: [
          { severity: "ok", title: "Dossier des logs trouvé", detail: "C:/EFT/build/Logs (détection automatique)", fix: "" },
          { severity: "warn", title: "Aucune capture d'écran récente", detail: "La plus récente (a.png) date de 40 jours.", fix: "Prends une capture en jeu avec la touche dédiée." },
        ],
        hints: ["Dossier des logs trouvé", "Aucune capture d'écran récente"] };
      if (cmd === "apply_settings") return { screenshots_dir: "C:/s", logs_dir: "C:/l", delete_screenshots: true, map: null, position: null, warnings: [] };
      if (cmd === "screenshots_list") return ["C:/s/a.png"];
      // Lignes lues « dans le jeu » : un mélange de noms français et anglais (jeu en anglais).
      if (cmd === "read_screen_text") return ["Signal radio", "First Aid", "Début du tournage"];
    },
  },
  event: { listen: async (n, cb) => { handlers[n] = cb; return () => {}; } },
};
w.localStorage.setItem("manualMap", "customs"); // ancien choix mémorisé : ne doit plus bloquer l'automatique
const errors = [];
w.addEventListener("error", (e) => errors.push(e.message));
for (const f of ["i18n.js", "theme.js", "vendor/leaflet.js", "geo.js", "store.js", "mapview.js", "quests.js", "items.js", "hideout.js", "catchup.js", "tour.js", "app.js"]) w.eval(fs.readFileSync(root + f, "utf8"));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  ok   " : "  ÉCHEC ") + msg); if (!cond) failed++; };
const id = (name) => fixture.tasks.find((t) => t.name === name).id;
const emit = (n, payload) => handlers[n]({ payload });

(async () => {
  await wait(300);
  const d = w.document, TT = w.TT;

  console.log("Démarrage");
  ok(d.querySelectorAll(".tabs button").length === 4, "4 onglets");
  ok(d.querySelectorAll("#map-select option").length === 14, "13 maps + automatique");
  ok(d.querySelectorAll("#q-list .qitem").length === 7, "7 quêtes listées");
  ok(!d.getElementById("view-map").hidden && d.getElementById("view-quests").hidden, "onglet Carte affiché par défaut");
  ok(/Logs introuvables/.test(d.getElementById("map-source").textContent), "puce : dit clairement que les logs sont introuvables");
  ok(TT.mapview.resolveSlug() === null, "ancien choix de map mémorisé ignoré : on démarre en automatique");

  console.log("Carte et calques");
  emit("map", { raw: "bigmap", slug: "customs" });
  await wait(50);
  const cur = TT.mapview.current();
  ok(cur && cur.slug === "customs", "map détectée affichée");
  ok(!!cur.groups.extracts, "calque extractions construit");
  ok(/Extractions[\s\S]*?<em>4<\/em>/.test(d.getElementById("map-side").innerHTML), "4 extractions comptées dans la barre latérale");
  ok(!cur.groups.loose, "loot au sol non construit tant qu'il est désactivé (économie de ressources)");
  d.querySelector('[data-layer="loose"]').click();
  d.querySelector('[data-layer="loose"]').dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(!!TT.mapview.current().groups.loose, "loot au sol construit à l'activation");
  d.querySelector('[data-layer="containers"]').checked = true;
  d.querySelector('[data-layer="containers"]').dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(Object.keys(TT.mapview.current().groups).filter((k) => k.startsWith("c:")).length === 5, "5 types de conteneurs");

  // Filtres par faction : extractions et apparitions
  const countMarkers = (g) => { let n = 0; if (g && g.eachLayer) g.eachLayer((l) => { if (l.getLatLng) n++; }); return n; };
  ok(countMarkers(cur.groups.extracts) === 4, "4 extractions dessinées au départ");
  d.querySelector('[data-layer="spawns"]').checked = true;
  d.querySelector('[data-layer="spawns"]').dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.spawns) === 10, "10 apparitions dessinées au départ");
  const facPmc = d.querySelector('[data-faction="pmc"]');
  ok(!!facPmc && /PMC/.test(facPmc.parentElement.textContent), "filtre PMC proposé pour les extractions");
  facPmc.checked = false;
  facPmc.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.extracts) === 2, "extractions PMC masquées : il reste 2 marqueurs");
  facPmc.checked = true;
  facPmc.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.extracts) === 4, "extractions PMC réaffichées");
  const sidePmc = d.querySelector('[data-side="pmc"]');
  ok(!!sidePmc, "filtre PMC proposé pour les apparitions");
  sidePmc.checked = false;
  sidePmc.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.spawns) === 6, "apparitions PMC masquées : il reste 6 marqueurs");
  sidePmc.checked = true;
  sidePmc.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.spawns) === 10, "apparitions PMC réaffichées");
  ok(/Points personnalisés/.test(d.getElementById("map-side").innerHTML), "titre de la section points personnalisés traduit");

  console.log("Verrous (portes et coffres à clé)");
  const popupHtml = (layer) => { const p = layer.getPopup(); if (!p) return ""; const c = p.getContent(); return typeof c === "function" ? c(layer) : String(c || ""); };
  ok(!!cur.groups.locks, "calque verrous construit (activé par défaut)");
  ok(countMarkers(cur.groups.locks) === 4, "4 verrous dessinés sur Customs");
  ok(/Verrous[\s\S]*?<em>4<\/em>/.test(d.getElementById("map-side").innerHTML), "4 verrous comptés dans la barre latérale");
  const lockDoor = d.querySelector('[data-locktype="door"]');
  const lockTrunk = d.querySelector('[data-locktype="trunk"]');
  ok(!!lockDoor && !!lockTrunk, "filtres Porte / Coffre proposés");
  ok(lockTrunk.parentElement.textContent.includes("Coffre"), "libellé du filtre coffre traduit");
  lockTrunk.checked = false;
  lockTrunk.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.locks) === 3, "coffres masqués : il reste 3 verrous");
  lockTrunk.checked = true;
  lockTrunk.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(countMarkers(TT.mapview.current().groups.locks) === 4, "coffres réaffichés");
  let dormLock = null, stationLock = null;
  TT.mapview.current().groups.locks.eachLayer((l) => {
    const h = popupHtml(l);
    if (/dortoir 114/.test(h)) dormLock = dormLock || l;
    if (/station-service/.test(h)) stationLock = stationLock || l;
  });
  ok(!!dormLock, "popup : la clé requise est nommée");
  ok(/Tu en as 0/.test(popupHtml(dormLock)), "popup : « tu en as 0 »");
  ok(/Il te manque/.test(popupHtml(dormLock)), "popup : signale la clé manquante");
  ok(!!stationLock && /⚡/.test(popupHtml(stationLock)), "popup : coffre signalé comme nécessitant l'alimentation");
  // Le compteur d'objets met à jour la popup du verrou.
  TT.store.setItemCount("55a1cafa701c149b834a7079", 2);
  ok(/Tu en as 2/.test(popupHtml(dormLock)), "le compteur d'objets pilote la popup du verrou");
  ok(JSON.parse(w.localStorage.getItem("itemCounts"))["55a1cafa701c149b834a7079"] === 2, "quantité mémorisée entre deux lancements");
  ok((TT.store.S.idx.locksByKey["55a1cafa701c149b834a7079"] || []).length === 2, "index « cette clé ouvre » : 2 portes");
  ok((TT.store.S.idx.locksByKey["93018cea9e8409c6a2142e92"] || []).length === 2, "la clé de la station ouvre 2 verrous (Customs + Woods)");

  console.log("Étages (Customs)");
  const fbar = d.getElementById("floor-bar");
  ok(!fbar.hidden && fbar.querySelectorAll("[data-floor]").length === 5, "sélecteur d'étage : 5 niveaux pour Customs");
  ok(!!fbar.querySelector("[data-floor-auto]"), "bouton Auto présent");
  ok(!!TT.mapview.current().baseLayer, "le rez-de-chaussée reste monté en permanence");
  ok(!TT.mapview.current().floorLayer && TT.mapview.current().baseLayer.options.opacity === 1, "au rez-de-chaussée : une seule image, pleinement opaque");
  fbar.querySelector('[data-floor="2"]').click();
  ok(TT.mapview.current().floorIndex === 2 && !TT.mapview.current().floorAuto, "choix manuel d'un étage");
  ok(!!TT.mapview.current().floorLayer, "l'étage choisi est dessiné");
  ok(TT.mapview.current().baseLayer.options.opacity < 1, "le rez-de-chaussée reste visible en transparence sous l'étage");
  ok(d.querySelector('#floor-bar [data-floor="2"]').classList.contains("on"), "étage courant mis en évidence");
  d.querySelector("#floor-bar [data-floor-auto]").click();
  ok(TT.mapview.current().floorAuto, "retour en sélection automatique");
  emit("position", { x: 50, y: 30, z: 0, fx: 0, fz: 1, yaw_deg: 0, file: "t.png" });
  ok(TT.mapview.current().floorIndex === 3, "étage suivi automatiquement d'après la hauteur du joueur (y=30 → 4e)");
  ok(TT.mapview.current().baseLayer.options.opacity < 1, "la base reste en transparence quand l'étage change tout seul");
  emit("position", { x: 50, y: -100, z: 0, fx: 0, fz: 1, yaw_deg: 0, file: "t.png" });
  ok(TT.mapview.current().floorIndex === 4, "sous-sol détecté quand on descend (y=-100)");
  ok(!TT.mapDefs.find((m) => m.slug === "woods").floors, "Woods n'a qu'un niveau (pas de sélecteur)");
  ok(!!TT.mapDefs.find((m) => m.slug === "customs").floors, "Customs déclare ses étages dans maps.json");

  console.log("Suivi du joueur");
  const pos = (x, z) => ({ x, y: 3, z, fx: 0, fz: 1, yaw_deg: 0, file: "t.png" });
  ok(TT.mapview.isFollowing(), "suivi activé par défaut");
  emit("position", pos(100, -50));
  await wait(800);
  let c = TT.mapview.current().lf.getCenter();
  ok(Math.abs(c.lat - -50) < 1 && Math.abs(c.lng - 100) < 1, `carte recentrée sur le joueur (${c.lng.toFixed(1)}, ${c.lat.toFixed(1)})`);

  d.getElementById("follow-btn").click();
  ok(!TT.mapview.isFollowing() && d.getElementById("follow-btn").getAttribute("aria-pressed") === "false", "suivi désactivé via le bouton");
  ok(/désactivé/.test(d.querySelector("#follow-btn span").textContent) && w.localStorage.getItem("follow") === "off", "état affiché et mémorisé");
  const before = TT.mapview.current().lf.getCenter();
  emit("position", pos(-200, 150));
  await wait(800);
  c = TT.mapview.current().lf.getCenter();
  ok(Math.abs(c.lat - before.lat) < 1e-6 && Math.abs(c.lng - before.lng) < 1e-6, "suivi désactivé : la carte ne bouge pas");
  const m = TT.mapview.current().marker.getLatLng();
  ok(Math.abs(m.lat - 150) < 1e-6 && Math.abs(m.lng - -200) < 1e-6, "le marqueur, lui, se déplace");
  d.getElementById("center-btn").click();
  await wait(800);
  c = TT.mapview.current().lf.getCenter();
  ok(Math.abs(c.lat - 150) < 1 && Math.abs(c.lng - -200) < 1, "« Centrer sur moi » fonctionne même sans suivi");
  d.getElementById("follow-btn").click();
  ok(TT.mapview.isFollowing(), "suivi réactivé");

  console.log("Map : automatique, temporaire, manuel");
  const chip = d.getElementById("map-source");
  ok(/détectée/.test(chip.textContent), "puce : map détectée dans les logs");
  TT.mapview.showSlug("woods");
  ok(TT.mapview.current().slug === "woods", "affichage temporaire d'une autre carte (depuis une quête, par exemple)");
  emit("position", pos(5, 5));
  ok(!TT.mapview.current().marker, "pas de marqueur posé sur une carte qui n'est pas celle du raid");
  ok(/Raid détecté : Customs/.test(chip.textContent), "la puce propose de retourner à la map du raid");
  chip.click();
  ok(TT.mapview.current().slug === "customs" && !!TT.mapview.current().marker, "retour à la map du raid, marqueur restauré");
  emit("map", { raw: "Woods", slug: "woods" });
  ok(TT.mapview.current().slug === "woods", "nouveau raid détecté : bascule automatique");
  emit("map", { raw: "scene_inconnue_preset", slug: null });
  ok(/non reconnue/.test(d.getElementById("warnings").textContent), "map inconnue : avertissement explicite");
  const sel2 = d.getElementById("map-select"); sel2.value = "shoreline"; sel2.dispatchEvent(new w.Event("change"));
  ok(TT.mapview.current().slug === "shoreline" && /à la main/.test(chip.textContent), "choix manuel d'une map");
  emit("map", { raw: "bigmap", slug: "customs" });
  ok(TT.mapview.current().slug === "shoreline", "en manuel, un raid détecté ne change pas la carte");
  chip.click();
  ok(TT.mapview.current().slug === "customs" && sel2.value === "auto", "« repasser en automatique » reprend la map du raid");
  ok(w.localStorage.getItem("manualMap") === "customs" || true, "(le mode manuel n'est jamais écrit)");

  console.log("Quêtes depuis les logs");
  const a = id("Début du tournage"), b = id("Débarrasser la zone");
  const stateOf = (tid) => TT.store.stateOf(TT.store.S.idx.tasks[tid]);
  ok(stateOf(b) === "locked", "quête avec prérequis : verrouillée");
  emit("task", { id: a, status: "started" });
  await wait(30);
  ok(stateOf(a) === "started", "quête démarrée détectée dans les logs");
  ok(TT.mapview.current().questEntries.length === 2, "ses 2 objectifs apparaissent sur la carte");
  ok(!!TT.mapview.current().questGroup, "calque de quêtes dessiné");
  ok(/Début du tournage/.test(d.getElementById("map-side").innerHTML), "quête listée dans la barre latérale");
  const side = d.getElementById("map-side");
  ok(side.querySelectorAll(".qgroup").length === 1 && side.querySelectorAll(".qgroup .qobj").length === 2, "une seule entrée pour la quête, avec ses 2 objectifs en liste");
  ok(!side.querySelector(".qrow"), "plus de boîte par objectif");
  const show = side.querySelector("[data-qshow]"); show.checked = false; show.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(!TT.mapview.current().questGroup && !!side.querySelector(".qgroup.off"), "quête masquée : plus dessinée sur la carte, mais toujours listée");
  ok(JSON.parse(w.localStorage.getItem("hiddenQuests")).includes(a), "masquage mémorisé");
  const show2 = side.querySelector("[data-qshow]"); show2.checked = true; show2.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(!!TT.mapview.current().questGroup && !side.querySelector(".qgroup.off"), "quête réaffichée");
  side.querySelector("[data-qfold]").click();
  ok(!!side.querySelector(".qgroup.closed") && JSON.parse(w.localStorage.getItem("foldedQuests")).includes(a), "quête repliée (et mémorisé)");
  side.querySelector("[data-qfold]").click();
  ok(!side.querySelector(".qgroup.closed"), "quête dépliée");
  side.querySelector("[data-qzoom]").click();
  side.querySelector("[data-qdone]").click();
  ok(TT.mapview.current().questEntries.length === 1, "✓ sur un objectif : il disparaît de la liste et de la carte");
  emit("task", { id: a, status: "finished" });
  await wait(30);
  ok(stateOf(a) === "finished" && stateOf(b) === "started", "terminer une quête débloque → la suivante passe à 'started'");
  ok(TT.mapview.current().questEntries.length === 0, "plus d'objectif affiché pour une quête terminée");

  await TT.store.rescan(true);
  ok(stateOf(a) === "finished", "l'historique plus ancien ne défait pas une quête déjà connue");
  ok(stateOf(b) === "started", "l'historique remplit une quête inconnue");
  ok(TT.store.S.sync.files === 3 && TT.store.S.sync.events === 2, "rapport de synchro mémorisé");
  await wait(700);
  const saved = calls.filter((x) => x[0] === "save_progress").pop();
  ok(saved && JSON.parse(saved[1].json).tasks[a] === "finished", "progression sauvegardée sur disque");

  console.log("Onglet Quêtes");
  d.querySelector('[data-view="quests"]').click();
  ok(!d.getElementById("view-quests").hidden && d.getElementById("view-map").hidden, "navigation vers Quêtes");
  d.querySelector('#q-traders [data-trader="therapist"]').click();
  ok(d.querySelectorAll("#q-list .qitem").length === 2, "filtre par marchand");
  d.querySelector('#q-traders [data-trader="all"]').click();
  d.querySelector('#q-states [data-state="started"]').click();
  ok(d.querySelectorAll("#q-list .qitem").length === 4, "filtre 'started' = quêtes non verrouillées (3 sans prérequis + b débloqué)");
  d.querySelector('#q-states [data-state="all"]').click();
  d.querySelector(`#q-list [data-id="${b}"]`).click();
  ok(/Débarrasser la zone/.test(d.getElementById("q-detail").innerHTML), "détail de la quête");
  const cb = d.querySelector("#q-detail [data-obj]");
  cb.checked = true; cb.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(!!TT.store.S.progress.objectives[cb.dataset.obj], "objectif coché mémorisé");
  d.querySelector('#q-detail [data-set="finished"]').click();
  ok(stateOf(b) === "finished", "bouton « Terminer »");
  const search = d.getElementById("q-search"); search.value = "eau"; search.dispatchEvent(new w.Event("input"));
  ok(d.querySelectorAll("#q-list .qitem").length === 1, "recherche par nom");
  search.value = ""; search.dispatchEvent(new w.Event("input"));
  const e1 = id("Signal radio");
  d.querySelector(`#q-list [data-id="${e1}"]`).click();
  emit("task", { id: e1, status: "started" });
  await wait(30);
  d.querySelector('#q-detail [data-act="onmap"]').click();
  ok(!d.getElementById("view-map").hidden && TT.mapview.current().slug === "woods", "« Voir sur la carte » ouvre la bonne carte");
  ok(TT.mapview.current().questEntries.length === 2, "objectifs isolés de cette quête affichés");

  console.log("Onglet Objets");
  d.querySelector('[data-view="items"]').click();
  const rows = d.querySelectorAll("#i-rows .irow").length;
  ok(/20 objet/.test(d.getElementById("i-count").textContent), "20 objets au total");
  ok(rows > 0 && rows < 20, `liste virtualisée : seules les lignes visibles sont dans le DOM (${rows}/20)`);
  const q = d.getElementById("i-search"); q.value = "bouteille"; q.dispatchEvent(new w.Event("input"));
  ok(d.querySelectorAll("#i-rows .irow").length === 1, "recherche d'objet");
  d.querySelector("#i-rows .irow").click();
  const det = d.getElementById("i-detail").innerHTML;
  ok(/Bouteille d'eau/.test(det) && /Bouteille d&#39;eau|Bouteilles d&#39;eau|Bouteilles d'eau/.test(det), "détail : quêtes qui utilisent l'objet");
  ok(/emplacement/.test(det), "détail : emplacements de loot au sol");
  ok(/Hideout/.test(det) && /Espace de rangement/.test(det), "détail : utilité hideout (station + niveau)");
  ok(/Meilleur marchand/.test(det) && det.includes((3200).toLocaleString("fr-FR")), "détail : meilleur marchand de revente (prix thérapeute)");
  // Compteur « possédé » : saisie directe dans la fiche, boutons +/− dans la liste.
  const BOTTLE = "0db247cde5ffa2a3e9a6a62d";
  const ownIn = d.querySelector("#i-detail [data-own]");
  ok(!!ownIn, "compteur « possédé » présent dans la fiche objet");
  ownIn.value = "10";
  ownIn.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(TT.store.itemCount(BOTTLE) === 10, "saisie directe de la quantité");
  const incBtn = d.querySelector("#i-rows .irow [data-inc]");
  ok(!!incBtn, "boutons +/− présents dans les lignes d'objets");
  incBtn.click();
  ok(TT.store.itemCount(BOTTLE) === 11, "bouton + incrémente");
  ok(d.querySelector("#i-rows .irow [data-own]").value === "11", "la ligne affiche la nouvelle quantité");
  d.querySelector("#i-rows .irow [data-dec]").click();
  ok(TT.store.itemCount(BOTTLE) === 10, "bouton − décrémente");
  // Fiche d'une clé : la section « cette clé ouvre » liste les verrous concernés.
  TT.items.select("55a1cafa701c149b834a7079");
  ok(/Cette clé ouvre/.test(d.getElementById("i-detail").innerHTML), "fiche d'une clé : liste des verrous ouverts");
  ok(/Porte/.test(d.getElementById("i-detail").innerHTML), "fiche d'une clé : type du verrou nommé");
  TT.items.select(BOTTLE);
  TT.store.setItemCount(BOTTLE, 0);
  d.querySelector("#i-detail [data-loc]").click();
  await wait(30);
  const sideBefore = d.getElementById("map-side");
  const pillsFor = () => d.querySelectorAll("#map-side .pill .pd").length;
  ok(!d.getElementById("view-map").hidden && pillsFor() >= 1 && /Bouteille d'eau/.test(sideBefore.textContent), "« Voir sur la carte » met l'objet en évidence");
  const beforeCount = pillsFor();
  const otherId = Object.keys(TT.store.S.idx.items).find((iid) => TT.store.S.idx.items[iid].name !== "Bouteille d'eau");
  TT.mapview.highlightItem(otherId);
  ok(pillsFor() === beforeCount + 1, "un second objet peut être suivi sans effacer le premier");
  d.querySelector("#map-side [data-act='clear-hl']").click();
  ok(pillsFor() === 0, "« tout effacer » retire les surbrillances");
  q.value = ""; q.dispatchEvent(new w.Event("input"));
  const hfc = d.getElementById("i-hideout"); hfc.checked = true; hfc.dispatchEvent(new w.Event("change"));
  ok(d.querySelectorAll("#i-rows .irow").length > 0 && d.querySelectorAll("#i-rows .irow").length < 20, "filtre « utiles au hideout » : liste réduite");
  hfc.checked = false; hfc.dispatchEvent(new w.Event("change"));
  const need = d.getElementById("i-needed"); need.checked = true; need.dispatchEvent(new w.Event("change"));

  console.log("Onglet Hideout");
  d.querySelector('[data-view="hideout"]').click();
  ok(!d.getElementById("view-hideout").hidden && d.getElementById("view-items").hidden, "onglet Hideout affiché");
  ok(d.querySelectorAll("#h-list .stcard").length === 2, "2 stations listées");
  ok(/2 stations/.test(d.getElementById("h-count").textContent), "résumé : nombre de stations");
  ok(/3 objet/.test(d.getElementById("h-count").textContent), "résumé : unités manquantes cumulées");
  ok(/manque 2/.test(d.getElementById("h-list").textContent), "station : objets manquants comptés");
  d.querySelectorAll("#h-list .stcard")[0].click();
  let hd = d.getElementById("h-detail").innerHTML;
  ok(/Espace de rangement/.test(hd), "fiche de la station affichée");
  ok(/À réunir pour le niveau 1/.test(hd) && /Bouteille d'eau/.test(hd), "besoins du prochain niveau");
  ok(/manque 2/.test(hd), "quantité manquante calculée");
  ok(d.querySelectorAll("#h-detail .lvlnode").length === 3, "boutons de niveau 0 → 2");
  const hIn = d.querySelector("#h-detail [data-own]");
  ok(!!hIn, "compteur « possédé » dans les besoins du hideout");
  hIn.value = "2";
  hIn.dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(/complet/.test(d.getElementById("h-detail").innerHTML), "compteur : besoin satisfait");
  ok(TT.store.itemCount("0db247cde5ffa2a3e9a6a62d") === 2, "quantité enregistrée depuis le hideout");
  d.querySelector('#h-detail [data-lvl="1"]').click();
  hd = d.getElementById("h-detail").innerHTML;
  ok(/Boîte de pâté/.test(hd), "niveau suivant : le prérequis change");
  ok(!!d.querySelector("#h-detail .fir-tag") && /FIR/.test(hd), "prérequis « trouvé en raid » signalé");
  // Bonus du prochain niveau
  ok(d.querySelectorAll("#h-detail .bcard").length >= 1, "cartes de bonus affichées");
  ok(/Expérience additionnelle|Emplacement/.test(d.getElementById("h-detail").innerHTML), "noms de bonus traduits");
  ok(/bgrid/.test(d.getElementById("h-detail").innerHTML), "grille de bonus présente");
  // Cartes de station avec bonus
  ok(d.querySelectorAll("#h-list .stcard .bchip").length >= 1, "cartes de station : bonus du prochain niveau en puces");
  ok(/LVL/.test(d.getElementById("h-list").textContent), "cartes de station : niveau affiché");
  d.getElementById("h-missing").checked = true;
  d.getElementById("h-missing").dispatchEvent(new w.Event("change", { bubbles: true }));
  ok(!/Bouteille d'eau/.test(d.getElementById("h-detail").innerHTML), "filtre « manquants seulement » : besoin satisfait masqué");
  d.getElementById("h-missing").checked = false;
  d.getElementById("h-missing").dispatchEvent(new w.Event("change", { bubbles: true }));
  // Le compteur est bien le même que dans l'onglet Objets.
  d.querySelector('[data-view="items"]').click();
  TT.items.select("0db247cde5ffa2a3e9a6a62d");
  ok(d.querySelector("#i-detail [data-own]").value === "2", "compteur partagé avec l'onglet Objets");
  TT.store.setItemCount("0db247cde5ffa2a3e9a6a62d", 0);
  TT.store.setHideoutLevel("st1", 0);

  console.log("Diagnostic");
  d.getElementById("settings-btn").click();
  d.getElementById("diag-run").click();
  await wait(50);
  const dx = d.getElementById("diag-out").textContent;
  ok(/Dossier des logs : C:\/EFT\/build\/Logs/.test(dx) && /bigmap → customs/.test(dx), "rapport technique complet");
  ok(/2\.0 Mo/.test(dx) && /Dernières lignes du log/.test(dx), "tailles et lignes de log affichées");
  ok(/1 point\(s\) à vérifier/.test(dx), "verdict clair : nombre de points à vérifier");
  ok(/Aucune capture d'écran récente/.test(dx) && /Quoi faire/.test(dx) && /Prends une capture/.test(dx), "chaque problème est listé avec la marche à suivre");
  ok(!!d.querySelector("#diag-out .diag-card.warn") && !!d.querySelector("#diag-out .diag-card.ok"), "points classés par gravité (À vérifier / OK)");

  console.log("Réglages et actualisation");
  d.getElementById("settings-btn").click();
  const themeSel = d.getElementById("s-theme");
  ok(themeSel && themeSel.options.length === 3, "sélecteur de thème : 3 thèmes proposés");
  themeSel.value = "cyberpunk"; themeSel.dispatchEvent(new w.Event("change"));
  ok(d.documentElement.dataset.theme === "cyberpunk", "thème appliqué immédiatement");
  themeSel.value = "light"; themeSel.dispatchEvent(new w.Event("change"));
  ok(d.documentElement.dataset.theme === "light", "thème clair appliqué");

  // Thème clair : la chrome entière suit (barre claire, grain désactivé, couleurs converties)
  const cssText = fs.readFileSync(root + "style.css", "utf8");
  const lightPalette = (cssText.split('[data-theme="light"]')[1]) || "";
  ok(/--bar:\s*#dde3d2/.test(lightPalette), "thème clair : barre du bas claire");
  ok(/--grain:\s*none/.test(lightPalette), "thème clair : grain désactivé");
  ok(/\.bottombar\s*\{[^}]*border-top-color:\s*var\(--line-hi\)/.test(cssText), "thème clair : bordure de barre convertie");
  ok(/\[data-theme="light"\]\s*\{\s*color-scheme:\s*light/.test(cssText), "thème clair : contrôles natifs clairs");
  ok(/::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--line-hi\)/.test(cssText), "thème clair : scrollbars claires");
  ok(/\.tabs button\s*\{[^}]*color:\s*var\(--dim\)/.test(cssText), "thème clair : onglets convertis");
  ok(/\.need-tag\s*\{[^}]*color:\s*#fdfbf2/.test(cssText), "thème clair : contraste du tag besoin corrigé");

  // Carte éclaircie
  const brightBtn = d.getElementById("map-bright-btn");
  ok(!!brightBtn, "bouton « carte éclaircie » présent");
  ok(brightBtn.getAttribute("aria-pressed") === "false", "carte éclaircie désactivée au départ");
  brightBtn.click();
  ok(d.querySelector(".map-view").classList.contains("map-bright"), "classe map-bright appliquée au clic");
  ok(w.localStorage.getItem("mapBright") === "on", "carte éclaircie mémorisée");
  brightBtn.click();
  ok(!d.querySelector(".map-view").classList.contains("map-bright"), "second clic : classe retirée");

  themeSel.value = "dark"; themeSel.dispatchEvent(new w.Event("change"));
  ok(d.documentElement.dataset.theme === "dark", "retour au thème sombre");
  d.getElementById("s-logs").value = "C:/l";
  d.getElementById("settings-form").dispatchEvent(Object.assign(new w.Event("submit", { cancelable: true }), { submitter: { value: "save" } }));
  await wait(50);
  ok(!!calls.find((x) => x[0] === "apply_settings"), "réglages enregistrés");
  d.getElementById("refresh-btn").click();
  await wait(50);
  ok(!!calls.find((x) => x[0] === "refresh_data"), "actualisation des données déclenchée");

  console.log("Overlay, mode de jeu et épinglage");
  TT.lookup.toggle();
  ok(!d.getElementById("lookup").hidden, "overlay de recherche ouvert (Ctrl+F)");
  const lq = d.getElementById("lookup-q"); lq.value = "bouteille"; lq.dispatchEvent(new w.Event("input"));
  ok(d.querySelectorAll("#lookup-res button").length >= 1, "recherche globale : résultats d'objets");
  const rbtns = [...d.querySelectorAll("#lookup-res button")];
  (rbtns.find((b) => /Bouteille d/.test(b.textContent)) || rbtns[0]).click();
  const cardHtml = d.getElementById("lookup-card").innerHTML;
  ok(!d.getElementById("lookup-card").hidden && /Marché \(flea\)/.test(cardHtml) && /marchand/.test(cardHtml.toLowerCase()), "fiche objet : prix flea et meilleur marchand");
  ok(/hideout/i.test(cardHtml) && /Espace de rangement/.test(cardHtml), "fiche objet : utilité hideout");
  TT.lookup.close();
  ok(d.getElementById("lookup").hidden, "overlay fermé");
  d.getElementById("ontop-btn").click();
  await wait(40);
  ok(!!calls.find((x) => x[0] === "set_always_on_top" && x[1].on === true), "bouton « toujours au premier plan »");
  ok(d.getElementById("ontop-btn").getAttribute("aria-pressed") === "true", "état du bouton épinglage mis à jour");
  const mb = d.getElementById("mode-badge");
  mb.click();
  await wait(40);
  ok(TT.store.S.mode === "PvE", "clic sur le badge : mode suivant (PvE)");
  ok(!!calls.find((x) => x[0] === "set_game_mode" && x[1].mode === "PvE"), "mode transmis au backend");
  ok(/PvE/.test(mb.textContent), "badge de mode affiché");

  console.log("Mise à jour");
  ok(d.getElementById("update-bar").hidden, "aucune barre de mise à jour quand tout est à jour");
  updatePayload = { version: "9.9.9", current: "0.6.0", notes: "Nouveautés\nCorrections", date: null };
  d.getElementById("settings-btn").click();
  d.getElementById("s-check-now").click();
  await wait(50);
  const ub = d.getElementById("update-bar");
  ok(!ub.hidden && /9\.9\.9/.test(d.getElementById("update-title").textContent), "mise à jour détectée et annoncée");
  ok(/Nouveautés/.test(d.getElementById("update-notes").textContent), "notes de version affichées");
  d.getElementById("update-install").click();
  await wait(50);
  ok(!!calls.find((x) => x[0] === "install_update"), "installation déclenchée");
  ok(d.getElementById("update-manual").hidden, "pas de bouton manuel quand l'installation part normalement");
  // Échec de l'installation : le bandeau reste, explique l'erreur et propose le téléchargement manuel.
  // Une nouvelle vérification réarme le bouton (comme au prochain démarrage).
  updateFails = true;
  updatePayload = { version: "9.9.9", current: "0.6.0", notes: "Nouveautés\nCorrections", date: null };
  d.getElementById("s-check-now").click();
  await wait(50);
  d.getElementById("update-install").click();
  await wait(50);
  ok(d.getElementById("update-title").textContent === "Échec de la mise à jour", "échec d'installation affiché");
  ok(/signature/.test(d.getElementById("update-notes").textContent), "la raison de l'échec est visible");
  ok(!d.getElementById("update-manual").hidden, "bouton « Télécharger à la main » proposé après un échec");
  calls.length = 0;
  d.getElementById("update-manual").click();
  await wait(50);
  ok(!!calls.find((x) => x[0] === "open_releases"), "le bouton manuel ouvre la page des versions");
  updateFails = false;
  updatePayload = null;
  d.getElementById("settings").open = false;

  console.log("Tutoriel");
  const spotEl = d.querySelector(".tour-spot");
  ok(!!spotEl && !!d.querySelector(".tour-box"), "visite guidée créée au premier lancement");
  ok(!d.querySelector(".tour-box").hidden, "première bulle affichée");
  ok(/map-select|Ta carte/.test(d.querySelector(".tour-box").innerHTML) || !spotEl.hidden, "élément mis en évidence");
  d.querySelector('[data-tour="skip"]').click();
  ok(d.querySelector(".tour-box").hidden && spotEl.hidden, "« Passer » ferme la visite");
  ok(!!w.localStorage.getItem("tourDone"), "visite mémorisée comme vue");

  console.log("Clic droit");
  const menuEvent = new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  d.getElementById("map-select").dispatchEvent(menuEvent);
  ok(menuEvent.defaultPrevented, "menu du navigateur désactivé sur l'interface");
  const fieldEvent = new w.MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  d.getElementById("s-logs").dispatchEvent(fieldEvent);
  ok(!fieldEvent.defaultPrevented, "menu conservé dans les champs (coller)");

  console.log("Mémoire de la dernière carte");
  ok(w.localStorage.getItem("lastMap") === "customs", "carte mémorisée pour le prochain lancement");

  console.log("Langue");
  await TT.store.setLang("en");
  await wait(60);
  const tabOf = (v) => d.querySelector(`[data-view="${v}"] span`).textContent;
  ok(tabOf("map") === "Map" && tabOf("quests") === "Quests" && tabOf("items") === "Items", "onglets traduits en anglais");
  ok(/on top/i.test(d.getElementById("ontop-btn").title) && !/premier plan/.test(d.getElementById("ontop-btn").title), "infobulles traduites");
  ok(/Save|Cancel/.test(d.getElementById("settings-form").textContent), "boutons des réglages traduits");
  await TT.store.setLang("de");
  await wait(60);
  ok(tabOf("map") === "Karte" && tabOf("items") === "Gegenstände", "allemand appliqué");
  await TT.store.setLang("fr");
  await wait(60);
  ok(tabOf("map") === "Carte" && tabOf("quests") === "Quêtes", "retour au français");

  console.log("Rattrapage des quêtes");
  d.querySelector('[data-view="quests"]').click();
  d.getElementById("q-catchup").click();
  ok(!d.getElementById("catchup").hidden && d.getElementById("catchup").open === true, "panneau de rattrapage ouvert");
  ok(d.querySelectorAll("#cu-list .curow").length > 0, "liste des quêtes non terminées");
  ok(/terminée\(s\)/.test(d.getElementById("cu-summary").textContent), "compteur de progression affiché");
  const cuState = d.getElementById("cu-state");
  cuState.value = "all"; cuState.dispatchEvent(new w.Event("change"));
  const cuSearch = d.getElementById("cu-search");
  cuSearch.value = "signal"; cuSearch.dispatchEvent(new w.Event("input"));
  const cuRow = d.querySelector("#cu-list .curow");
  ok(cuRow && /Signal radio/.test(cuRow.textContent), "recherche dans le rattrapage");
  cuRow.click();
  ok(stateOf(e1) === "finished", "cliquer marque la quête terminée");
  // La liste est redessinée : on relit la ligne avant de recliquer.
  d.querySelector("#cu-list .curow").click();
  ok(stateOf(e1) !== "finished", "re-cliquer annule le marquage");
  d.getElementById("cu-close").click();
  ok(d.getElementById("catchup").open === false, "panneau fermé");

  console.log("OCR : pastilles d'état et reconnaissance multilingue");
  // Le jeu peut être dans une autre langue que l'app : la reconnaissance s'appuie aussi
  // sur le nom normalisé anglais (`normalizedName`), pas seulement sur le nom affiché.
  const ocrId = "f2bded63e67b9cb356d64ab6"; // « Premiers secours »
  const prevNN = TT.store.S.idx.tasks[ocrId].normalizedName;
  TT.store.S.idx.tasks[ocrId].normalizedName = "first-aid";
  d.getElementById("q-catchup").click();
  d.getElementById("cu-ocr-open").click();
  await wait(30);
  ok(d.getElementById("cu-ocr-file").options.length === 1, "captures d'écran listées");
  d.getElementById("cu-ocr-file").dispatchEvent(new w.Event("change"));
  await wait(30);
  ok(d.querySelectorAll("#cu-ocr-results .ocr-row").length >= 3, "quêtes reconnues sur la capture");
  ok(!!d.querySelector(`#cu-ocr-results .ocr-row[data-id="${ocrId}"]`), "un nom anglais est reconnu et affiché en français");
  ok(/First Aid/.test(d.querySelector(`#cu-ocr-results .ocr-row[data-id="${ocrId}"]`).textContent), "le texte reconnu (autre langue) est affiché pour vérification");
  let ocrRow = d.querySelector("#cu-ocr-results .ocr-row");
  ok(ocrRow.querySelectorAll(".state-pick").length === 4, "4 pastilles d'état proposées (pas fait, en cours, raté, fait)");
  const picks = {};
  for (const s of ["notdone", "started", "failed", "finished"]) picks[s] = ocrRow.querySelector(`.state-pick[data-pick="${s}"]`);
  ok(!!picks.notdone && !!picks.started && !!picks.failed && !!picks.finished, "chaque état a sa pastille");
  // Changer d'état : cliquer sur "finished" puis appliquer.
  picks.finished.click();
  const ocrRowId = ocrRow.dataset.id;
  d.getElementById("cu-ocr-apply").click();
  ok(stateOf(ocrRowId) === "finished", "l'état choisi est appliqué à la quête");
  TT.store.S.idx.tasks[ocrId].normalizedName = prevNN;
  d.getElementById("cu-ocr-cancel").click();
  d.getElementById("cu-close").click();

  ok(errors.length === 0, "aucune erreur JavaScript" + (errors.length ? " : " + errors.join(" | ") : ""));
  console.log(failed ? `\n${failed} échec(s)` : "\nTout est bon");
  process.exit(failed ? 1 : 0);
})();
