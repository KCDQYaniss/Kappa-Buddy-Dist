// Vue tactique : fond de carte 100 % maison, généré depuis les positions de jeu
// (json.tarkov.dev). Aucun asset tarkov-dev : ce rendu est possédé par l'app,
// il lève la restriction CC BY-NC-SA des cartes communauté.
//
// Principe : le SVG est dessiné dans LE MÊME espace pixel que les images
// communauté (calibration MIT appliquée via Geo.gamePixel), puis posé en
// imageOverlay sur les mêmes bounds — marqueurs, étages et rotation du CRS
// restent donc parfaitement alignés. Les textes sont contre-rotatés pour
// rester lisibles à l'écran.
//
// Contenu du fond : grille métrique, densité de loot (les clusters dessinent
// le bâti), apparitions, étiquettes de zones (noms venant de la donnée),
// polygones de dangers (champs de mines…), échelle et boussole. Les extractions,
// verrous et autres calques interactifs restent des marqueurs par-dessus.
(function (root) {
  "use strict";

  // Palette par thème (mêmes familles que ui/style.css).
  const PALETTES = {
    dark: { bg: "#0b0f0d", grid: "#1d2b23", gridText: "#3d5a4a", text: "#9ab8a8", container: "#5b8dd6", loose: "#7ddc8f", spawn: "#4a6fa5", hazard: "#ff5a4a", boss: "#c9a0ff", accent: "#e8e4d0" },
    light: { bg: "#e9ede2", grid: "#c9cebd", gridText: "#8a9284", text: "#42503f", container: "#3a6ea5", loose: "#2e7d4f", spawn: "#6b8cb8", hazard: "#c0392b", boss: "#7d4ba0", accent: "#2c3328" },
    cyberpunk: { bg: "#04040f", grid: "#191932", gridText: "#4a4a7a", text: "#8f8fd0", container: "#00d1ff", loose: "#00ffcc", spawn: "#5a5a9e", hazard: "#ff4a75", boss: "#ff9af5", accent: "#f0f0ff" },
  };

  // Mots de zones les plus fréquents (noms internes BSG → libellé traduit).
  // Un mot inconnu passe tel quel : le nom reste compréhensible.
  const ZONE_WORDS = {
    dormitory: ["Dortoir", "Dormitory", "Schlafsaal", "Dormitorio", "Общежитие"],
    gasstation: ["Station-service", "Gas station", "Tankstelle", "Gasolinera", "Заправка"],
    gas: ["Essence", "Gas", "Tankstelle", "Gasolina", "Заправка"],
    station: ["Station", "Station", "Station", "Estación", "Станция"],
    factory: ["Usine", "Factory", "Fabrik", "Fábrica", "Завод"],
    customs: ["Douane", "Customs", "Zoll", "Aduana", "Таможня"],
    tunnel: ["Tunnel", "Tunnel", "Tunnel", "Túnel", "Тоннель"],
    bridge: ["Pont", "Bridge", "Brücke", "Puente", "Мост"],
    checkpoint: ["Poste", "Checkpoint", "Kontrollpunkt", "Puesto", "КПП"],
    warehouse: ["Entrepôt", "Warehouse", "Lagerhaus", "Almacén", "Склад"],
    construction: ["Chantier", "Construction", "Baustelle", "Obra", "Стройка"],
    military: ["Militaire", "Military", "Militär", "Militar", "Военная"],
    base: ["Base", "Base", "Basis", "Base", "База"],
    camp: ["Campement", "Camp", "Lager", "Campamento", "Лагерь"],
    village: ["Village", "Village", "Dorf", "Pueblo", "Деревня"],
    church: ["Église", "Church", "Kirche", "Iglesia", "Церковь"],
    resort: ["Station", "Resort", "Kurort", "Complejo", "Курорт"],
    pier: ["Quai", "Pier", "Anleger", "Muelle", "Пирс"],
    lighthouse: ["Phare", "Lighthouse", "Leuchtturm", "Faro", "Маяк"],
    radar: ["Radar", "Radar", "Radar", "Radar", "Радар"],
    bunker: ["Bunker", "Bunker", "Bunker", "Búnker", "Бункер"],
    town: ["Ville", "Town", "Stadt", "Ciudad", "Город"],
    center: ["Centre", "Center", "Zentrum", "Centro", "Центр"],
    north: ["Nord", "North", "Nord", "Norte", "Север"],
    south: ["Sud", "South", "Süd", "Sur", "Юг"],
    east: ["Est", "East", "Ost", "Este", "Восток"],
    west: ["Ouest", "West", "West", "Oeste", "Запад"],
    old: ["Vieux", "Old", "Alt", "Viejo", "Старая"],
    new: ["Nouveau", "New", "Neu", "Nuevo", "Новая"],
    main: ["Principal", "Main", "Haupt", "Principal", "Главная"],
    side: ["côté", "side", "Seite", "lado", "сторона"],
    power: ["Électricité", "Power", "Strom", "Energía", "Энергия"],
    office: ["Bureaux", "Offices", "Büros", "Oficinas", "Офисы"],
    hotel: ["Hôtel", "Hotel", "Hotel", "Hotel", "Отель"],
    mall: ["Centre commercial", "Mall", "Einkaufszentrum", "Centro comercial", "ТЦ"],
    port: ["Port", "Port", "Hafen", "Puerto", "Порт"],
    train: ["Train", "Train", "Zug", "Tren", "Поезд"],
    rail: ["Rail", "Rail", "Schiene", "Vía", "Рельса"],
    tank: ["Réservoir", "Tank", "Tank", "Tanque", "Резервуар"],
    fuel: ["Carburant", "Fuel", "Kraftstoff", "Combustible", "Топливо"],
    scav: ["Scav", "Scav", "Scav", "Scav", "Дикий"],
    crackhouse: ["Nid de dealer", "Crackhouse", "Crackhaus", "Narcolista", "Притон"],
    motel: ["Motel", "Motel", "Motel", "Motel", "Мотель"],
    health: ["Santé", "Health", "Gesundheit", "Salud", "Здоровье"],
    resortcenter: ["Centre de station", "Resort center", "Kurortzentrum", "Centro del complejo", "Центр курорта"],
  };
  const LANGS = ["fr", "en", "de", "es", "ru"];

  /** « ZoneDormitory » / « ZoneGasStation » → libellé traduit lisible.
      On tente d'abord le mot composé entier (GasStation), puis mot à mot. */
  function zoneLabel(zoneName, lang) {
    const li = Math.max(0, LANGS.indexOf(lang));
    const camel = String(zoneName || "").replace(/^Zone/i, "");
    const whole = ZONE_WORDS[camel.toLowerCase()];
    if (whole) return whole[li] || whole[1];
    const words = camel.replace(/([a-z])([A-Z])/g, "$1 $2").split(/[\s_]+/).filter(Boolean);
    const out = words.map((w) => {
      const row = ZONE_WORDS[w.toLowerCase()];
      return row ? row[li] || row[1] : w;
    });
    return out.join(" ");
  }

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&", "<": "<", ">": ">" }[c]));
  const n1 = (v) => (Math.round(v * 10) / 10).toString();

  const cache = new Map();   // "slug:floor:theme" → svg string

  /** Efface le cache (nouvelles données, changement de langue des libellés). */
  function invalidate() { cache.clear(); }

  /**
   * Génère le fond tactique d'un étage.
   * @param def      définition carte (ui/maps.json) : transform, rotation, bounds, floors
   * @param md       données de la carte (idx.maps[slug]) : containers, loose, spawns, hazards, bosses
   * @param floorIdx 0 = tout (vue sol), sinon filtré par floors[i].ylim
   * @param theme    "dark" | "light" | "cyberpunk"
   * @param lang     langue des libellés (défaut fr)
   * @returns string SVG (viewBox dans l'espace pixel de la calibration), ou "" si impossible
   */
  function build(def, md, floorIdx, theme, lang) {
    try {
      if (!def || !md) return "";
      const key = `${def.slug || def.name}:${floorIdx || 0}:${theme || "dark"}:${lang || "fr"}`;
      if (cache.has(key)) return cache.get(key);
      const P = PALETTES[theme] || PALETTES.dark;
      const cal = root.Geo && root.Geo.makeCalibration(def);
      if (!cal) return "";
      const svg = render(def, md, floorIdx || 0, P, cal, lang || "fr");
      cache.set(key, svg);
      return svg;
    } catch (e) {
      // Le fond tactique ne doit jamais casser la carte : repli silencieux.
      if (typeof console !== "undefined") console.error("[tactical]", e);
      return "";
    }
  }

  function ylimOf(def, floorIdx) {
    const fl = (def.floors || [])[floorIdx];
    return fl && fl.ylim ? fl.ylim : null;   // [min, max) — null = tout
  }

  function inFloor(p, ylim) {
    if (!ylim) return true;
    const y = Number(p.y) || 0;
    return y >= ylim[0] && y < ylim[1];
  }

  function render(def, md, floorIdx, P, cal, lang) {
    const b = def.svgBounds || def.bounds;
    if (!b) return "";
    const corners = [
      cal.gamePixel(b[0][0], b[0][1]), cal.gamePixel(b[1][0], b[0][1]),
      cal.gamePixel(b[0][0], b[1][1]), cal.gamePixel(b[1][0], b[1][1]),
    ];
    const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
    const vx = Math.min(...xs), vy = Math.min(...ys);
    const vw = Math.max(...xs) - vx, vh = Math.max(...ys) - vy;
    if (!(vw > 0 && vh > 0)) return "";
    const rot = cal.rotation || 0;
    const ylim = ylimOf(def, floorIdx);
    const s = [];

    s.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n1(vx)} ${n1(vy)} ${n1(vw)} ${n1(vh)}" width="${Math.round(vw)}" height="${Math.round(vh)}" preserveAspectRatio="none">`);
    s.push(`<rect x="${n1(vx)}" y="${n1(vy)}" width="${n1(vw)}" height="${n1(vh)}" fill="${P.bg}"/>`);

    // ---- Grille métrique (100 m en coordonnées jeu) ----
    const gx0 = Math.min(b[0][0], b[1][0]), gx1 = Math.max(b[0][0], b[1][0]);
    const gz0 = Math.min(b[0][1], b[1][1]), gz1 = Math.max(b[0][1], b[1][1]);
    for (let gx = Math.ceil(gx0 / 100) * 100; gx <= gx1; gx += 100) {
      const a = cal.gamePixel(gx, gz0), c = cal.gamePixel(gx, gz1);
      s.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(c.x)}" y2="${n1(c.y)}" stroke="${P.grid}" stroke-width="${gridW(vw)}"/>`);
    }
    for (let gz = Math.ceil(gz0 / 100) * 100; gz <= gz1; gz += 100) {
      const a = cal.gamePixel(gx0, gz), c = cal.gamePixel(gx1, gz);
      s.push(`<line x1="${n1(a.x)}" y1="${n1(a.y)}" x2="${n1(c.x)}" y2="${n1(c.y)}" stroke="${P.grid}" stroke-width="${gridW(vw)}"/>`);
    }

    // ---- Densité de loot : le bâti émerge des clusters ----
    const dot = (p, r, fill, op) => {
      const q = cal.gamePixel(p.x, p.z);
      s.push(`<circle cx="${n1(q.x)}" cy="${n1(q.y)}" r="${r}" fill="${fill}" fill-opacity="${op}"/>`);
    };
    for (const c of md.containers || []) if (inFloor(c.position, ylim)) dot(c.position, dotR(vw, 1.7), P.container, 0.3);
    for (const c of md.loose || []) if (inFloor(c.position, ylim)) dot(c.position, dotR(vw, 1.4), P.loose, 0.32);
    for (const sp of md.spawns || []) if (inFloor(sp.position, ylim)) dot(sp.position, dotR(vw, 1.1), P.spawn, 0.4);

    // ---- Dangers (polygones fournis par la donnée : champs de mines…) ----
    for (const h of md.hazards || []) {
      const outline = (h.outline || []).filter((p) => p && isFinite(p.x) && isFinite(p.z));
      if (outline.length < 3) continue;
      const pts = outline.map((p) => { const q = cal.gamePixel(p.x, p.z); return `${n1(q.x)},${n1(q.y)}`; }).join(" ");
      s.push(`<polygon points="${pts}" fill="${P.hazard}" fill-opacity="0.12" stroke="${P.hazard}" stroke-opacity="0.55" stroke-width="${gridW(vw)}"/>`);
    }

    // ---- Étiquettes de zones : noms venant des apparitions, répartis sans chevaucher ----
    const byZone = {};
    for (const sp of md.spawns || []) {
      if (!inFloor(sp.position, ylim) || !sp.zoneName) continue;
      (byZone[sp.zoneName] = byZone[sp.zoneName] || []).push(sp.position);
    }
    const fs = fontSize(vw, vh);
    const cand = Object.entries(byZone)
      .map(([zn, list]) => ({
        zn, n: list.length,
        x: list.reduce((a, p) => a + p.x, 0) / list.length,
        z: list.reduce((a, p) => a + p.z, 0) / list.length,
      }))
      .filter((c) => c.x >= gx0 && c.x <= gx1 && c.z >= gz0 && c.z <= gz1)
      .sort((a, b2) => b2.n - a.n);
    const placed = [];
    const minDist = fs * 3.2;
    for (const c of cand) {
      if (placed.length >= 42) break;
      const q = cal.gamePixel(c.x, c.z);
      if (placed.some((p) => Math.abs(p.x - q.x) < minDist && Math.abs(p.y - q.y) < minDist)) continue;
      placed.push(q);
      const label = zoneLabel(c.zn, lang);
      s.push(`<text x="${n1(q.x)}" y="${n1(q.y)}" fill="${P.text}" font-size="${n1(fs)}" text-anchor="middle" transform="rotate(${n1(-rot)} ${n1(q.x)} ${n1(q.y)})">${esc(label)}</text>`);
    }

    // ---- Zones de boss (noms des PNJ, position de la zone de spawn) ----
    const bfs = n1(fs * 0.92);
    for (const bo of md.bosses || []) {
      for (const loc of (bo.spawnLocations || [])) {
        const p = (loc.positions || [])[0];
        if (!p || !inFloor(p, ylim)) continue;
        const q = cal.gamePixel(p.x, p.z);
        s.push(`<text x="${n1(q.x)}" y="${n1(q.y)}" fill="${P.boss}" font-size="${bfs}" font-style="italic" text-anchor="middle" transform="rotate(${n1(-rot)} ${n1(q.x)} ${n1(q.y)})">${esc(bo.name || "")}</text>`);
      }
    }

    // ---- Échelle (100 m) + boussole ----
    const barLen = 100 * Math.abs(cal.scaleX);
    const bx = vx + vw * 0.03, by = vy + vh - vh * 0.03;
    s.push(`<line x1="${n1(bx)}" y1="${n1(by)}" x2="${n1(bx + barLen)}" y2="${n1(by)}" stroke="${P.accent}" stroke-width="${n1(fs * 0.28)}"/>`);
    s.push(`<text x="${n1(bx + barLen / 2)}" y="${n1(by - fs * 0.5)}" fill="${P.accent}" font-size="${n1(fs * 0.95)}" text-anchor="middle" transform="rotate(${n1(-rot)} ${n1(bx + barLen / 2)} ${n1(by - fs * 0.5)})">100 m</text>`);
    const cx = vx + vw - vw * 0.05, cy = vy + vh * 0.08;
    // Indicatif : la flèche reste stable à l'écran (contre-rotation) ; la convention
    // cardinale exacte (coordinateToCardinalRotation) reste à valider en jeu —
    // la flèche du joueur, elle, est déjà calibrée.
    s.push(`<g transform="translate(${n1(cx)} ${n1(cy)}) rotate(${n1(-rot)})">
      <path d="M 0 ${n1(-fs * 2.2)} L ${n1(fs * 0.7)} ${n1(fs * 0.9)} L 0 ${n1(fs * 0.35)} L ${n1(-fs * 0.7)} ${n1(fs * 0.9)} Z" fill="${P.accent}"/>
      <text x="0" y="${n1(-fs * 2.7)}" fill="${P.accent}" font-size="${n1(fs * 1.1)}" font-weight="700" text-anchor="middle">N</text></g>`);

    s.push("</svg>");
    return s.join("");
  }

  // Épaisseurs/tailles adaptées à la taille du viewBox (les cartes n'ont pas
  // toutes la même échelle pixel : Customs ~256 unités, Factory ~200…).
  function gridW(vw) { return Math.max(0.12, vw / 1400); }
  function dotR(vw, base) { return Math.max(0.7, (vw / 900) * base); }
  function fontSize(vw, vh) { return Math.max(2.6, Math.min(vw, vh) / 62); }

  const api = { build, invalidate, zoneLabel, PALETTES };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.TT = root.TT || {};
    root.TT.tactical = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
