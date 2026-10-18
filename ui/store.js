"use strict";
// Données du jeu (cache disque via Tauri), progression des quêtes, synchronisation avec les logs, index de recherche.
(function () {
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : null;
  const TT = (window.TT = window.TT || {});

  // L'API sépare parfois des variantes d'une même carte : on les fusionne sur la carte de base.
  const ALIAS = { "ground-zero-21": "ground-zero", "night-factory": "factory" };
  const slugOf = (s) => ALIAS[s] || s;
  const TRADER_ORDER = ["prapor", "therapist", "skier", "peacekeeper", "mechanic", "ragman", "jaeger", "ref", "lightkeeper"];
  const STATUSES = new Set(["started", "finished", "failed"]);
  const ITEM_TYPES = new Set(["findItem", "giveItem", "plantItem", "useItem", "mark", "buildWeapon"]);

  const freshProgress = () => ({ v: 2, tasks: {}, at: {}, inferred: {}, objectives: {}, level: null, activity: [], hideout: {} });
  /** Compteur d'objets possédés (id -> quantité). Partagé par l'inventaire, le hideout et les verrous. */
  function loadCounts() {
    try { const v = JSON.parse(localStorage.getItem("itemCounts") || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
  }
  const S = {
    lang: localStorage.getItem("lang") || "fr",
    mode: localStorage.getItem("mode") || "PvP",
    data: null, idx: null,
    progress: freshProgress(),
    counts: loadCounts(),
    sync: { lastAt: 0, events: 0, files: null, sessions: null, changed: 0, inferred: 0, error: "", busy: false },
    busy: "", error: "", retryAt: 0,
  };
  const listeners = new Set();
  const emit = (kind) => listeners.forEach((f) => { try { f(kind); } catch (e) { console.error(e); } });
  const notify = (text, kind) => TT.notify && TT.notify(text, kind);
  /** Traduction (chargée par i18n.js, résolue à l'appel). */
  const t = (k, p) => TT.i18n.t(k, p);

  /* ---------- Utilitaires ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Formatage local : séparateurs de milliers et de date selon la langue choisie.
  const LOCALE = { fr: "fr-FR", en: "en-GB", de: "de-DE", es: "es-ES", ru: "ru-RU" };
  const localeOf = () => LOCALE[TT.i18n ? TT.i18n.current() : "fr"] || "fr-FR";
  const fmtPrice = (n) => (n == null ? "—" : n.toLocaleString(localeOf()) + " ₽");
  function ago(ts) {
    if (!ts) return t("misc.never");
    const m = Math.max(0, Math.round((Date.now() / 1000 - ts) / 60));
    if (m < 2) return t("misc.ago.now");
    if (m < 90) return t("misc.ago.min", { n: m });
    const h = Math.round(m / 60);
    if (h < 48) return t("misc.ago.h", { n: h });
    return t("misc.ago.d", { n: Math.round(h / 24) });
  }
  const agoMs = (ms) => (ms ? ago(ms / 1000) : t("misc.never"));
  const hhmm = (ms) => new Date(ms).toLocaleTimeString(localeOf(), { hour: "2-digit", minute: "2-digit" });

  /* ---------- Index ---------- */
  function buildIndex(data) {
    const idx = { items: {}, tasks: {}, traders: [], maps: {}, lootByItem: {}, usage: {}, categories: [] };
    for (const it of data.items || []) idx.items[it.id] = it;

    const traders = {};
    for (const t of data.tasks || []) {
      idx.tasks[t.id] = t;
      if (t.trader) traders[t.trader.normalizedName] = t.trader;
      for (const o of t.objectives || []) {
        const ids = [];
        (o.items || []).forEach((i) => ids.push(i.id));
        (o.useAny || []).forEach((i) => ids.push(i.id));
        if (o.markerItem) ids.push(o.markerItem.id);
        for (const id of ids) (idx.usage[id] = idx.usage[id] || []).push({ taskId: t.id, obj: o });
      }
    }
    idx.traders = Object.values(traders).sort((a, b) => {
      const ia = TRADER_ORDER.indexOf(a.normalizedName), ib = TRADER_ORDER.indexOf(b.normalizedName);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.name.localeCompare(b.name);
    });

    const lockIds = new Set();   // évite les doublons quand des variantes de carte sont fusionnées
    for (const m of data.maps || []) {
      const slug = slugOf(m.normalizedName);
      const e = (idx.maps[slug] = idx.maps[slug] || {
        slug, name: m.name, nameId: m.nameId, raidDuration: m.raidDuration, players: m.players,
        extracts: [], transits: [], spawns: [], containers: [], loose: [], stationary: [], bosses: [], locks: [],
      });
      if (m.normalizedName === slug) { e.name = m.name; e.raidDuration = m.raidDuration; e.players = m.players; }
      e.extracts.push(...(m.extracts || []).filter((x) => x.position));
      e.transits.push(...(m.transits || []).filter((x) => x.position));
      e.spawns.push(...(m.spawns || []).filter((x) => x.position));
      e.containers.push(...(m.lootContainers || []).filter((x) => x.position && x.lootContainer));
      e.loose.push(...(m.lootLoose || []).filter((x) => x.position));
      e.stationary.push(...(m.stationaryWeapons || []).filter((x) => x.position));
      if (m.normalizedName === slug || !e.bosses.length) e.bosses = m.bosses || e.bosses;
      for (const l of m.locks || []) {
        if (!l.position) continue;
        const lid = l.id || `${m.normalizedName}:${l.position.x}:${l.position.y}:${l.position.z}`;
        if (lockIds.has(lid)) continue;
        lockIds.add(lid);
        e.locks.push(l);
      }
    }
    // Verrous par clé requise : « telle clé ouvre quoi » (porte ou coffre, sur quelles cartes).
    idx.locksByKey = {};
    for (const m of Object.values(idx.maps)) {
      for (const l of m.locks) {
        const kid = l.key && l.key.id;
        if (kid) (idx.locksByKey[kid] = idx.locksByKey[kid] || []).push({ slug: m.slug, lock: l });
      }
    }
    for (const [slug, m] of Object.entries(idx.maps)) {
      for (const l of m.loose) for (const it of l.items || []) {
        const o = (idx.lootByItem[it.id] = idx.lootByItem[it.id] || {});
        o[slug] = (o[slug] || 0) + 1;
      }
    }
    const cats = {};
    for (const it of data.items || []) { const c = it.category && it.category.name; if (c) cats[c] = (cats[c] || 0) + 1; }
    idx.categories = Object.entries(cats).sort((a, b) => a[0].localeCompare(b[0]));

    // Hideout : pour chaque objet, les stations et niveaux qui le demandent.
    idx.hideoutByItem = {};
    idx.hideoutStations = data.hideout || [];
    for (const st of idx.hideoutStations) {
      for (const lv of st.levels || []) {
        for (const it of lv.items || []) {
          (idx.hideoutByItem[it.id] = idx.hideoutByItem[it.id] || []).push({ station: st.name, stationId: st.id, level: lv.level, count: it.count, fir: !!it.fir });
        }
      }
    }
    return idx;
  }

  function setData(data) {
    S.data = data;
    S.idx = buildIndex(data);
    if (inferPrereqs()) scheduleSave();
    emit("data");
  }

  /* ---------- Progression : persistance ---------- */
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const json = JSON.stringify(S.progress);
      try {
        if (invoke) await invoke("save_progress", { mode: S.mode, json });
        else localStorage.setItem("progress", json);
      } catch (e) { console.error("sauvegarde progression", e); }
    }, 500);
  }
  async function loadProgress() {
    try {
      const txt = invoke ? await invoke("load_progress", { mode: S.mode }) : (localStorage.getItem("progress-" + S.mode) || localStorage.getItem("progress"));
      if (txt) { S.progress = Object.assign(freshProgress(), JSON.parse(txt)); S.progress.v = 2; }
      else S.progress = freshProgress();
    } catch (e) { console.error("lecture progression", e); }
  }

  /* ---------- Progression : états des quêtes ---------- */
  const STATUS_TO_REQ = { finished: "complete", started: "active", failed: "failed" };
  const reqMet = (req) => {
    const st = S.progress.tasks[req.task && req.task.id];
    return !!st && (req.status || []).includes(STATUS_TO_REQ[st]);
  };
  const unmetReqs = (task) => (task.taskRequirements || []).filter((r) => !reqMet(r));
  const levelOk = (task) => !S.progress.level || !task.minPlayerLevel || S.progress.level >= task.minPlayerLevel;

  /** 'finished' | 'started' | 'failed' | 'locked' */
  function stateOf(task) {
    const st = S.progress.tasks[task.id];
    if (st) return st;
    // Une quête pas dans la progression est "locked" même si ses prérequis sont remplis:
    // c'est une quête *disponible*, pas "en cours". Elle doit être explicitement
    // démarrée (ou l'événement est passé dans les logs) pour apparaître dans "En cours".
    return "locked";
  }
  /** 'available' | 'locked' : état d'une quête non-démarrée. */
  function availabilityOf(task) {
    if (levelOk(task) && !unmetReqs(task).length) return "available";
    return "locked";
  }
  /** Pourquoi une quête est verrouillée (texte), ou "" si elle ne l'est pas. */
  function lockReason(task) {
    if (S.progress.tasks[task.id]) return "";
    const un = unmetReqs(task).map((r) => (S.idx && S.idx.tasks[r.task && r.task.id] || {}).name).filter(Boolean);
    if (un.length) return t("q.prereq", { list: un.slice(0, 3).join(", ") + (un.length > 3 ? ` (+${un.length - 3})` : "") });
    if (!levelOk(task)) return t("q.levelReq", { n: task.minPlayerLevel });
    return "";
  }
  const startedTasks = () => Object.values(S.idx ? S.idx.tasks : {}).filter((t) => {
    const st = S.progress.tasks[t.id];
    // Retourne les quêtes qui sont dans la progression avec un statut actif
    // "started" = démarrée, "failed" = échouée (les objectifs sont marqués)
    // "finished" n'est pas inclus car les objectifs sont déjà remplis
    return st === "started" || st === "failed";
  });

  function completeObjectives(taskId) {
    const t = S.idx && S.idx.tasks[taskId];
    if (t) for (const o of t.objectives || []) S.progress.objectives[o.id] = true;
  }
  function clearObjectives(taskId) {
    const t = S.idx && S.idx.tasks[taskId];
    if (t) for (const o of t.objectives || []) delete S.progress.objectives[o.id];
  }
  function recordActivity(id, status, at, src) {
    const a = S.progress.activity;
    if (a.some((x) => x.id === id && x.status === status && x.at === at)) return;
    a.unshift({ id, status, at, src });
    a.sort((x, y) => y.at - x.at);
    if (a.length > 60) a.length = 60;
  }

  /**
   * Applique un évènement venant des logs. Un évènement plus ancien que l'état déjà connu (par exemple un choix
   * manuel fait depuis) est ignoré : rejouer l'historique ne défait donc jamais tes réglages récents.
   */
  function applyOne(ev, src) {
    const { id, status } = ev || {};
    if (!id || !STATUSES.has(status)) return false;
    const at = ev.at || Date.now();
    const known = S.progress.tasks[id];
    const prev = S.progress.at[id] || 0;
    const inferred = !!S.progress.inferred[id];
    if (known && !inferred && ev.at && ev.at < prev) return false;       // plus ancien que ce qu'on sait
    if (known === status && !inferred) { S.progress.at[id] = Math.max(prev, at); return false; }
    S.progress.tasks[id] = status;
    S.progress.at[id] = at;
    delete S.progress.inferred[id];
    if (status === "finished") completeObjectives(id);
    recordActivity(id, status, at, src);
    return true;
  }

  /** Une quête commencée ou terminée implique que ses prérequis « terminés » le sont aussi. */
  function inferPrereqs() {
    if (!S.idx) return 0;
    const stack = Object.values(S.idx.tasks).filter((t) => ["started", "finished"].includes(S.progress.tasks[t.id]));
    let n = 0;
    while (stack.length) {
      const t = stack.pop();
      for (const r of t.taskRequirements || []) {
        const rid = r.task && r.task.id;
        if (!rid || S.progress.tasks[rid] || !(r.status || []).includes("complete")) continue;
        S.progress.tasks[rid] = "finished"; S.progress.at[rid] = 1; S.progress.inferred[rid] = true;
        completeObjectives(rid); n++;
        if (S.idx.tasks[rid]) stack.push(S.idx.tasks[rid]);
      }
    }
    return n;
  }

  function setTaskStatus(id, status) {
    if (status) {
      S.progress.tasks[id] = status; S.progress.at[id] = Date.now(); delete S.progress.inferred[id];
      if (status === "finished") completeObjectives(id);
      recordActivity(id, status, S.progress.at[id], "manuel");
      inferPrereqs();
    } else {
      delete S.progress.tasks[id]; delete S.progress.at[id]; delete S.progress.inferred[id];
      clearObjectives(id);
    }
    scheduleSave(); emit("progress");
  }
  function toggleObjective(id) {
    if (S.progress.objectives[id]) delete S.progress.objectives[id]; else S.progress.objectives[id] = true;
    scheduleSave(); emit("progress");
  }
  function setLevel(n) {
    const v = Math.round(Number(n));
    S.progress.level = v >= 1 && v <= 79 ? v : null;
    scheduleSave(); emit("progress");
  }

  /* ---------- Compteur d'objets possédés ---------- */
  /** Quantité possédée d'un objet (0 si inconnue). */
  function itemCount(id) { return S.counts[id] || 0; }
  /** Fixe la quantité possédée d'un objet. 0 efface l'entrée. Prévient toute l'interface. */
  function setItemCount(id, n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v) S.counts[id] = v; else delete S.counts[id];
    try { localStorage.setItem("itemCounts", JSON.stringify(S.counts)); } catch (_) {}
    emit("counts");
  }
  /** Ajoute (delta positif) ou retire (delta négatif) des exemplaires. */
  function adjustItemCount(id, delta) { setItemCount(id, itemCount(id) + delta); }
  function clearItemCounts() { S.counts = {}; try { localStorage.removeItem("itemCounts"); } catch (_) {} emit("counts"); }

  /* ---------- Hideout : niveau de chaque station ---------- */
  function hideoutLevel(stationId) { return (S.progress.hideout && S.progress.hideout[stationId]) || 0; }
  function setHideoutLevel(stationId, n) {
    S.progress.hideout = S.progress.hideout || {};
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v) S.progress.hideout[stationId] = v; else delete S.progress.hideout[stationId];
    scheduleSave(); emit("hideout");
  }
  /** Objets à réunir pour une station, du niveau `from` (exclu) au niveau `to` (inclus), fusionnés. */
  function hideoutNeeds(station, from, to) {
    const out = new Map();
    for (const lv of (station && station.levels) || []) {
      if (lv.level <= from || (to != null && lv.level > to)) continue;
      for (const it of lv.items || []) {
        const e = out.get(it.id) || { id: it.id, count: 0, fir: false, levels: [] };
        e.count += it.count;
        e.fir = e.fir || !!it.fir;
        if (!e.levels.includes(lv.level)) e.levels.push(lv.level);
        out.set(it.id, e);
      }
    }
    return [...out.values()];
  }

  const STATUS_LABEL = { started: "q.started", finished: "q.finished", failed: "q.failed" };
  const STATUS_LC = { started: "q.started.lc", finished: "q.finished.lc", failed: "q.failed.lc" };
  /** Évènement en direct : on prévient l'utilisateur, c'est le « suivi dynamique ». */
  function applyTaskEvent(ev) {
    const changed = applyOne(ev, "logs");
    if (!changed) return false;
    const inferred = inferPrereqs();
    S.sync.lastAt = Date.now();
    scheduleSave(); emit("progress");
    const tk = S.idx && S.idx.tasks[ev.id];
    const msg = t("misc.questStatus", { status: t(STATUS_LC[ev.status] || "q.started.lc"), name: tk ? tk.name : ev.id }) +
      (inferred ? t("misc.inferred", { n: inferred }) : "");
    notify(msg, ev.status === "failed" ? "warn" : "ok");
    return true;
  }
  /** Historique (relecture des logs) : appliqué dans l'ordre chronologique. */
  function applyHistory(events, meta) {
    const before = Object.assign({}, S.progress.tasks);
    for (const ev of [...(events || [])].sort((a, b) => (a.at || 0) - (b.at || 0))) applyOne(ev, "logs");
    const inferred = inferPrereqs();
    const changed = Object.keys(S.progress.tasks).filter((id) => S.progress.tasks[id] !== before[id]).length;
    S.sync = Object.assign({}, S.sync, meta || {}, { lastAt: Date.now(), events: (events || []).length, changed, inferred, error: "", busy: false });
    if (changed) scheduleSave();
    emit("progress"); emit("sync");
    return { changed, inferred };
  }
  async function rescan(quiet) {
    if (!invoke) { notify(t("misc.demoOnly"), "warn"); return null; }
    if (S.sync.busy) return null;
    S.sync.busy = true; emit("sync");
    try {
      const rep = await invoke("rescan_quests");
      const r = applyHistory(rep.events, { files: rep.files, sessions: rep.sessions });
      if (!quiet) {
        notify(rep.events.length
          ? t("misc.rescanOk", { files: rep.files, changed: r.changed, inferred: r.inferred ? t("misc.inferred", { n: r.inferred }) : "" })
          : t("misc.rescanNone", { files: rep.files, sessions: rep.sessions }), rep.events.length ? "ok" : "warn");
      }
      return r;
    } catch (e) {
      S.sync = Object.assign({}, S.sync, { error: String(e), busy: false });
      emit("sync");
      if (!quiet) notify(String(e), "warn");
      return null;
    }
  }

  /* ---------- Statistiques et besoins ---------- */
  function stats() {
    if (!S.idx) return null;
    const out = { total: 0, finished: 0, started: 0, failed: 0, locked: 0, kappaTotal: 0, kappaDone: 0 };
    for (const t of Object.values(S.idx.tasks)) {
      const st = stateOf(t);
      out.total++; out[st]++;
      if (t.kappaRequired) { out.kappaTotal++; if (st === "finished") out.kappaDone++; }
    }
    return out;
  }
  /** Objets à trouver pour les quêtes en cours : id -> { count, fir, quests: [{ task, count }] }. */
  function neededItems() {
    const out = new Map();
    for (const t of startedTasks()) {
      const per = new Map();
      for (const o of t.objectives || []) {
        if (S.progress.objectives[o.id] || o.optional || !ITEM_TYPES.has(o.type)) continue;
        for (const i of o.items || []) {
          const e = per.get(i.id) || { count: 0, fir: false };
          e.count = Math.max(e.count, o.count || 1); e.fir = e.fir || !!o.foundInRaid;   // « trouver » puis « remettre » = un seul lot
          per.set(i.id, e);
        }
      }
      for (const [id, e] of per) {
        const g = out.get(id) || { count: 0, fir: false, quests: [] };
        g.count += e.count; g.fir = g.fir || e.fir; g.quests.push({ task: t, count: e.count });
        out.set(id, g);
      }
    }
    return out;
  }

  /* ---------- Chargement / actualisation ---------- */
  async function demoData() {
    try { return await (await fetch("demo/data.json")).json(); } catch (_) { return null; }
  }
  async function load() {
    await loadProgress();
    let text = null;
    try { text = invoke ? await invoke("load_cache", { lang: S.lang }) : null; } catch (e) { S.error = String(e); }
    if (text) { setData(JSON.parse(text)); }
    else if (!invoke) { const d = await demoData(); if (d) setData(d); }
    emit("status");
    const stale = !S.data || Date.now() / 1000 - (S.data.fetchedAt || 0) > 24 * 3600;
    if (invoke && stale) refresh(true);
  }

  // Réessai automatique quand le téléchargement échoue : 5 min, puis 10, 20, 30 max.
  let retryTimer = null, retryDelay = 5 * 60 * 1000;
  function scheduleRetry() {
    clearTimeout(retryTimer);
    S.retryAt = Date.now() + retryDelay;
    retryTimer = setTimeout(() => refresh(true), retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30 * 60 * 1000);
  }
  /** Texte à afficher à la place d'une liste vide quand on n'a pas de données. */
  function emptyMessage() {
    if (S.busy) return S.busy;
    if (S.error) {
      const tm = S.retryAt ? hhmm(S.retryAt) : "";
      return S.error.split("\n")[0] + (tm ? t("misc.retryAt", { time: tm }) : "");
    }
    return t("misc.noData");
  }
  async function refresh(silent) {
    if (!invoke) { S.error = t("misc.demoNoDownload"); emit("status"); return; }
    if (S.busy) return;
    S.busy = t("misc.loading"); S.error = ""; emit("status");
    try {
      const text = await invoke("refresh_data", { lang: S.lang });
      const d = JSON.parse(text);
      setData(d);
      (d.warnings || []).forEach((w) => TT.warn && TT.warn(w));
      clearTimeout(retryTimer); S.retryAt = 0; retryDelay = 5 * 60 * 1000;
      if (!silent) notify(t("misc.updated"), "ok");
    } catch (e) {
      // Un échec silencieux au démarrage ne doit pas gêner : les données en cache restent utilisables.
      S.error = String(e);
      scheduleRetry();
    } finally { S.busy = ""; emit("status"); }
  }
  if (T) T.event.listen("data-progress", (e) => { S.busy = e.payload; emit("status"); });
  async function setLang(lang) {
    S.lang = lang; localStorage.setItem("lang", lang); S.data = null; S.idx = null;
    TT.i18n.setLang(lang);
    emit("data"); await load();
  }
  /** Change le mode de jeu : recharge la progression propre à ce mode (PvP/PvE/Saison). */
  async function setGameMode(mode) {
    if (!mode || mode === S.mode) return;
    S.mode = mode; localStorage.setItem("mode", mode);
    await loadProgress();
    emit("modes"); emit("progress");
  }

  /* ---------- Recherche / fiche objet (overlay) ---------- */
  /** Fiche complète d'un objet : prix, marchand, quêtes concernées, emplacements de loot. */
  function lookupItem(id) {
    const idx = S.idx, it = idx && idx.items[id];
    if (!it) return null;
    const where = idx.lootByItem[id] || {};
    const maps = Object.entries(where).map(([slug, n]) => {
      const def = (TT.mapDefs || []).find((m) => m.slug === slug);
      return { slug, name: def ? def.name : slug, count: n };
    }).sort((a, b) => b.count - a.count);
    const uses = idx.usage[id] || [];
    const byTask = new Map();
    for (const u of uses) {
      const e = byTask.get(u.taskId) || { count: 0, fir: false };
      e.count = Math.max(e.count, u.obj.count || 1); e.fir = e.fir || !!u.obj.foundInRaid;
      byTask.set(u.taskId, e);
    }
    const quests = [...byTask].map(([tid, u]) => {
      const t = idx.tasks[tid];
      return { id: tid, name: t ? t.name : tid, state: t ? stateOf(t) : "started", count: u.count, fir: u.fir };
    }).sort((a, b) => (a.state === "started" ? -1 : 0) - (b.state === "started" ? -1 : 0));
    const need = neededItems().get(id) || null;
    // Prix de vente : le marché (flea) et les marchands. On garde le marchand le plus cher.
    const sell = (it.sellFor || []).filter((s) => s.price != null);
    const fleaEntry = sell.find((s) => /flea/.test(s.source || ""));
    const flea = it.avg24hPrice || (fleaEntry ? fleaEntry.price : null);
    const traderName = (slug) => {
      const t = (idx.traders || []).find((x) => x.normalizedName === slug);
      return t ? t.name : slug;
    };
    const traders = sell
      .filter((s) => !/flea/.test(s.source || ""))
      .map((s) => ({ name: traderName(s.source), price: s.price }))
      .sort((a, b) => b.price - a.price);
    const bestTrader = traders[0] || null;
    const hideout = (idx.hideoutByItem[id] || []).slice().sort((a, b) => a.level - b.level);
    // Verrous que cette clé ouvre (porte ou coffre), avec le nom lisible de la carte.
    const locks = (idx.locksByKey[id] || []).map(({ slug, lock }) => {
      const def = (TT.mapDefs || []).find((m) => m.slug === slug);
      return { slug, map: def ? def.name : slug, type: lock.lockType || "door", needsPower: !!lock.needsPower };
    });
    return { item: it, flea, base: it.basePrice || null, bestTrader, traders, category: it.category ? it.category.name : "", maps, quests, needed: need, hideout, locks };
  }

  /** Recherche globale : objets, quêtes et cartes qui correspondent au texte. */
  function searchAll(q, limit) {
    const idx = S.idx, out = [];
    const s = (q || "").trim().toLowerCase();
    if (!idx || s.length < 2) return out;
    const max = limit || 12;
    for (const it of Object.values(idx.items)) {
      if ((it.name || "").toLowerCase().includes(s) || (it.shortName || "").toLowerCase().includes(s)) {
        out.push({ kind: "item", id: it.id, label: it.name, sub: it.category ? it.category.name : "", price: it.avg24hPrice || it.basePrice });
        if (out.length >= max) return out;
      }
    }
    for (const t of Object.values(idx.tasks)) {
      if ((t.name || "").toLowerCase().includes(s)) {
        out.push({ kind: "quest", id: t.id, label: t.name, sub: t.trader ? t.trader.name : "", state: stateOf(t) });
        if (out.length >= max) return out;
      }
    }
    for (const m of TT.mapDefs || []) {
      if ((m.name || "").toLowerCase().includes(s)) {
        out.push({ kind: "map", id: m.slug, label: m.name, sub: t("store.map") });
        if (out.length >= max) return out;
      }
    }
    return out;
  }

  if (T) T.event.listen("game_mode_changed", (e) => { setGameMode(e.payload); });

  const MODE_LABEL = { PvP: "PvP", PvE: "PvE", Season: t("store.season") };

  TT.store = {
    S, setLang, setGameMode, MODE_LABEL, lookupItem, searchAll, emptyMessage, esc, fmtPrice, ago, agoMs, hhmm, slugOf, load, refresh, setData,
    stateOf, availabilityOf, lockReason, setTaskStatus, toggleObjective, setLevel, applyTaskEvent, applyHistory, rescan, inferPrereqs,
    itemCount, setItemCount, adjustItemCount, clearItemCounts,
    hideoutLevel, setHideoutLevel, hideoutNeeds,
    startedTasks, stats, neededItems, invoke, emit,
    on: (f) => (listeners.add(f), () => listeners.delete(f)),
  };
})();
