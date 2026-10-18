"use strict";
// Onglet Quêtes : bandeau de synchro, onglets marchands, puces de statut, liste à gauche, détail ou tableau de bord à droite.
(function () {
  const TT = (window.TT = window.TT || {});
  const { esc, slugOf } = TT.store;
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => TT.i18n.t(k, p);

  const STATE_LABEL = { finished: "q.finished", started: "q.st.started", failed: "q.failed", locked: "q.locked" };
  const ACT_LABEL = { started: "q.started.lc", finished: "q.finished.lc", failed: "q.failed.lc" };
  const CHIPS = [["all", "q.chip.all"], ["started", "q.chip.started"], ["locked", "q.chip.locked"], ["finished", "q.chip.finished"], ["failed", "q.chip.failed"]];
  const TYPE_LABEL = {
    visit: "q.type.visit", mark: "q.type.mark", giveItem: "q.type.giveItem", findItem: "q.type.findItem", shoot: "q.type.shoot", extract: "q.type.extract",
    plantItem: "q.type.plantItem", plantQuestItem: "q.type.plantItem", findQuestItem: "q.type.findQuestItem", giveQuestItem: "q.type.giveQuestItem", taskStatus: "q.type.taskStatus",
    playerLevel: "q.type.playerLevel", skill: "q.type.skill", buildWeapon: "q.type.buildWeapon", useItem: "q.type.useItem", traderLevel: "q.type.traderLevel",
    experience: "q.type.experience", traderStanding: "q.type.traderStanding",
  };
  const ORDER = { started: 0, locked: 1, failed: 2, finished: 3 };
  const mapName = (slug) => { const d = (TT.mapDefs || []).find((m) => m.slug === slugOf(slug)); return d ? d.name : String(slug).replace(/-/g, " "); };

  // « auto » = « En cours » s'il y a des quêtes en cours, sinon « Toutes » (jusqu'à ce que tu choisisses).
  const F = { trader: "all", state: "auto", map: "all", q: "", kappa: false };
  let selected = null;
  const tasks = () => { const i = TT.store.S.idx; return i ? Object.values(i.tasks) : []; };
  const LOCALE = { fr: "fr-FR", en: "en-GB", de: "de-DE", es: "es-ES", ru: "ru-RU" };
  const when = (ms) => {
    const d = new Date(ms), now = new Date();
    const loc = LOCALE[TT.i18n.current()] || "fr-FR";
    return d.toDateString() === now.toDateString()
      ? d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  };

  /** Quêtes qui passent tous les filtres sauf le statut. */
  function pool() {
    const q = F.q.trim().toLowerCase();
    return tasks().filter((t) => {
      if (F.trader !== "all" && (!t.trader || t.trader.normalizedName !== F.trader)) return false;
      if (F.kappa && !t.kappaRequired) return false;
      if (F.map !== "all") {
        const m = (t.map && slugOf(t.map.normalizedName)) === F.map || (t.objectives || []).some((o) => (o.maps || []).some((x) => slugOf(x.normalizedName) === F.map));
        if (!m) return false;
      }
      return !q || t.name.toLowerCase().includes(q);
    });
  }

  /* ---------- Bandeau de synchro ---------- */
  function renderSync() {
    const S = TT.store.S, sy = S.sync, box = $("q-sync");
    const btn = (act, label) => `<button class="btn sm" data-act="${act}" type="button">${label}</button>`;
    let cls = "syncbar", html;
    if (!window.__TAURI__) html = `<span>${esc(t("q.sync.demo"))}</span>`;
    else if (TT.logsOk === false) { cls += " warn"; html = `<span>${esc(t("q.sync.noLogs"))}</span>${btn("settings", esc(t("q.configure")))}`; }
    else if (sy.busy) html = `<span>${esc(t("q.sync.busy"))}</span>`;
    else if (sy.error) { cls += " warn"; html = `<span>${esc(sy.error)}</span>${btn("rescan", esc(t("q.retry")))}`; }
    else if (sy.lastAt && sy.events === 0) {
      cls += " warn";
      const files = sy.files != null ? t("q.sync.filesSuffix", { n: sy.files }) : "";
      html = `<span>${esc(t("q.sync.eventsNone", { f: files }))}</span>${btn("rescan", esc(t("q.rescan")))}${btn("settings", esc(t("q.diag")))}`;
    } else if (sy.lastAt) {
      html = `<span class="okdot"></span><span>${esc(t("q.sync.synced", {
        ago: TT.store.agoMs(sy.lastAt), n: sy.events,
        files: sy.files != null ? t("q.sync.inFiles", { n: sy.files }) : "",
        changed: sy.changed ? t("q.sync.changed", { n: sy.changed }) : "",
        inferred: sy.inferred ? t("misc.inferred", { n: sy.inferred }) : "",
      }))}</span>${btn("rescan", esc(t("q.rescan")))}`;
    } else html = `<span>${esc(t("q.sync.wait"))}</span>`;
    box.className = cls; box.innerHTML = html;
  }

  /* ---------- Marchands, puces ---------- */
  function renderTraders() {
    const idx = TT.store.S.idx, st = TT.store;
    const count = (list) => `${list.filter((t) => st.stateOf(t) === "finished").length}/${list.length}`;
    let h = `<button class="subtab${F.trader === "all" ? " on" : ""}" data-trader="all" type="button" role="tab">${esc(t("q.all"))} <em>${count(tasks())}</em></button>`;
    for (const tr of idx.traders) {
      const list = tasks().filter((t) => t.trader && t.trader.normalizedName === tr.normalizedName);
      h += `<button class="subtab${F.trader === tr.normalizedName ? " on" : ""}" data-trader="${esc(tr.normalizedName)}" type="button" role="tab">${esc(tr.name)} <em>${count(list)}</em></button>`;
    }
    $("q-traders").innerHTML = h;
  }
  function renderStates(counts, active) {
    $("q-states").innerHTML = CHIPS.map(([k, l]) => `<button class="chip-tab${k === active ? " on" : ""}" data-state="${k}" type="button">${esc(t(l))} <em>${counts[k]}</em></button>`).join("");
  }

  /* ---------- Liste ---------- */
  function renderList(list, active) {
    const st = TT.store;
    $("q-count").textContent = t("q.count", { n: list.length });
    const empty = {
      started: t("q.empty.started"), finished: t("q.empty.finished"),
    }[active] || t("q.empty.none");
    $("q-list").innerHTML = list.map((t_) => {
      const s = st.stateOf(t_), mn = t_.map ? mapName(t_.map.normalizedName) : "";
      return `<button class="qitem st-${s}${t_.id === selected ? " sel" : ""}" data-id="${esc(t_.id)}" type="button">` +
        `<i class="dot"></i><span class="qn">${esc(t_.name)}</span><span class="qm">${esc(mn)}</span><em>${esc(t("q.lvlShort", { n: t_.minPlayerLevel || 1 }))}</em></button>`;
    }).join("") || `<p class="dim pad">${esc(empty)}</p>`;
  }

  /* ---------- Détail d'une quête ---------- */
  function objectiveHtml(o) {
    const st = TT.store, idx = st.S.idx, done = !!st.S.progress.objectives[o.id];
    let extra = "";
    const ids = [...(o.items || []), ...(o.useAny || [])];
    if (ids.length) {
      extra = '<div class="oitems">' + ids.slice(0, 6).map((i) => {
        const it = idx.items[i.id];
        return it ? `<button class="chip-item" data-item="${esc(it.id)}" type="button">${it.iconLink ? `<img src="${esc(it.iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : ""}${esc(it.shortName || it.name)}</button>` : "";
      }).join("") + (ids.length > 6 ? `<span class="dim">+${ids.length - 6}</span>` : "") +
        (o.count > 1 ? `<span class="dim">× ${o.count}</span>` : "") + (o.foundInRaid ? `<span class="tag">${t("q.foundInRaid")}</span>` : "") + "</div>";
    }
    return `<li class="obj${done ? " done" : ""}"><label class="chk"><input type="checkbox" data-obj="${esc(o.id)}"${done ? " checked" : ""}>` +
      `<span><span class="tag">${esc(t(TYPE_LABEL[o.type] || o.type))}</span> ${esc(o.description)}${o.optional ? ` <span class="tag opt">${esc(t("q.optional"))}</span>` : ""}</span></label>${extra}</li>`;
  }

  function renderDetail() {
    const st = TT.store, idx = st.S.idx, task = selected && idx.tasks[selected];
    const box = $("q-detail");
    if (!task) { box.innerHTML = summaryHtml(); return; }
    const s = st.stateOf(task), reason = st.lockReason(task), inferred = !!st.S.progress.inferred[task.id];
    const reqs = (task.taskRequirements || []).map((r) => ({ t: idx.tasks[r.task && r.task.id], r })).filter((x) => x.t);
    const unlocks = tasks().filter((x) => (x.taskRequirements || []).some((r) => r.task && r.task.id === task.id));
    const btns = [];
    if (s === "started") btns.push(["finished", t("q.finish"), "primary"], ["failed", t("q.fail"), ""]);
    if (s === "locked") btns.push(["started", t("q.start"), "primary"], ["finished", t("q.markFinished"), ""]);
    if (s === "finished" || s === "failed") btns.push(["reset", t("q.reset"), ""]);
    box.innerHTML =
      `<header class="qhead"><h2>${esc(task.name)}</h2><span class="state st-${s}">${esc(t(STATE_LABEL[s]))}</span>${inferred ? `<span class="tag" title="${esc(t("q.inferred"))}">${esc(t("q.inferredShort"))}</span>` : ""}</header>` +
      `<div class="meta"><span>${esc(task.trader ? task.trader.name : "")}</span><span>${esc(t("q.level_short", { n: task.minPlayerLevel || 1 }))}</span>` +
      (task.map ? `<span>${esc(mapName(task.map.normalizedName))}</span>` : "") +
      (task.kappaRequired ? `<span class="tag">${esc(t("q.kappa"))}</span>` : "") + (task.lightkeeperRequired ? `<span class="tag">${esc(t("q.lightkeeper"))}</span>` : "") + "</div>" +
      (reason ? `<p class="lock">${esc(reason)}</p>` : "") +
      '<div class="actions">' + btns.map(([v, l, c]) => `<button class="btn ${c}" data-set="${v}" type="button">${esc(l)}</button>`).join("") +
      `<button class="btn" data-act="onmap" type="button">${esc(t("q.onMap"))}</button><button class="btn ghost" data-act="back" type="button">${esc(t("q.dashboard"))}</button></div>` +
      `<h3>${esc(t("q.objectives"))}</h3><ul class="objs">` + (task.objectives || []).map(objectiveHtml).join("") + "</ul>" +
      (reqs.length ? `<h3>${esc(t("q.reqs"))}</h3><div class="links">` + reqs.map((x) => `<button class="link st-${st.stateOf(x.t)}" data-id="${esc(x.t.id)}" type="button"><i class="dot"></i>${esc(x.t.name)}</button>`).join("") + "</div>" : "") +
      (unlocks.length ? `<h3>${esc(t("q.unlocks"))}</h3><div class="links">` + unlocks.map((x) => `<button class="link st-${st.stateOf(x)}" data-id="${esc(x.id)}" type="button"><i class="dot"></i>${esc(x.name)}</button>`).join("") + "</div>" : "");
  }

  /* ---------- Tableau de bord (aucune quête sélectionnée) ---------- */
  function summaryHtml() {
    const st = TT.store, s = st.stats(), idx = st.S.idx;
    const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
    const link = (tk, extra) => `<button class="link st-${st.stateOf(tk)}" data-id="${esc(tk.id)}" type="button"><i class="dot"></i>${esc(tk.name)}${extra || ""}</button>`;
    let h = `<h2 class="sumtitle">${esc(t("q.summary.title"))}</h2><div class="bars">` +
      `<div class="bar"><span>${esc(t("q.chip.finished"))}</span><b>${s.finished} / ${s.total}</b><i style="--p:${pct(s.finished, s.total)}%"></i></div>` +
      `<div class="bar"><span>${esc(t("q.summary.kappa"))}</span><b>${s.kappaDone} / ${s.kappaTotal}</b><i style="--p:${pct(s.kappaDone, s.kappaTotal)}%"></i></div></div>` +
      `<div class="kv"><span>${esc(t("q.chip.started"))}</span><b>${s.started}</b><span>${esc(t("q.chip.locked"))}</span><b>${s.locked}</b><span>${esc(t("q.chip.failed"))}</span><b>${s.failed}</b></div>`;
    const started = st.startedTasks();
    h += `<h3>${esc(t("q.summary.todo"))}</h3>`;
    h += started.length ? '<div class="links">' + started.map((tk) => {
      const o = (tk.objectives || []).find((x) => !st.S.progress.objectives[x.id] && !x.optional);
      return link(tk, o ? ` <em>${esc(o.description).slice(0, 60)}</em>` : "");
    }).join("") + "</div>" : `<p class="dim">${esc(t("q.summary.none"))}</p>`;
    const avail = tasks().filter((tk) => st.stateOf(tk) === "started").sort((a, b) => (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0)).slice(0, 8);
    if (avail.length) h += `<h3>${esc(t("q.summary.next"))}</h3>` + '<div class="links">' + avail.map((tk) => link(tk, ` <em>${esc(t("q.lvlShort", { n: tk.minPlayerLevel || 1 }))}</em>`)).join("") + "</div>";
    const act = st.S.progress.activity.filter((a) => idx.tasks[a.id]).slice(0, 10);
    h += `<h3>${esc(t("q.summary.activity"))}</h3>`;
    h += act.length ? '<div class="feed">' + act.map((a) => `<button class="feeditem st-${a.status}" data-id="${esc(a.id)}" type="button"><i class="dot"></i><span>${esc(t("q.word"))} ${esc(t(ACT_LABEL[a.status]))}</span><b>${esc(idx.tasks[a.id].name)}</b><em>${when(a.at)} · ${a.src === "logs" ? esc(t("q.fromLogs")) : esc(t("q.byHand"))}</em></button>`).join("") + "</div>" : `<p class="dim">${esc(t("q.summary.none"))}</p>`;
    return h;
  }

  /* ---------- Rendu global ---------- */
  function render() {
    renderSync();
    const idx = TT.store.S.idx;
    if (!idx) {
      $("q-detail").innerHTML = ""; $("q-list").innerHTML = `<p class="dim pad">${esc(TT.store.emptyMessage())}</p>`;
      $("q-traders").innerHTML = ""; $("q-states").innerHTML = ""; $("q-count").textContent = ""; return;
    }
    const st = TT.store, base = pool();
    const counts = { all: base.length, started: 0, locked: 0, finished: 0, failed: 0 };
    for (const t of base) counts[st.stateOf(t)]++;
    // « auto » = « En cours » s'il y a des quêtes réellement commencées ou échouées ;
    // sinon « Toutes ». Une quête est "en cours" que si elle a un statut "started"
    // (ou "failed") dans la progression — pas une simple quête disponible.
    const inProgress = base.filter((t) => st.S.progress.tasks[t.id] == "started" || st.S.progress.tasks[t.id] == "failed").length;
    const active = F.state === "auto" ? (inProgress > 0 ? "started" : "all") : F.state;
    // Pour le filtre "started", stateOf ne retourne "started" que pour les quêtes dans la progression.
    const list = (active === "all" ? base : base.filter((t) => st.stateOf(t) === active))
      .sort((a, b) => ORDER[st.stateOf(a)] - ORDER[st.stateOf(b)] || (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0) || a.name.localeCompare(b.name));
    renderTraders(); renderStates(counts, active); renderList(list, active); renderDetail();
    const lv = $("q-level");
    if (document.activeElement !== lv) lv.value = st.S.progress.level || "";
  }
  const relist = () => render();

  function init() {
    const sel = $("q-map");
    sel.append(new Option(t("q.allMaps"), "all"));
    (TT.mapDefs || []).forEach((m) => sel.append(new Option(m.name, m.slug)));
    $("q-traders").addEventListener("click", (e) => { const b = e.target.closest("[data-trader]"); if (b) { F.trader = b.dataset.trader; relist(); } });
    $("q-states").addEventListener("click", (e) => { const b = e.target.closest("[data-state]"); if (b) { F.state = b.dataset.state; relist(); } });
    $("q-list").addEventListener("click", (e) => { const b = e.target.closest("[data-id]"); if (b) { selected = b.dataset.id; render(); } });
    $("q-search").addEventListener("input", (e) => { F.q = e.target.value; relist(); });
    sel.addEventListener("change", (e) => { F.map = e.target.value; relist(); });
    $("q-kappa").addEventListener("change", (e) => { F.kappa = e.target.checked; relist(); });
    $("q-level").addEventListener("change", (e) => TT.store.setLevel(e.target.value));
    $("q-sync").addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "rescan") TT.store.rescan(); else if (b.dataset.act === "settings") TT.openSettings && TT.openSettings(true);
    });
    $("q-detail").addEventListener("click", (e) => {
      const b = e.target.closest("[data-set],[data-id],[data-item],[data-act]");
      if (!b) return;
      if (b.dataset.set) TT.store.setTaskStatus(selected, b.dataset.set === "reset" ? null : b.dataset.set);
      else if (b.dataset.id) { selected = b.dataset.id; render(); }
      else if (b.dataset.item) { TT.nav.show("items"); TT.items.select(b.dataset.item); }
      else if (b.dataset.act === "back") { selected = null; render(); }
      else if (b.dataset.act === "onmap") { if (TT.mapview.focusTaskOnMap(selected)) TT.nav.show("map"); else TT.notify(t("q.noMapPos"), "warn"); }
    });
    $("q-detail").addEventListener("change", (e) => { if (e.target.dataset.obj) TT.store.toggleObjective(e.target.dataset.obj); });
    TT.store.on((k) => { if (["data", "progress", "status", "sync"].includes(k)) render(); });
    TT.i18n.onChange(render);
    render();
  }

  TT.quests = { init, render, select: (id) => { selected = id; render(); }, filters: F };
})();
