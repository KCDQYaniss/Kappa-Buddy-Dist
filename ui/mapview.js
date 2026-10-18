"use strict";
// Vue carte : position joueur, suivi, calques de données, quêtes actives, recherche d'objets.
(function () {
  const TT = (window.TT = window.TT || {});
  const { esc, slugOf } = TT.store;
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => TT.i18n.t(k, p);

  const COL = {
    pmc: "#8fbf5a", scav: "#e0a23a", shared: "#d8d4c0", transit: "#6fb7c9",
    spawnPmc: "#5b9bd5", spawnScav: "#cc7a4a", container: "#c7b07a", loose: "#4fb0b8",
    quest: "#f2b13a", hl: "#ff5a3c", stationary: "#a98fd0",
    lock: "#5a9b5e", lockPower: "#c08a2a",
  };
  const LAYERS = [
    { key: "extracts", label: "map.layer.extracts", color: COL.pmc, hint: "map.layer.extracts.tip" },
    { key: "locks", label: "map.layer.locks", color: COL.lock, hint: "map.layer.locks.tip" },
    { key: "transits", label: "map.layer.transits", color: COL.transit, hint: "map.layer.transits.tip" },
    { key: "spawns", label: "map.layer.spawns", color: COL.spawnPmc, hint: "map.layer.spawns.tip" },
    { key: "containers", label: "map.layer.containers", color: COL.container, hint: "map.layer.containers.tip" },
    { key: "loose", label: "map.layer.loose", color: COL.loose, hint: "map.layer.loose.tip" },
    { key: "stationary", label: "map.layer.stationary", color: COL.stationary, hint: "map.layer.stationary.tip" },
    { key: "quests", label: "map.layer.quests", color: COL.quest, hint: "map.layer.quests.tip" },
    { key: "customPoints", label: "map.layer.custom", color: "#cc7a4a", hint: "map.layer.custom.tip" },
  ];
  const store = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };

  let calibs = [], bySlug = {};
  let cur = null;                  // carte affichée
  let lastPos = null;
  let detectedSlug = null;
  let manualSlug = "auto";                 // « auto » = on suit la map détectée dans les logs (jamais mémorisé entre deux lancements)
  let follow = localStorage.getItem("follow") !== "off";          // suivi du joueur : activé par défaut
  let mapBright = localStorage.getItem("mapBright") === "on";     // carte éclaircie (les cartes sont sombres)
  const layerOn = Object.assign({ extracts: true, locks: true, transits: true, quests: true, questsAvail: true, customPoints: true }, store("layers", {}));
  const offTypes = new Set(store("offTypes", []));
  const offLockTypes = new Set(store("offLockTypes", []));   // verrous masqués par type : door | trunk
  const offFactions = new Set(store("offFactions", []));   // extractions masquées par faction : pmc | scav | shared (coop)
  const offSides = new Set(store("offSides", []));         // apparitions masquées : pmc | scav
  const hiddenQuests = new Set(store("hiddenQuests", []));   // quêtes masquées sur la carte (tu ne fais pas tout dans la même partie)
  const foldedQuests = new Set(store("foldedQuests", []));   // quêtes repliées dans la barre latérale
  // Objets surlignés sur la carte : on peut en suivre plusieurs à la fois, chacun avec sa couleur.
  const HL_COLORS = ["#ff5a3c", "#4fb0b8", "#f2b13a", "#a98fd0", "#5b9bd5", "#8fbf5a", "#e0a23a", "#6fb7c9"];
  const hlItems = [];              // [{ id, name, count, bounds, color }]
  let focusTask = null;            // quête dont on isole les objectifs
  // Points personnalisés par l'utilisateur : [{ map, x, y, z, name, text, key, iconType, iconUrl }]
  const USER_POINTS = loadCustomPoints();
  const CUSTOM_ICONS = [
    { type: "app", label: "icône app", color: "#8fbf5a" },
    { type: "marker", label: "marque", color: "#5b9bd5" },
    { type: "star", label: "étoile", color: "#f2b13a" },
    { type: "circle", label: "cercle", color: "#ff5a3c" },
    { type: "square", label: "carré", color: "#4fb0b8" },
    { type: "custom", label: "image locale", color: "#6fb7c9" },
  ];

  function loadCustomPoints() {
    try {
      const list = JSON.parse(localStorage.getItem("customPoints") || "[]");
      if (!Array.isArray(list)) return [];
      // Certaines versions passées ont pu enregistrer des points incomplets : on ne garde
      // que ceux dont les coordonnées sont exploitables (sinon Leaflet plante au rendu).
      return list.map((p) => {
        if (!p || typeof p !== "object") return null;
        const x = Number(p.x), y = Number(p.y);
        if (!isFinite(x) || !isFinite(y)) return null;
        return Object.assign({}, p, { x, y, z: isFinite(Number(p.z)) ? Number(p.z) : 0 });
      }).filter(Boolean);
    } catch { return []; }
  }
  function saveCustomPoints() {
    try { localStorage.setItem("customPoints", JSON.stringify(USER_POINTS)); } catch { }
  }
  function addCustomPoint(p) {
    USER_POINTS.push(p);
    saveCustomPoints();
  }

  /* ---------- Carte Leaflet ---------- */
  function buildCrs(cal) {
    return L.extend({}, L.CRS.Simple, {
      transformation: new L.Transformation(cal.scaleX, cal.marginX, cal.scaleY, cal.marginY),
      projection: L.extend({}, L.Projection.LonLat, {
        project: (ll) => { const r = Geo.rotate(ll.lng, ll.lat, cal.rotation); return L.point(r.lng, r.lat); },
        unproject: (p) => { const r = Geo.rotate(p.x, p.y, -cal.rotation); return L.latLng(r.lat, r.lng); },
      }),
    });
  }
  const ll = (p) => L.latLng(p.z, p.x); // convention tarkov.dev : [z, x]

  function showMap(slug) {
    const def = bySlug[slug];
    if (!def) return;
    if (cur && cur.slug === slug) return;
    if (cur) cur.lf.remove();

    const cal = Geo.makeCalibration(def);
    const imageBounds = L.latLngBounds(...Geo.imageBoundsLatLng(def));
    const lf = L.map("map", {
      crs: buildCrs(cal), minZoom: def.minZoom, maxZoom: def.maxZoom + 1, zoomSnap: 0.25,
      attributionControl: false, zoomControl: false, maxBounds: imageBounds.pad(0.6), maxBoundsViscosity: 0.6, preferCanvas: true,
      contextmenu: true, // Enable right-click on map
    });
    // Right-click handler for custom points
    // Use Leaflet's contextmenu event which provides latlng directly.
    lf.on("contextmenu", (e) => {
      try {
        const latlng = e.latlng;
        if (!latlng || isNaN(latlng.lng) || isNaN(latlng.lat)) return;
        const pt = { x: latlng.lng, y: latlng.lat, z: 0, map: slug };
        const evt = e.originalEvent || { clientX: 0, clientY: 0 };
        showContextMenu(evt, [
          { label: t("map.customAdd"), icon: "+", action: () => showCustomPointDialog(pt) },
        ]);
      } catch (err) { console.error("contextmenu error:", err); }
    });
    L.control.zoom({ position: "bottomright", zoomInTitle: t("map.zoomIn"), zoomOutTitle: t("map.zoomOut") }).addTo(lf);
    cur = {
      slug, def, cal, lf, imageBounds, groups: {}, marker: null, questGroup: null, hlGroup: null, questEntries: [],
      tip: L.tooltip({ direction: "top", offset: [0, -4], className: "tt-tip" }), needsFit: false,
      baseLayer: null, floorLayer: null, floorIndex: 0, floorAuto: true,
    };
    document.querySelector(".map-view").classList.toggle("map-bright", mapBright);
    setFloorLayer(0);
    if ($("map").clientWidth > 0) lf.fitBounds(imageBounds); else cur.needsFit = true;
    $("map-select").value = manualSlug;
    focusTask = null;   // les objets surlignés restent : on peut les comparer d'une carte à l'autre
    if (lastPos && slug === resolveSlug()) placeMarker(lastPos, false);
    syncLayers(); renderSidebar(); renderFloors(); refreshEmpty();
  }

  /* ---------- Étages (Interchange, Customs, Factory, Réserve, Labs…) ---------- */
  /** Source visuelle d'un étage (`{ image }` ou `{ tiles }`). L'étage 0 est le rez-de-chaussée. */
  function floorSource(i) {
    const def = cur.def, fl = def.floors;
    return fl && fl[i] ? fl[i] : { image: def.image, tiles: def.tiles, tileSize: def.tileSize };
  }
  function makeFloorLayer(f, opacity) {
    if (f.image) return L.imageOverlay(f.image, cur.imageBounds, { opacity });
    if (f.tiles) return L.tileLayer(f.tiles, { tileSize: f.tileSize || cur.def.tileSize || 256, bounds: cur.imageBounds, noWrap: true, minZoom: cur.def.minZoom, maxZoom: cur.def.maxZoom, opacity });
    return null;
  }
  /**
   * Affiche l'étage `i`. Le rez-de-chaussée reste toujours dessiné en dessous, en transparence, pour
   * se repérer quand on regarde un étage supérieur (le terrain reste visible sous les bâtiments).
   */
  function setFloorLayer(i) {
    if (!cur) return;
    const fl = cur.def.floors;
    const idx = fl && fl[i] ? i : 0;
    // Le rez-de-chaussée, monté une seule fois, reste à l'arrière-plan.
    if (!cur.baseLayer) {
      cur.baseLayer = makeFloorLayer(floorSource(0), 1);
      if (cur.baseLayer) cur.baseLayer.addTo(cur.lf);
    }
    if (cur.floorLayer) { cur.lf.removeLayer(cur.floorLayer); cur.floorLayer = null; }
    if (idx !== 0) {
      cur.floorLayer = makeFloorLayer(floorSource(idx), 1);
      if (cur.floorLayer) cur.floorLayer.addTo(cur.lf);
      if (cur.baseLayer && cur.baseLayer.setOpacity) cur.baseLayer.setOpacity(0.32);
    } else if (cur.baseLayer && cur.baseLayer.setOpacity) {
      cur.baseLayer.setOpacity(1);   // au rez-de-chaussée, on l'affiche pleinement
    }
    // Ordre d'empilement : rez-de-chaussée tout derrière, puis l'étage choisi, puis le reste
    // (contours, quêtes, marqueurs). bringToBack place l'élément en premier dans son calque.
    if (cur.floorLayer && cur.floorLayer.bringToBack) cur.floorLayer.bringToBack();
    if (cur.baseLayer && cur.baseLayer.bringToBack) cur.baseLayer.bringToBack();
    cur.floorIndex = idx;
    updateFloorOpacity();
    renderFloors();
  }
  /**
   * Étage deviné d'après la hauteur du joueur. On retient l'étage qui contient cette hauteur et
   * dont le plancher est le plus haut (le plus précis), sinon le niveau souterrain qui la contient.
   * Si le joueur est au-dessus de tous les étages (montagne), on garde le dernier étage ayant un ymax raisonnable.
   * FIX: on commence à i=1 (ground floor n'a pas de ylim, c'est la fallback par défaut).
   * Si aucune correspondance n'est trouvée, on retourne 0 (ground floor) au lieu de -1
   * pour éviter d'afficher arbitrairement un étage supérieur.
   */
  function pickFloor(y) {
    const fl = (cur && cur.def.floors) || [];
    if (!fl.length) return 0;
    let best = -1, bestMin = -Infinity, bottom = -1, bottomMax = -Infinity;
    let highestFloor = -1, highestFloorYmax = -Infinity;
    
    for (let i = 1; i < fl.length; i++) {
      const r = fl[i].ylim;
      if (!r) continue;
      
      // Garder le dernier étage avec un ymax raisonnable (pour les montagnes)
      if (r[1] < 10000) {
        highestFloor = i;
        highestFloorYmax = r[1];
      }
      
      // Le joueur est dans cet étage
      if (y >= r[0] && y <= r[1]) {
        if (r[0] > -999) { if (r[0] > bestMin) { bestMin = r[0]; best = i; } }
        else if (r[1] > bottomMax) { bottomMax = r[1]; bottom = i; }
      }
    }
    
    // Si le joueur est au-dessus de tout (montagne), retourner le dernier étage valide
    if (best < 0 && bottom < 0 && highestFloor >= 0 && y > highestFloorYmax) {
      return highestFloor;
    }
    
    // FIX: fallback sur ground floor (0) au lieu de -1. Ground floor est le
    // "catch-all" pour le rez-de-chaussée et positions non couvertes par les intervalles.
    return best >= 0 ? best : (bottom >= 0 ? bottom : 0);
  }
  function applyAutoFloor(y) {
    if (!cur || !cur.def.floors || !cur.floorAuto) return;
    const idx = pickFloor(y);
    const target = idx >= 0 ? idx : 0;
    if (target !== cur.floorIndex) setFloorLayer(target);
  }
  function renderFloors() {
    const bar = $("floor-bar");
    if (!bar) return;
    const fl = (cur && cur.def.floors) || [];
    if (fl.length < 2) { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML = fl.map((f, i) => `<button type="button" class="fbtn${i === cur.floorIndex ? " on" : ""}" data-floor="${i}" title="${esc(f.name)}">${esc(f.name)}</button>`).join("") +
      `<button type="button" class="fauto${cur.floorAuto ? " on" : ""}" data-floor-auto="1" title="${t("map.floor.auto")}">${t("map.floor.autoShort")}</button>`;
  }

  const markerIcon = () => {
    const size = 18;
    return L.divIcon({
      className: "mpin", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
      html: `<div class="player"><span class="pulse"></span><svg viewBox="0 0 44 44" aria-hidden="true"><g class="arrow">
        <path d="M22 5 L33 36 L22 29 L11 36 Z" fill="#f2b13a" stroke="#0c0d0e" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="22" cy="22" r="14" fill="none" stroke="#4fb0b8" stroke-width="2" stroke-opacity="0.7"/>
      </g></svg></div>`,
    });
  };

  function placeMarker(p, announce) {
    if (!cur) return;
    const pt = ll(p);
    const heading = cur.cal.headingDeg(p.x, p.z, p.fx, p.fz);
    if (!cur.marker) cur.marker = L.marker(pt, { icon: markerIcon(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(cur.lf);
    else cur.marker.setLatLng(pt);
    const el = cur.marker.getElement();
    el.querySelector(".arrow").setAttribute("transform", `rotate(${heading.toFixed(1)} 22 22)`);
    if (announce) {
      const box = el.querySelector(".player");
      box.classList.remove("fresh"); void box.offsetWidth; box.classList.add("fresh");
    }
    // Suivi : on recentre à chaque nouvelle position. Désactivé = la carte ne bouge jamais toute seule.
    if (follow) cur.lf.panTo(pt, { animate: announce, duration: 0.45 });
  }

  function centerOnPlayer() {
    if (cur && cur.marker) cur.lf.panTo(cur.marker.getLatLng(), { animate: true });
  }

  /* ---------- Calques ---------- */
  const dot = (pt, color, r, extra) => L.circleMarker(pt, Object.assign({ radius: r, color: "#0c0d0e", weight: 1, fillColor: color, fillOpacity: 0.95 }, extra || {}));

  /* ---------- Icônes des points ---------- */
  // Chaque type de point a sa silhouette, dessinée en SVG puis teintée par la couleur du
  // calque : lisible sur les fonds clairs comme sombres des cartes, sans images externes.
  const SHAPES = {
    extract: "M4 2.5h8v2H6.5v15H4zM13 7.5l4.5 4.5L13 16.5v-3.2H8.5v-2.6H13z",
    transit: "M2.5 10.7h12.3l-3.9-3.9 1.7-1.7 6.4 6.4-6.4 6.4-1.7-1.7 3.9-3.9H2.5z",
    spawnPmc: "M12 2.2a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2zM12 11c4.1 0 7 2 7 5v2.3H5V16c0-3 2.9-5 7-5z",
    spawnScav: "M12 2.2 9 8.4l-6.8.9 5 4.8-1.3 6.7L12 17.6l6.1 3.2-1.3-6.7 5-4.8-6.8-.9z",
    container: "M12 2.6 21 6v12l-9 3.4L3 18V6zM12 4.9 6 7.1v9.4l6 2.2 6-2.2V7.1zM9 9.6h6v2.2H9zm0 4h6v2.2H9z",
    stationary: "M12 1.8v3.4M12 18.8v3.4M1.8 12h3.4M18.8 12h3.4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
    quest: "M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z",
    lock: "M8 10.5V8a4 4 0 0 1 8 0v2.5h-2V8a2 2 0 1 0-4 0v2.5zM6.5 10.5h11A1.5 1.5 0 0 1 19 12v7.5A1.5 1.5 0 0 1 17.5 21h-11A1.5 1.5 0 0 1 5 19.5V12a1.5 1.5 0 0 1 1.5-1.5z",
  };
  /** Marqueur ponctuel en forme d'icône (extraction, conteneur…), teinté par `color`. */
  /** Marqueur teinté ; floorY (optionnel) = hauteur y pour transparence d'étage. */
  function pin(pt, shape, color, size, extra, floorY) {
    const s = size || 18;
    const html = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" style="color:${color}">` +
      `<path fill="currentColor" stroke="#0c0d0e" stroke-width="1.1" paint-order="stroke" d="${SHAPES[shape]}"/></svg>`;
    const m = L.marker(pt, Object.assign({
      icon: L.divIcon({ className: "mpin", html, iconSize: [s, s], iconAnchor: [s / 2, s / 2] }),
      interactive: true, keyboard: false,
    }, extra || {}));
    if (floorY != null) m._floorY = floorY;
    return m;
  }
  function tip(layer, html) {
    layer.on("mouseover", (e) => { cur.tip.setLatLng(e.latlng).setContent(html); cur.lf.openTooltip(cur.tip); });
    layer.on("mouseout", () => cur && cur.lf.closeTooltip(cur.tip));
  }
  /** Infobulle affichée au clic sur une extraction : faction, interrupteur, type de sortie. */
  function extractPopup(e, FAC) {
    const faction = FAC[e.faction] || e.faction || t("map.extract.all");
    let h = `<div class="ex"><b>${esc(e.name || t("map.layer.extracts"))}</b>` +
      `<div class="ex-row"><span>${esc(t("map.extract.open"))}</span><b>${esc(faction)}</b></div>`;
    if (e.switches && e.switches.length) h += `<div class="ex-row"><span>${esc(t("map.extract.switch"))}</span><b>${e.switches.map(esc).join(", ")}</b></div>`;
    h += `<div class="ex-hint">${esc(t("map.extract.hint"))}</div></div>`;
    return h;
  }
  /**
   * Infobulle d'un verrou : de quel type il est, quelle clé il faut, si tu l'as déjà,
   * et où trouver cette clé (bouton vers sa fiche objet).
   */
  function lockPopup(lock) {
    const key = lock.key || null;
    const have = key && key.id ? TT.store.itemCount(key.id) : 0;
    const type = lock.lockType === "trunk" ? t("map.lock.trunk") : t("map.lock.door");
    let h = `<div class="ex lk"><b>${esc(type)}</b>`;
    if (key && key.name) {
      h += `<div class="ex-row"><span>${esc(t("map.lock.key"))}</span><b>${esc(key.name)}</b></div>` +
        `<div class="ex-row"><span>${esc(t("map.lock.have", { n: have }))}</span><b class="${have ? "lk-ok" : "lk-bad"}">${have ? "✔" : esc(t("map.lock.missing"))}</b></div>`;
    } else {
      h += `<div class="ex-row"><span>${esc(t("map.lock.noKey"))}</span></div>`;
    }
    if (lock.needsPower) h += `<div class="ex-row"><span>${esc(t("map.lock.power"))}</span><b>⚡</b></div>`;
    if (key && (key.id || key.name)) h += `<div class="ex-hint">${esc(t("map.lock.hint"))}</div>`;
    if (key && key.id) h += `<button class="btn sm lk-open" data-key="${esc(key.id)}" type="button">${esc(t("map.lock.locate"))}</button>`;
    return h + `</div>`;
  }
  const mapData = () => { const i = TT.store.S.idx; return i && i.maps[cur.slug]; };
  const itemName = (id) => { const it = TT.store.S.idx.items[id]; return it ? it.name : t("map.itemUnknown"); };
  const itemList = (items) => {
    const names = (items || []).map((i) => esc(itemName(i.id)));
    return names.slice(0, 6).join("<br>") + (names.length > 6 ? `<br>+${names.length - 6} ${t("map.itemOthers")}` : "");
  };

  /** Côtés concernés par une apparition : { pmc, scav }. Sans info, on considère les deux. */
  const spawnSides = (s) => {
    const sd = s.sides || [];
    const both = !sd.length || sd.includes("all");
    return { pmc: both || sd.includes("pmc"), scav: both || sd.includes("scav") };
  };

  const builders = {
    extracts(md) {
      const g = L.layerGroup();
      const FAC = { pmc: t("map.extract.pmc"), scav: t("map.extract.scav"), shared: t("map.extract.all") };
      for (const e of md.extracts) {
        if (offFactions.has(e.faction || "shared")) continue; // faction masquée par le filtre
        const c = COL[e.faction] || COL.shared;
        if (e.outline && e.outline.length > 2) L.polygon(e.outline.map(ll), { color: c, weight: 1, fillOpacity: 0.12, interactive: false }).addTo(g);
        const d = pin(ll(e.position), "extract", c, 18, {}, e.position.y).addTo(g);
        d.bindTooltip(esc(e.name || t("map.layer.extracts")), { permanent: true, direction: "right", offset: [8, 0], className: "tt-label" });
        d.bindPopup(extractPopup(e, FAC));
      }
      return g;
    },
    transits(md) {
      const g = L.layerGroup();
      for (const t_ of md.transits) {
        const d = pin(ll(t_.position), "transit", COL.transit, 16, {}, t_.position.y).addTo(g);
        tip(d, `<b>${esc(t("map.layer.transits"))}</b><br>${esc(t_.description || "")}`);
      }
      return g;
    },
    /** Portes et coffres fermés à clé : clic = quelle clé utiliser, et si tu l'as. */
    locks(md) {
      const g = L.layerGroup();
      for (const l of md.locks || []) {
        if (offLockTypes.has(l.lockType || "door")) continue;
        const c = l.needsPower ? COL.lockPower : (l.lockType === "trunk" ? COL.container : COL.lock);
        const d = pin(ll(l.position), "lock", c, 15, {}, l.position.y).addTo(g);
        const type = l.lockType === "trunk" ? t("map.lock.trunk") : t("map.lock.door");
        tip(d, `<b>${esc(t("map.lock.title"))} — ${esc(type)}</b>` + (l.key && l.key.name ? `<br>${esc(l.key.name)}` : "") + (l.needsPower ? " ⚡" : ""));
        d.bindPopup(() => lockPopup(l));
        d.on("popupopen", (ev) => {
          const el = ev.popup.getElement();
          const btn = el && el.querySelector(".lk-open");
          if (btn) btn.addEventListener("click", () => {
            TT.nav.show("items");
            if (TT.items) TT.items.select(btn.dataset.key);
          });
        });
      }
      return g;
    },
    spawns(md) {
      const g = L.layerGroup();
      for (const s_ of md.spawns) {
        const sides = spawnSides(s_);
        // Masquée si toutes les factions concernées sont décochées.
        if ((!sides.pmc || offSides.has("pmc")) && (!sides.scav || offSides.has("scav"))) continue;
        const sc = sides.scav && !sides.pmc;
        const d = pin(ll(s_.position), sc ? "spawnScav" : "spawnPmc", sc ? COL.spawnScav : COL.spawnPmc, 15, {}, s_.position.y).addTo(g);
        tip(d, `<b>${esc(t("map.layer.spawns"))} ${sc ? "Scav" : "PMC"}</b><br>${esc((s_.categories || []).join(", "))}`);
      }
      return g;
    },
    loose(md) {
      const g = L.layerGroup();
      for (const l of md.loose) tip(dot(ll(l.position), COL.loose, 2.5, { weight: 0.5 }).addTo(g), itemList(l.items) || t("map.layer.loose"));
      return g;
    },
    stationary(md) {
      const g = L.layerGroup();
      for (const w of md.stationary) tip(pin(ll(w.position), "stationary", COL.stationary, 16, {}, w.position.y).addTo(g), esc((w.stationaryWeapon && w.stationaryWeapon.name) || t("map.layer.stationary")));
      return g;
    },
    /** Points utilisateur (icônes personnalisables avec popup). */
    customPoints(md) {
      const g = L.layerGroup();
      for (const p of USER_POINTS) {
        if (p.map !== cur.slug) continue;
        if (!isFinite(p.x) || !isFinite(p.y)) continue; // ignore les points corrompus
        const pt = ll({ z: p.y, x: p.x }); // p.y = game z (lat), p.x = game x (lng)
        const iconHtml = p.iconType === "custom" && p.iconUrl ? `<img src="${p.iconUrl}" class="custom-img" alt="">` : "";
        const marker = L.marker(pt, {
          icon: L.divIcon({
            className: "custom-point",
            html: `<div class="cp-btn ${p.iconType || "marker"}" style="--c:${p.color || "#ff5a3c"}"><i class="cp-dot"></i>${iconHtml}</div>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
          }),
          interactive: true,
          keyboard: false,
          bubblingMouseEvents: false, // le clic droit reste sur le point, il ne remonte pas au fond de carte
        }).addTo(g);
        // Popup avec le nom, texte, clé et bouton modifier
        const popup = `<div class="cpp-popup">
          <div class="cpp-header"><b>${esc(p.name || t("map.customPoint"))}</b></div>
          <div class="cpp-text">${esc(p.text || "")}</div>
          ${p.key ? `<div class="cpp-row"><span>${t("map.customKey")} :</span> <b>${esc(p.key)}</b></div>` : ""}
          ${p.iconType === "custom" && p.iconUrl ? `<div class="cpp-img"><img src="${p.iconUrl}" alt="custom icon"></div>` : ""}
        </div>`;
        marker.bindPopup(popup);
        // Clic droit sur le point : on écoute directement l'élément de l'icône. C'est le seul moyen
        // fiable — passer par l'évènement Leaflet fait aussi réagir le fond de carte, dont le menu
        // « ajouter » remplacerait celui-ci.
        marker.on("add", () => {
          const el = marker.getElement();
          if (!el) return;
          el.addEventListener("contextmenu", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (!layerOn.customPoints) return;
            showContextMenu(ev, [
              { label: t("map.customEdit"), icon: "✎", action: () => showCustomPointDialog(p) },
              { label: t("map.customDelete"), icon: "🗑", danger: true, action: () => deleteCustomPoint(p) },
            ]);
          });
        });
      }
      return g;
    },
  };
  /** Conteneurs de la carte groupés par type : id stable -> { name, list } (nom lisible du backend). */
  function containerTypes(md) {
    const out = {};
    for (const c of md.containers) {
      const lc = c.lootContainer || {};
      const id = lc.id || "unknown";
      const e = out[id] || (out[id] = { name: lc.name || id, list: [] });
      e.list.push(c);
    }
    return out;
  }

  function setGroup(key, on, build) {
    const have = cur.groups[key];
    if (on) {
      const g = build();
      cur.groups[key] = g;
      if (have && cur.lf.hasLayer(have)) cur.lf.removeLayer(have);
      g.addTo(cur.lf);
    }
    else if (have && cur.lf.hasLayer(have)) cur.lf.removeLayer(have);
  }

  function syncLayers() {
    if (!cur) return;
    const md = mapData();
    if (md) {
      for (const k of ["extracts", "locks", "transits", "spawns", "loose", "stationary"]) {
        try { setGroup(k, !!layerOn[k], () => builders[k](md)); }
        catch (err) { console.error("calque " + k + " :", err); }
      }
      const types = containerTypes(md);
      for (const [id, type] of Object.entries(types)) {
        try {
          setGroup("c:" + id, !!layerOn.containers && !offTypes.has(id), () => {
            const g = L.layerGroup();
            for (const c of type.list) tip(pin(ll(c.position), "container", COL.container, 14, {}, c.position.y).addTo(g), esc(type.name));
            return g;
          });
        } catch (err) { console.error("conteneurs " + id + " :", err); }
      }
    }
    // Les points personnalisés ne dépendent pas des données de la carte : on les reconstruit
    // toujours, même si les données ne sont pas encore téléchargées.
    try { setGroup("customPoints", !!layerOn.customPoints, () => builders.customPoints(md)); }
    catch (err) { console.error("points personnalisés :", err); }
    drawQuests();
    drawHighlight();
    // Les points de surbrillance et de quêtes passent au-dessus.
    [cur.hlGroup, cur.questGroup].forEach((g) => g && g.eachLayer && g.eachLayer((l) => l.bringToFront && l.bringToFront()));
    // Right-click handler is set up in showMap() via lf.on("contextmenu")
  }

  /* ---------- Transparence par étage ---------- */
  /** Les marqueurs dont la hauteur y sort du ylim de l'étage courant sont assomnis. */
  function updateFloorOpacity() {
    if (!cur || !cur.def.floors || cur.def.floors.length < 2) return;
    const fl = cur.def.floors[cur.floorIndex];
    const range = fl && fl.ylim;
    const inRange = (y) => !range || (y >= range[0] && y <= range[1]);
    Object.values(cur.groups).forEach((g) => {
      if (!g || !g.eachLayer) return;
      g.eachLayer((layer) => {
        if (layer._floorY != null) { layer.setOpacity(inRange(layer._floorY) ? 1 : 0.35); }
      });
    });
  }

  /* ---------- Objectifs de quêtes ---------- */
  function questEntries() {
    const st = TT.store, idx = st.S.idx, prog = st.S.progress;
    if (!idx || !cur) return [];
    
    const out = [];
    // Parcourir toutes les tâches dans l'index
    for (const t of Object.values(idx.tasks)) {
      // Skip quests not yet known from logs (not in progression or inferred)...
      // ...EXCEPT when the user explicitly focused a quest via "show on map" —
      // that quest must be included even if never started, so the click-to-focus
      // feature actually works for quests you haven't begun yet.
      if (!prog.tasks[t.id] && !prog.inferred[t.id] && focusTask !== t.id) continue;
      const taskState = st.stateOf(t);
      for (const o of (t.objectives || [])) {
        if (st.S.progress.objectives[o.id]) continue; // objectif déjà complété
        const maps = (o.maps || []).map((m) => slugOf(m.normalizedName));
        const zonesHere = (o.zones || []).filter((z) => z.map && slugOf(z.map.normalizedName) === cur.slug);
        const locsHere = (o.possibleLocations || []).filter((l) => l.map && slugOf(l.map.normalizedName) === cur.slug);
        const itemIds = [...(o.items || []), ...(o.useAny || [])].map((i) => i.id);
        const looseHere = itemIds.length && (!maps.length || maps.includes(cur.slug)) ? itemIds : [];
        const extractHere = o.type === "extract" && o.exitName && maps.includes(cur.slug);
        // L'objectif est affiché s'il concerne la carte courante
        if (zonesHere.length || locsHere.length || looseHere.length || extractHere || maps.includes(cur.slug)) {
          out.push({ task: t, obj: o, zonesHere, locsHere, looseIds: looseHere, state: taskState });
        }
      }
    }
    return out;
  }

  function drawQuests() {
    if (cur.questGroup) { cur.lf.removeLayer(cur.questGroup); cur.questGroup = null; }
    cur.questEntries = layerOn.quests || focusTask ? questEntries() : [];
    // questsAvail = "Ne montrer que les quêtes disponibles" (défaut ON)
    // When ON, hide finished/failed quests. When OFF, show all known quests.
    const onlyAvail = layerOn.questsAvail;
    const shown = cur.questEntries.filter((e) => {
      if (focusTask && focusTask !== e.task.id) return false;
      if (hiddenQuests.has(e.task.id)) return false;
      if (onlyAvail && (e.state === "finished" || e.state === "failed")) return false;
      return true;
    });
    if (!shown.length) return;
    const md = mapData();
    const g = (cur.questGroup = L.layerGroup().addTo(cur.lf));
    for (const e of shown) {
      const pts = [];
      const html = `<b>${esc(e.task.name)}</b><br>${esc(e.obj.description)}`;
      for (const z of e.zonesHere) {
        if (z.outline && z.outline.length > 2) {
          const poly = L.polygon(z.outline.map(ll), { color: COL.quest, weight: 2, fillOpacity: 0.18 }).addTo(g);
          tip(poly, html); pts.push(...z.outline.map(ll));
        } else if (z.position) {
          tip(pin(ll(z.position), "quest", COL.quest, 18, {}, z.position.y).addTo(g), html); pts.push(ll(z.position));
        }
      }
      for (const l of e.locsHere) for (const p of l.positions || []) {
        tip(pin(ll(p), "quest", COL.quest, 15).addTo(g), html); pts.push(ll(p));
      }
      if (md && e.looseIds.length) {
        const ids = new Set(e.looseIds);
        for (const l of md.loose) if ((l.items || []).some((i) => ids.has(i.id))) {
          tip(dot(ll(l.position), COL.quest, 4, { weight: 1 }).addTo(g), html + "<br>" + itemList(l.items)); pts.push(ll(l.position));
        }
      }
      if (md && e.obj.type === "extract" && e.obj.exitName) {
        const x = md.extracts.find((m) => (m.name || "").toLowerCase() === e.obj.exitName.toLowerCase());
        if (x) { tip(pin(ll(x.position), "extract", COL.quest, 20).addTo(g), html); pts.push(ll(x.position)); }
      }
      e.bounds = pts.length ? L.latLngBounds(pts) : null;
    }
  }

  function drawHighlight() {
    if (cur.hlGroup) { cur.lf.removeLayer(cur.hlGroup); cur.hlGroup = null; }
    const md = mapData();
    for (const h of hlItems) { h.count = 0; h.bounds = null; }
    if (!md || !hlItems.length) return;
    const g = (cur.hlGroup = L.layerGroup().addTo(cur.lf));
    for (const h of hlItems) {
      const pts = [];
      for (const l of md.loose) if ((l.items || []).some((i) => i.id === h.id)) {
        const p = ll(l.position); pts.push(p);
        tip(dot(p, h.color, 7, { weight: 2, fillOpacity: 0.3, color: h.color }).addTo(g), `<b>${esc(h.name)}</b><br>${itemList(l.items)}`);
      }
      h.count = pts.length;
      h.bounds = pts.length ? L.latLngBounds(pts) : null;
    }
  }

  /* ---------- Barre latérale ---------- */
  /** Une entrée par quête (case « afficher sur la carte », nom, nombre d'objectifs), ses objectifs en simple liste dessous. */
  function questsSectionHtml() {
    const groups = [], byId = new Map();
    cur.questEntries.forEach((e, i) => {
      let g = byId.get(e.task.id);
      if (!g) { g = { task: e.task, items: [] }; byId.set(e.task.id, g); groups.push(g); }
      g.items.push({ e, i });
    });
    let h = `<section class="sec"><h3>${esc(t("map.questsHere"))}${groups.length ? ` <em class="cnt">${groups.length}</em>` : ""}` +
      (groups.length > 1 ? `<span class="h3acts"><button data-act="qshowall" type="button">${esc(t("map.questsAll"))}</button><button data-act="qhideall" type="button">${esc(t("map.questsNone"))}</button></span>` : "") + "</h3>";
    if (focusTask) h += `<div class="pill">${esc(t("map.quest.focus"))} <button class="x" data-act="clear-focus" type="button" aria-label="${esc(t("map.quest.showAll"))}">×</button></div>`;
    if (!groups.length) h += `<p class="dim">${esc(t("map.quest.none"))}</p>`;
    for (const g of groups) {
      const id = esc(g.task.id), off = hiddenQuests.has(g.task.id) && !focusTask, folded = foldedQuests.has(g.task.id);
      const state = g.items[0]?.e?.state || "started";
      const lockReason = TT.store.lockReason(g.task);
      const lockedLabel = state === "locked" && lockReason ? `<span class="st-locked-label">${t("q.locked")}</span>` : "";
      h += `<div class="qgroup${off ? " off" : ""} st-${state}${folded ? " closed" : ""}">` +
        `<div class="qghead"><label class="chk" title="${esc(t("map.quest.onMap"))}"><input type="checkbox" data-qshow="${id}"${off ? "" : " checked"}></label>` +
        `<button class="qgname" data-qzoom="${id}" type="button" title="${esc(t("map.quest.zoom"))}">${esc(g.task.name)} ${lockedLabel}</button>` +
        `<em class="cnt">${g.items.length}</em><button class="qgfold" data-qfold="${id}" type="button" aria-label="${esc(folded ? t("map.quest.expand") : t("map.quest.collapse"))}" aria-expanded="${!folded}"><i></i></button></div>` +
        `<ul class="qobjs">` + g.items.map(({ e, i }) => `<li><button class="qobj" data-qe="${i}" type="button">${esc(e.obj.description)}</button>` +
          `<button class="qdone" data-qdone="${esc(e.obj.id)}" type="button" title="${esc(t("map.quest.done"))}" aria-label="${esc(t("map.quest.done"))}">✓</button></li>`).join("") + "</ul></div>";
    }
    return h + "</section>";
  }

  function renderSidebar() {
    const el = $("map-side");
    const S = TT.store.S;
    if (!cur) { el.innerHTML = ""; return; }
    if (!S.idx || !mapData()) {
      el.innerHTML = `<section class="sec"><h3>${esc(t("map.data"))}</h3><p class="dim">${S.idx ? esc(t("map.noDataForMap")) : esc(TT.store.emptyMessage())}</p>` +
        `<button class="btn" data-act="refresh" type="button">${esc(t("map.download"))}</button></section>`;
      return;
    }
    const md = mapData();
    const types = containerTypes(md);
    const counts = { extracts: md.extracts.length, locks: (md.locks || []).length, transits: md.transits.length, spawns: md.spawns.length, containers: md.containers.length, loose: md.loose.length, stationary: md.stationary.length, quests: cur.questEntries.length };
    let h = `<section class="sec"><h3>${esc(t("map.layers"))}</h3>`;
    for (const L_ of LAYERS) {
      h += `<label class="chk" title="${esc(L_.hint ? t(L_.hint) : "")}"><input type="checkbox" data-layer="${L_.key}"${layerOn[L_.key] ? " checked" : ""}><i class="sw" style="--c:${L_.color}"></i><span>${esc(t(L_.label))}</span><em>${counts[L_.key]}</em></label>`;
      if (L_.key === "containers" && layerOn.containers && Object.keys(types).length) {
        h += '<div class="sub">';
        for (const [id, type] of Object.entries(types).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
          h += `<label class="chk small"><input type="checkbox" data-ctype="${esc(id)}"${offTypes.has(id) ? "" : " checked"}><span>${esc(type.name)}</span><em>${type.list.length}</em></label>`;
        }
        h += "</div>";
      }
      if (L_.key === "locks" && layerOn.locks && (md.locks || []).length) {
        const rows = [
          { lt: "door", n: md.locks.filter((l) => (l.lockType || "door") === "door").length, c: COL.lock, k: "map.lock.door" },
          { lt: "trunk", n: md.locks.filter((l) => l.lockType === "trunk").length, c: COL.container, k: "map.lock.trunk" },
        ].filter((r) => r.n);
        const pw = md.locks.filter((l) => l.needsPower).length;
        if (rows.length) {
          h += "<div class=\"sub\">";
          for (const r of rows) h += `<label class="chk small"><input type="checkbox" data-locktype="${r.lt}"${offLockTypes.has(r.lt) ? "" : " checked"}><i class="sw" style="--c:${r.c}"></i><span>${esc(t(r.k))}</span><em>${r.n}</em></label>`;
          if (pw) h += `<span class="dim" style="padding-left:6px" title="${esc(t("map.lock.power"))}">⚡ ${pw}</span>`;
          h += "</div>";
        }
      }
      if (L_.key === "extracts" && layerOn.extracts) {
        const facs = [
          { f: "pmc", n: md.extracts.filter((e) => (e.faction || "shared") === "pmc").length, c: COL.pmc, k: "map.fac.pmc" },
          { f: "scav", n: md.extracts.filter((e) => (e.faction || "shared") === "scav").length, c: COL.scav, k: "map.fac.scav" },
          { f: "shared", n: md.extracts.filter((e) => (e.faction || "shared") === "shared").length, c: COL.shared, k: "map.fac.coop" },
        ].filter((r) => r.n);
        if (facs.length) {
          h += `<div class="sub" title="${esc(t("map.fac.tip"))}">`;
          for (const r of facs) h += `<label class="chk small"><input type="checkbox" data-faction="${r.f}"${offFactions.has(r.f) ? "" : " checked"}><i class="sw" style="--c:${r.c}"></i><span>${esc(t(r.k))}</span><em>${r.n}</em></label>`;
          h += "</div>";
        }
      }
      if (L_.key === "spawns" && layerOn.spawns) {
        const rows = [
          { s: "pmc", n: md.spawns.filter((x) => spawnSides(x).pmc).length, c: COL.spawnPmc },
          { s: "scav", n: md.spawns.filter((x) => spawnSides(x).scav).length, c: COL.spawnScav },
        ].filter((r) => r.n);
        if (rows.length) {
          h += `<div class="sub" title="${esc(t("map.fac.tip"))}">`;
          for (const r of rows) h += `<label class="chk small"><input type="checkbox" data-side="${r.s}"${offSides.has(r.s) ? "" : " checked"}><i class="sw" style="--c:${r.c}"></i><span>${esc(t("map.fac." + r.s))}</span><em>${r.n}</em></label>`;
          h += "</div>";
        }
      }
    }
    h += `<label class="chk small" title="${esc(t("map.layer.avail.tip"))}"><input type="checkbox" data-layer="questsAvail"${layerOn.questsAvail ? " checked" : ""}><span>${esc(t("map.layer.avail"))}</span></label></section>`;

    h += `<section class="sec"><h3>${esc(t("map.search"))}</h3><input id="hl-input" class="txt" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t("map.search.ph"))}"><ul id="hl-sugg" class="sugg" hidden></ul>`;
    if (hlItems.length) {
      for (const it of hlItems) {
        h += `<div class="pill" style="--c:${it.color}"><i class="pd"></i><span class="pn">${esc(it.name)}</span>` +
          `<em class="pc">${it.count || 0}</em>` +
          `<button class="x" data-act="rm-hl" data-hl="${esc(it.id)}" type="button" aria-label="${esc(t("map.clear"))}">×</button></div>`;
      }
      if (hlItems.length > 1) h += `<button class="btn sm hlack" data-act="clear-hl" type="button">${esc(t("map.hl.clearAll"))}</button>`;
    }
    h += "</section>";

    h += `<section class="sec"><h3>${esc(t("map.customPoints"))}</h3>`;
    const mapPoints = USER_POINTS.filter(p => p.map === cur.slug);
    if (mapPoints.length) {
      for (const p of mapPoints) {
        const color = p.color || "#ff5a3c";
        const name = p.name || t("map.customPoint");
        h += `<div class="custom-point-item" style="color:${color}">
          <span class="cp-name">${esc(name)}</span>
          ${p.key ? `<span class="cp-key">${esc(p.key)}</span>` : ""}
        </div>`;
      }
    } else {
      h += `<span class="dim" style="padding:4px 0; display: block">${t("map.mapRightClick")}</span>`;
    }
    h += `</section>`;

    h += questsSectionHtml();

    if (md.bosses && md.bosses.length) {
      h += `<section class="sec"><h3>${esc(t("map.boss"))}</h3>`;
      for (const b of md.bosses) h += `<div class="boss"><span>${esc(b.boss.name)}</span><em>${Math.round((b.spawnChance || 0) * 100)} %</em></div>`;
      h += "</section>";
    }
    h += `<section class="sec info"><span>${md.players ? esc(t("map.players", { n: md.players })) : ""}</span><span>${md.raidDuration ? esc(t("map.raidMin", { n: md.raidDuration })) : ""}</span></section>`;
    el.innerHTML = h;
  }

  function onSideEvent(e) {
    const t = e.target;
    if (t.dataset && t.dataset.layer) { layerOn[t.dataset.layer] = t.checked; save("layers", layerOn); syncLayers(); renderSidebar(); }
    else if (t.dataset && t.dataset.qshow) {
      t.checked ? hiddenQuests.delete(t.dataset.qshow) : hiddenQuests.add(t.dataset.qshow);
      save("hiddenQuests", [...hiddenQuests]); syncLayers(); renderSidebar();
    }
    else if (t.dataset && t.dataset.ctype) { t.checked ? offTypes.delete(t.dataset.ctype) : offTypes.add(t.dataset.ctype); save("offTypes", [...offTypes]); syncLayers(); }
    else if (t.dataset && t.dataset.locktype) { t.checked ? offLockTypes.delete(t.dataset.locktype) : offLockTypes.add(t.dataset.locktype); save("offLockTypes", [...offLockTypes]); syncLayers(); }
    else if (t.dataset && t.dataset.faction) { t.checked ? offFactions.delete(t.dataset.faction) : offFactions.add(t.dataset.faction); save("offFactions", [...offFactions]); syncLayers(); }
    else if (t.dataset && t.dataset.side) { t.checked ? offSides.delete(t.dataset.side) : offSides.add(t.dataset.side); save("offSides", [...offSides]); syncLayers(); }
  }
  function onSideClick(e) {
    const b = e.target.closest("[data-act],[data-qe],[data-sugg],[data-qzoom],[data-qfold],[data-qdone],[data-cp]");
    if (!b) return;
    if (b.dataset.act === "refresh") TT.store.refresh();
    else if (b.dataset.act === "rm-hl") removeHighlight(b.dataset.hl);
    else if (b.dataset.act === "clear-hl") { hlItems.length = 0; syncLayers(); renderSidebar(); }
    else if (b.dataset.act === "clear-focus") { focusTask = null; syncLayers(); renderSidebar(); }
    else if (b.dataset.act === "qshowall" || b.dataset.act === "qhideall") {
      const all = b.dataset.act === "qshowall";
      cur.questEntries.forEach((en) => (all ? hiddenQuests.delete(en.task.id) : hiddenQuests.add(en.task.id)));
      save("hiddenQuests", [...hiddenQuests]); syncLayers(); renderSidebar();
    }
    else if (b.dataset.qfold) {
      foldedQuests.has(b.dataset.qfold) ? foldedQuests.delete(b.dataset.qfold) : foldedQuests.add(b.dataset.qfold);
      save("foldedQuests", [...foldedQuests]); renderSidebar();
    }
    else if (b.dataset.qdone) { TT.store.toggleObjective(b.dataset.qdone); syncLayers(); renderSidebar(); }
    else if (b.dataset.qzoom) zoomQuest(b.dataset.qzoom);
    else if (b.dataset.qe != null) {
      const en = cur.questEntries[+b.dataset.qe];
      if (en && en.bounds) cur.lf.fitBounds(en.bounds.pad(0.6), { maxZoom: cur.def.maxZoom - 1 });
    } else if (b.dataset.sugg) highlightItem(b.dataset.sugg);
  }
  /** Zoome sur l'ensemble des objectifs d'une quête (la réaffiche d'abord si elle était masquée). */
  function zoomQuest(tid) {
    if (hiddenQuests.has(tid)) { hiddenQuests.delete(tid); save("hiddenQuests", [...hiddenQuests]); syncLayers(); renderSidebar(); }
    const bs = cur.questEntries.filter((e) => e.task.id === tid && e.bounds).map((e) => e.bounds);
    if (!bs.length) return;
    const u = bs.reduce((a, c) => a.extend(c), L.latLngBounds(bs[0].getSouthWest(), bs[0].getNorthEast()));
    cur.lf.fitBounds(u.pad(0.5), { maxZoom: cur.def.maxZoom - 1 });
  }
  function onSideInput(e) {
    if (e.target.id !== "hl-input") return;
    const box = $("hl-sugg"), q = e.target.value.trim().toLowerCase();
    const idx = TT.store.S.idx;
    if (q.length < 2) { box.hidden = true; return; }
    const here = Object.keys(idx.lootByItem).filter((id) => idx.lootByItem[id][cur.slug] && idx.items[id]);
    const res = here.map((id) => idx.items[id]).filter((it) => (it.name || "").toLowerCase().includes(q) || (it.shortName || "").toLowerCase().includes(q)).slice(0, 8);
    box.innerHTML = res.length ? res.map((it) => `<li><button type="button" data-sugg="${esc(it.id)}">${esc(it.name)} <em>${idx.lootByItem[it.id][cur.slug]}</em></button></li>`).join("") : `<li class="dim">${t("map.noResult")}</li>`;
    box.hidden = false;
  }

  /* ---------- Actions publiques ---------- */
  /** Retire un objet de la liste des surlignés. */
  function removeHighlight(id) {
    const i = hlItems.findIndex((x) => x.id === id);
    if (i >= 0) hlItems.splice(i, 1);
    syncLayers(); renderSidebar();
  }
  /** Ajoute un objet aux surlignés (sans écraser les précédents) et cadre ses emplacements. */
  function highlightItem(id) {
    const it = TT.store.S.idx && TT.store.S.idx.items[id];
    if (!it || !cur) return;
    let h = hlItems.find((x) => x.id === id);
    if (!h) {
      // Une couleur par objet, jamais deux fois la même tant qu'il reste de la place.
      const used = new Set(hlItems.map((x) => x.color));
      const color = HL_COLORS.find((c) => !used.has(c)) || HL_COLORS[0];
      if (hlItems.length >= HL_COLORS.length) hlItems.shift();
      h = { id, name: it.name, count: 0, bounds: null, color };
      hlItems.push(h);
    }
    drawHighlight(); renderSidebar();
    if (h.bounds) cur.lf.fitBounds(h.bounds.pad(0.4), { maxZoom: cur.def.maxZoom - 1 });
  }
  /** Affiche la carte qui contient le plus d'emplacements de l'objet, avec surbrillance. */
  function locateItem(id, wanted) {
    const idx = TT.store.S.idx; if (!idx) return false;
    const where = idx.lootByItem[id] || {};
    const slug = wanted || (where[cur && cur.slug] ? cur.slug : Object.keys(where).sort((a, b) => where[b] - where[a])[0]);
    if (!slug || !bySlug[slug]) return false;
    showSlug(slug);
    highlightItem(id);
    return true;
  }
  function focusTaskOnMap(id) {
    const st = TT.store, t = st.S.idx && st.S.idx.tasks[id];
    if (!t) return false;
    const slugs = new Set();
    if (t.map) slugs.add(slugOf(t.map.normalizedName));
    for (const o of t.objectives || []) {
      (o.maps || []).forEach((m) => slugs.add(slugOf(m.normalizedName)));
      (o.zones || []).forEach((z) => z.map && slugs.add(slugOf(z.map.normalizedName)));
    }
    const slug = [...slugs].find((s) => bySlug[s]);
    if (!slug) return false;
    showSlug(slug);
    focusTask = id;
    hiddenQuests.delete(id); save("hiddenQuests", [...hiddenQuests]);
    syncLayers(); renderSidebar();
    const b = cur.questEntries.map((e) => e.bounds).filter(Boolean);
    if (b.length) cur.lf.fitBounds(b.reduce((a, c) => a.extend(c), L.latLngBounds(b[0].getSouthWest(), b[0].getNorthEast())).pad(0.5), { maxZoom: cur.def.maxZoom - 1 });
    return true;
  }
  /** Affiche une carte sans changer de mode : si on est en automatique, le prochain raid reprend la main. */
  function showSlug(slug) {
    showMap(slug); updateChip(); refreshEmpty();
  }
  function setFollow(on) {
    follow = on; localStorage.setItem("follow", on ? "on" : "off");
    const b = $("follow-btn");
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("span").textContent = on ? t("map.follow.on") : t("map.follow.off");
    if (on) centerOnPlayer();
  }
  function onShow() {
    if (!cur) return;
    cur.lf.invalidateSize();
    if (cur.needsFit) { cur.lf.fitBounds(cur.imageBounds); cur.needsFit = false; }
  }

  /* ---------- Évènements du jeu ---------- */
  function resolveSlug() { return manualSlug !== "auto" ? manualSlug : detectedSlug; }
  /** Mémorise la carte affichée : au prochain lancement, on rouvre sur elle si aucun raid n'est détecté. */
  function rememberMap(slug) { if (slug && bySlug[slug]) { try { localStorage.setItem("lastMap", slug); } catch (_) {} } }
  function onPosition(p) {
    lastPos = p;
    const time = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    $("r-time").textContent = t("map.capture", { time });
    $("r-xyz").textContent = `x ${p.x.toFixed(1)}  ·  y ${p.y.toFixed(1)}  ·  z ${p.z.toFixed(1)}`;
    $("readout").hidden = false;
    if (!cur) { const s = resolveSlug(); if (s) showMap(s); }
    // Si on regarde une autre carte que celle du raid (ex. depuis une quête), on n'y pose pas le marqueur.
    if (cur && cur.slug === resolveSlug()) placeMarker(p, true);
    applyAutoFloor(p.y);
    updateChip(); refreshEmpty();
  }
  function onMap(m) {
    detectedSlug = m.slug && bySlug[m.slug] ? m.slug : null;
    if (!detectedSlug) TT.warn(t("map.unknown", { raw: m.raw }));
    else rememberMap(detectedSlug);
    if (manualSlug === "auto" && detectedSlug) {
      lastPos = null; $("readout").hidden = true;      // nouvelle map = nouveau raid
      if (cur && cur.marker) { cur.marker.remove(); cur.marker = null; }
      showMap(detectedSlug);
    }
    updateChip(); refreshEmpty();
  }
  function updateChip() {
    const chip = $("map-source");
    const name = (sl) => (bySlug[sl] ? bySlug[sl].name : sl);
    let text, act = "", warn = false;
    if (manualSlug !== "auto") { text = t("map.selected"); act = "auto"; }
    else if (detectedSlug && cur && cur.slug !== detectedSlug) { text = t("map.detectedBack", { name: name(detectedSlug) }); act = "raid"; }
    else if (detectedSlug) text = t("map.detected");
    else if (TT.logsOk === false) { text = t("map.noLogs"); act = "settings"; warn = true; }
    else text = t("map.waiting");
    chip.hidden = false; chip.textContent = text; chip.dataset.act = act;
    chip.className = "chip" + (warn ? " warn" : "");
    chip.disabled = !act;
  }
  function onChip() {
    const act = $("map-source").dataset.act;
    if (act === "auto") { setAuto(); }
    else if (act === "raid") { showMap(detectedSlug); updateChip(); refreshEmpty(); }
    else if (act === "settings") TT.openSettings && TT.openSettings(true);
  }
  function setAuto() {
    manualSlug = "auto"; $("map-select").value = "auto";
    const slug = resolveSlug();
    if (slug) showMap(slug);
    updateChip(); refreshEmpty();
  }

  /* ---------- Points personnalisés (clic droit) ---------- */
  let contextMenu = null; // Menu contextuel affiché
  let cpEditing = null; // Point personnalisé en cours d'édition

  /** Supprime un point personnalisé. */
  function deleteCustomPoint(p) {
    const idx = USER_POINTS.indexOf(p);
    if (idx >= 0) { USER_POINTS.splice(idx, 1); saveCustomPoints(); syncLayers(); renderSidebar(); }
  }

  /** Ouvre le dialogue de création/édition d'un point personnalisé. */
  function showCustomPointDialog(p) {
    if (!cur) return;
    cpEditing = p ? findPoint(p.map, p.x, p.y) : null;
    const pt = cpEditing || { map: cur.slug, x: p.x, y: p.y, z: p.z || 0 };
    const html = `
      <div class="custom-point-modal">
        <h4>${cpEditing ? t("map.customEdit") : t("map.customAdd")}</h4>
        <label>${t("map.customName")} : <input id="cp-name" class="txt" type="text" value="${esc(pt.name || "")}" placeholder="${t("map.customName.ph")}"></label>
        <label>${t("map.customText")} : <textarea id="cp-text" class="txt" rows="2" placeholder="${t("map.customText.ph")}">${esc(pt.text || "")}</textarea></label>
        <label>${t("map.customKey")} : 
          <input id="cp-key" class="txt" type="text" list="keys-list" placeholder="${t("map.customKey.ph")}" value="${esc(pt.key || "")}">
          <datalist id="keys-list">${Object.values(TT.store.S.idx?.items || {}).filter(i => i.name).map(i => `<option value="${i.name}"></option>`).join("")}</datalist>
        </label>
        <label>${t("map.customIcon")} : 
          <select id="cp-icon">${CUSTOM_ICONS.map(ic => `<option value="${ic.type}" ${pt.iconType === ic.type ? "selected" : ""}>${ic.label}</option>`).join("")}</select>
          <input id="cp-img-url" class="txt" type="url" placeholder="${t("map.customIconImg.ph")}" value="${esc(pt.iconUrl || "")}"></label>
        <div class="cp-pos">${t("map.customPos", { x: pt.x, y: pt.y })}</div>
        <div class="cp-ctr"><button id="cp-ok" class="btn primary">${cpEditing ? t("map.customSave") : t("map.customAdd")}</button><button id="cp-cancel" class="btn">${t("map.cancel")}</button></div>
      </div>`;
    const dlg = document.createElement("dialog");
    dlg.className = "custom-point-dialog";
    dlg.innerHTML = `<div class="modal-overlay"><form method="dialog">${html}</form></div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    $("cp-ok").onclick = (e) => {
      e.preventDefault();
      const name = $("cp-name").value.trim() || null;
      const text = $("cp-text").value.trim() || null;
      const key = $("cp-key").value.trim() || null;
      const iconType = $("cp-icon").value;
      const iconUrl = iconType === "custom" ? $("cp-img-url").value.trim() || null : null;
      if (cpEditing) {
        Object.assign(cpEditing, { name, text, key, iconType, iconUrl, color: CUSTOM_ICONS.find(i => i.type === iconType)?.color || "#ff5a3c" });
      } else {
        USER_POINTS.push({ map: pt.map, x: pt.x, y: pt.y, z: pt.z, name, text, key, iconType, iconUrl, color: CUSTOM_ICONS.find(i => i.type === iconType)?.color || "#ff5a3c" });
      }
      saveCustomPoints();
      dlg.close();
      dlg.remove();
      cpEditing = null;
      syncLayers();
      renderSidebar(); // la liste des points de la barre latérale suit immédiatement
    };
    $("cp-cancel").onclick = () => { dlg.close(); dlg.remove(); cpEditing = null; };
  }

  /** Trouve un point personnalisé par map/x/y. */
  function findPoint(map, x, y) {
    return USER_POINTS.find(p => p.map === map && Math.round(p.x * 1000) === Math.round(x * 1000) && Math.round(p.y * 1000) === Math.round(y * 1000));
  }

  /** Affiche le menu contextuel (clic droit). */
  function showContextMenu(e, items) {
    if (contextMenu) hideContextMenu();
    e.preventDefault();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-item";
      if (item.icon) btn.innerHTML = `<i class="cm-icon">${item.icon}</i> ${item.label}`;
      else btn.textContent = item.label;
      if (item.danger) btn.classList.add("danger");
      btn.onclick = () => { hideContextMenu(); item.action?.(); };
      menu.appendChild(btn);
    }
    document.body.appendChild(menu);
    contextMenu = menu;
    setTimeout(() => { if (contextMenu) contextMenu.classList.add("show"); }, 10);
  }

  /** Cache le menu contextuel. */
  function hideContextMenu() {
    if (contextMenu) {
      contextMenu.classList.remove("show");
      contextMenu.remove();
      contextMenu = null;
    }
  }

  /* ---------- Initialisation ---------- */
  function init(defs) {
    calibs = defs.map((d) => Geo.makeCalibration(d));
    bySlug = {};
    for (const d of defs) bySlug[d.slug] = d;
    const sel = $("map-select");
    if (sel) {
      sel.innerHTML = `<option value="auto">${t("map.auto")}</option>` + defs.map((d) => `<option value="${d.slug}">${esc(d.name)}</option>`).join("");
      sel.value = manualSlug;
      sel.addEventListener("change", () => {
        const val = sel.value;
        if (val === "auto") { setAuto(); }
        else { manualSlug = val; showMap(val); updateChip(); refreshEmpty(); }
      });
    }
    updateChip(); refreshEmpty();
  }

  // Fermer le menu contextuel en cliquant ailleurs
  document.addEventListener("click", hideContextMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideContextMenu(); });

  function refreshEmpty() {
    const el = $("empty");
    if (!el) return;
    el.hidden = !!lastPos;
    if (!lastPos) {
      const slug = resolveSlug();
      el.querySelector("#empty-text").textContent = slug ? bySlug[slug]?.name || slug : t("map.waiting");
    }
  }

  /* ---------- Event listeners ---------- */
  const side = $("map-side");
  if (side) {
    side.addEventListener("change", onSideEvent);
    side.addEventListener("click", onSideClick);
    side.addEventListener("input", onSideInput);
  }
  const floorBar = $("floor-bar");
  if (floorBar) floorBar.addEventListener("click", (e) => {
    const b = e.target.closest("[data-floor],[data-floor-auto]");
    if (!b || !cur) return;
    if (b.dataset.floorAuto) { cur.floorAuto = true; if (lastPos) applyAutoFloor(lastPos.y); else renderFloors(); }
    else { cur.floorAuto = false; setFloorLayer(+b.dataset.floor); }
  });
  $("map-source").addEventListener("click", onChip);
  $("center-btn").addEventListener("click", centerOnPlayer);
  $("map-bright-btn").addEventListener("click", () => {
    mapBright = !mapBright;
    localStorage.setItem("mapBright", mapBright ? "on" : "off");
    const b = $("map-bright-btn");
    b.setAttribute("aria-pressed", String(mapBright));
    document.querySelector(".map-view").classList.toggle("map-bright", mapBright);
  });
  $("map-bright-btn").setAttribute("aria-pressed", String(mapBright));
  $("follow-btn").addEventListener("click", () => setFollow(!follow));

  // La progression peut changer en dehors de la carte (logs du jeu, rattrapage, OCR) :
  // on redessine alors les objectifs et la barre latérale. Les rafales d'évènements sont
  // regroupées en une seule micro-tâche pour ne pas reconstruire les calques cent fois.
  let progressQueued = false;
  const queueMicro = typeof queueMicrotask === "function" ? queueMicrotask : (fn) => setTimeout(fn, 0);
  TT.store.on((k) => {
    if (k !== "progress" && k !== "data") return;
    if (progressQueued) return;
    progressQueued = true;
    queueMicro(() => {
      progressQueued = false;
      if (!cur) return;
      syncLayers();
      renderSidebar();
    });
  });

  /* ---------- Export ---------- */
  function refresh() {
    if (!cur) return;
    renderSidebar(); renderFloors(); updateChip(); refreshEmpty();
  }

  TT.mapview = { init, updateChip, setAuto, onPosition, onMap, showSlug, highlightItem, locateItem, focusTaskOnMap, setFollow, onShow, resolveSlug, refresh, isFollowing: () => follow, current: () => cur };
  TT.i18n.onChange(refresh);
})();
