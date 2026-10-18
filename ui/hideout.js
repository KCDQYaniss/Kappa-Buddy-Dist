"use strict";
// Onglet Hideout : stations, niveaux, bonus et objets à réunir.
// Le compteur d'objets est partagé avec l'onglet Objets (même magasin TT.store.itemCount).
(function () {
  const TT = (window.TT = window.TT || {});
  const { esc, fmtPrice } = TT.store;
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => TT.i18n.t(k, p);

  const F = { q: "", onlyMissing: false, ignoreFir: false };
  let selected = null;

  /* ---------- Icônes SVG des bonus ---------- */
  const BONUS_ICONS = {
    ExperienceRate: "M12 2l2.4 7.2H22l-6 4.4 2.3 7.4-6.3-4.6-6.3 4.6L8 13.6 2 9.2h7.6z",
    SkillGroupLevelingBoost: "M3 17l6-6 4 4 8-8M15 7h6v6",
    AdditionalSlots: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
    EnergyRegeneration: "M13 2L4 14h6l-1 8 9-12h-6z",
    HealthRegeneration: "M12 21s-7-4.5-9.5-9C.8 8 2.5 4.5 6 4.5c2 0 3.5 1 4.5 2.5C11.5 5.5 13 4.5 15 4.5c3.5 0 5.2 3.5 3.5 7.5C19 16.5 12 21 12 21zM12 8v6M9 11h6",
    HydrationRegeneration: "M12 2s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z",
    DebuffEndDelay: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2",
    MaximumEnergyReserve: "M2 8h16v8H2zM18 10h2v4h-2zM5 10h2v4H5zM9 10h2v4H9zM13 10h2v4h-2z",
    FuelConsumption: "M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h14M15 9h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V9.8a2 2 0 0 0-.6-1.4L20 7M7 7h6v4H7z",
    InsuranceReturnTime: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5zM9 12l2 2 4-4",
    QuestMoneyReward: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v12M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 .9-3 2.2c0 3 6 1.6 6 4.3 0 1.3-1.3 2.5-3 2.5s-3-1.1-3-2.5",
    RagfairCommission: "M19 5L5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
    RepairArmorBonus: "M12 2L4 5v6c0 5 3.5 9.5 8 11 4.5-1.5 8-6 8-11V5zM8 12l3 3 5-6",
    RepairWeaponBonus: "M3 17l6-6 4 4 8-8M15 7h6v6",
    ScavCooldownTimer: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6v6l4 2M17 2l3 3",
    StashSize: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
    UnlockArmorRepair: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM8 12l3 3 5-6M18 2l3 3-3 3M21 5l-3-3",
    UnlockWeaponModification: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4L14 13l-3-3zM16 6l2-2M18 8l2-2",
    UnlockWeaponRepair: "M3 17l6-6 4 4 8-8M15 7h6v6M18 2l3 3-3 3M21 5l-3-3",
  };

  const BONUS_FORMAT = {
    ExperienceRate: "pct", SkillGroupLevelingBoost: "pct", EnergyRegeneration: "pct",
    HealthRegeneration: "pct", HydrationRegeneration: "pct", DebuffEndDelay: "pct",
    InsuranceReturnTime: "pct", ScavCooldownTimer: "pct", QuestMoneyReward: "pct",
    RagfairCommission: "pct", FuelConsumption: "pct", RepairArmorBonus: "pct",
    RepairWeaponBonus: "pct", AdditionalSlots: "count", MaximumEnergyReserve: "count",
    StashSize: "count", UnlockArmorRepair: "unlock", UnlockWeaponModification: "unlock",
    UnlockWeaponRepair: "unlock",
  };

  function bonusValue(b) {
    const fmt = BONUS_FORMAT[b.type] || "count";
    const v = Number(b.value) || 0;
    if (fmt === "pct") {
      const pct = Math.round(v * 100);
      return (pct > 0 ? "+" : "") + pct + "%";
    }
    if (fmt === "unlock") return t("h.unlock");
    return (v > 0 ? "+" : "") + v;
  }

  function bonusIcon(type) {
    return BONUS_ICONS[type] || BONUS_ICONS.StashSize;
  }

  /* ---------- Données ---------- */
  const stations = () => (TT.store.S.idx && TT.store.S.idx.hideoutStations) || [];
  const itemOf = (id) => (TT.store.S.idx && TT.store.S.idx.items[id]) || null;
  const stationById = (id) => stations().find((s) => s.id === id) || null;
  const maxLevel = (st) => (st.levels || []).reduce((m, lv) => Math.max(m, lv.level), 0);
  const deficit = (needs) => needs.reduce((n, r) => n + Math.max(0, r.count - TT.store.itemCount(r.id)), 0);

  /* ---------- Rendu ---------- */

  /** Carte de station pour la liste (gauche). */
  function stationCard(st) {
    const lvl = TT.store.hideoutLevel(st.id), max = maxLevel(st);
    const next = TT.store.hideoutNeeds(st, lvl, lvl + 1);
    const missing = deficit(next);
    const done = lvl >= max;
    const state = done ? "st-finished" : missing ? "" : "st-started";
    const pct = max ? Math.round((lvl / max) * 100) : 0;
    const bonusIcons = (next.flatMap((r) => []) || []);
    // Bonus du prochain niveau (depuis les données de niveau)
    const nextLevel = (st.levels || []).find((lv) => lv.level === lvl + 1);
    const bonuses = nextLevel ? nextLevel.bonuses || [] : [];
    const bonusChips = bonuses.slice(0, 4).map((b) =>
      `<span class="bchip" title="${esc(t("h.bonus." + b.type) || b.type)}"><svg viewBox="0 0 24 24"><path d="${bonusIcon(b.type)}"/></svg>${esc(bonusValue(b))}</span>`
    ).join("");
    return `<button class="stcard${st.id === selected ? " sel" : ""}${state ? " " + state : ""}" data-hstation="${esc(st.id)}" type="button">` +
      (st.imageLink ? `<span class="stcard-img" style="background-image:url('${esc(st.imageLink)}')"></span>` : "") +
      `<div class="stcard-body">` +
        `<div class="stcard-top"><b>${esc(st.name)}</b><span class="stcard-lvl">${done ? "MAX" : `LVL ${lvl}/${max}`}</span></div>` +
        `<div class="stcard-bar"><i style="width:${pct}%"></i></div>` +
        (bonusChips ? `<div class="stcard-bonuses">${bonusChips}</div>` : "") +
        `<div class="stcard-foot">${done ? `<span class="ok">✔ ${esc(t("h.maxed"))}</span>` : missing ? `<span class="bad">${esc(t("h.missingN", { n: missing }))}</span>` : `<span class="ok">${esc(t("h.ready"))}</span>`}</div>` +
      `</div></button>`;
  }

  /** Ligne d'exigence objet. */
  function reqRow(r, lvLabel) {
    const it = itemOf(r.id);
    const have = TT.store.itemCount(r.id);
    const missing = Math.max(0, r.count - have);
    const enough = missing === 0;
    const missingItem = !it;
    return `<div class="hrow${enough ? " ok" : ""}${missingItem ? " missing" : ""}" data-item="${esc(r.id)}">` +
      `<span class="hico">${it && it.iconLink ? `<img src="${esc(it.iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="hico-empty">?</span>`}</span>` +
      `<span class="hn"><b>${esc(it ? it.name : t("h.missingItem")) }</b>${r.fir ? `<i class="need-tag fir-tag" title="${esc(t("h.firOnly"))}">FIR</i>` : ""}<small>${esc(lvLabel)}</small></span>` +
      `<span class="hreq"><b>× ${r.count}</b><small class="${enough ? "ok" : "bad"}">${enough ? esc(t("h.ready")) : esc(t("h.missingN", { n: missing }))}</small></span>` +
      `<span class="icnt">` +
        `<button class="cbtn" data-dec="${esc(r.id)}" type="button" aria-label="−">−</button>` +
        `<input class="cn" type="text" inputmode="numeric" value="${have}" data-own="${esc(r.id)}" aria-label="${esc(t("i.have"))}">` +
        `<button class="cbtn" data-inc="${esc(r.id)}" type="button" aria-label="+">+</button>` +
      `</span></div>`;
  }

  /** Carte de bonus. */
  function bonusCard(b) {
    const label = t("h.bonus." + b.type) || b.type;
    return `<div class="bcard${b.production ? " prod" : ""}">` +
      `<svg viewBox="0 0 24 24"><path d="${bonusIcon(b.type)}"/></svg>` +
      `<div class="bcard-txt"><b>${esc(label)}</b><span>${esc(bonusValue(b))}</span></div>` +
      (b.skill ? `<small>${esc(b.skill)}</small>` : "") +
      `</div>`;
  }

  function detail() {
    const box = $("h-detail");
    const st = selected && stationById(selected);
    if (!st) { box.innerHTML = `<p class="dim pad">${esc(t("h.none"))}</p>`; return; }
    const lvl = TT.store.hideoutLevel(st.id), max = maxLevel(st);
    const nextLevel = (st.levels || []).find((lv) => lv.level === lvl + 1);
    const next = TT.store.hideoutNeeds(st, lvl, lvl + 1);
    const rest = TT.store.hideoutNeeds(st, lvl + 1, max);

    let h = `<div class="h-icon-row"><header class="qhead"><h2>${esc(st.name)}</h2></header>` +
      (st.imageLink ? `<span class="h-icon" style="background-image:url('${esc(st.imageLink)}')"></span>` : "") +
      `</div>`;
    // Description traduite (si disponible) ou description de secours
    if (nextLevel && nextLevel.description) {
      const translated = t(nextLevel.description);
      if (translated !== nextLevel.description) h += `<p class="h-desc">${esc(translated)}</p>`;
      else h += `<p class="h-desc">${esc(st.name)} – Niveau ${lvl + 1}</p>`;
    }
    h += `<div class="meta"><span>${esc(t("h.level", { n: lvl }))}</span><span>${esc(t("h.maxLevel", { n: max }))}</span></div>`;

    // Piste de niveaux
    h += `<h3>${esc(t("h.myLevel"))}</h3><div class="lvltrack">`;
    for (let i = 0; i <= max; i++) {
      h += `<button class="lvlnode${i === lvl ? " on" : ""}${i < lvl ? " done" : ""}" data-lvl="${i}" type="button">${i < lvl ? "✔" : i}</button>`;
      if (i < max) h += `<i class="lvlconn${i < lvl ? " done" : ""}"></i>`;
    }
    h += `</div>`;

    if (lvl >= max) { box.innerHTML = h + `<p class="dim">${esc(t("h.maxed"))}</p>`; return; }

    // Bonus du prochain niveau
    if (nextLevel && nextLevel.bonuses && nextLevel.bonuses.length) {
      h += `<h3>${esc(t("h.bonusesFor", { n: lvl + 1 }))}</h3><div class="bgrid">` +
        nextLevel.bonuses.map(bonusCard).join("") + `</div>`;
    }

    // Temps de construction
    if (nextLevel && nextLevel.constructionTime) {
      const hrs = Math.floor(nextLevel.constructionTime / 3600);
      const mins = Math.round((nextLevel.constructionTime % 3600) / 60);
      h += `<div class="h-time">⏱ ${hrs > 0 ? hrs + "h" : ""}${mins > 0 ? mins + "min" : ""}</div>`;
    }

    // Prérequis
    const pre = [];
    if (nextLevel && nextLevel.skills) for (const s of nextLevel.skills) pre.push(`<span class="preq">📋 ${esc(s.skill)} <em>${esc(t("q.lvlShort", { n: s.level }))}</em></span>`);
    if (nextLevel && nextLevel.traders) for (const tr of nextLevel.traders) pre.push(`<span class="preq">🏪 ${esc(tr.trader)} <em>${esc(t("q.lvlShort", { n: tr.level }))}</em></span>`);
    if (nextLevel && nextLevel.stations) for (const sr of nextLevel.stations) {
      const sname = (stations().find((x) => x.id === sr.station) || {}).name || sr.station;
      pre.push(`<span class="preq">🏗 ${esc(sname)} <em>${esc(t("q.lvlShort", { n: sr.level }))}</em></span>`);
    }
    if (pre.length) h += `<h3>${esc(t("h.prereqs"))}</h3><div class="preq-list">${pre.join("")}</div>`;

    // Objets requis
    const nextShown = next.filter((r) => !F.onlyMissing || TT.store.itemCount(r.id) < r.count);
    h += `<h3>${esc(t("h.nextLevel", { n: lvl + 1 }))}</h3>`;
    h += nextShown.length ? nextShown.map((r) => reqRow(r, t("h.forLevel", { n: lvl + 1 }))).join("") : `<p class="dim">${esc(t("h.allReady"))}</p>`;

    // Niveaux suivants
    if (lvl + 1 < max) {
      const restShown = rest.filter((r) => !F.onlyMissing || TT.store.itemCount(r.id) < r.count);
      h += `<h3>${esc(t("h.restLevels", { from: lvl + 2, to: max }))}</h3>`;
      h += restShown.length ? restShown.map((r) => reqRow(r, t("h.forLevels", { list: r.levels.join(", ") }))).join("") : `<p class="dim">${esc(t("h.allReady"))}</p>`;
    }
    box.innerHTML = h;
  }

  function render() {
    const list = $("h-list");
    const all = stations();
    if (!all.length) {
      list.innerHTML = `<p class="dim pad">${esc(t("h.noData"))}</p>`;
      $("h-count").textContent = "";
      detail();
      return;
    }
    const q = F.q.trim().toLowerCase();
    const rows = all.filter((st) => !q || (st.name || "").toLowerCase().includes(q));
    let total = 0;
    for (const st of all) {
      const lvl = TT.store.hideoutLevel(st.id);
      if (lvl < maxLevel(st)) total += deficit(TT.store.hideoutNeeds(st, lvl, lvl + 1));
    }
    $("h-count").textContent = t("h.count", { stations: all.length, items: total });
    list.innerHTML = rows.map(stationCard).join("");
    detail();
  }

  function select(id) { selected = id; render(); }

  function init() {
    $("h-list").addEventListener("click", (e) => {
      const row = e.target.closest("[data-hstation]");
      if (row) select(row.dataset.hstation);
    });
    const step = (e) => {
      const b = e.target.closest("[data-inc],[data-dec]");
      if (!b) return false;
      TT.store.adjustItemCount(b.dataset.inc || b.dataset.dec, b.dataset.inc ? 1 : -1);
      return true;
    };
    $("h-detail").addEventListener("click", (e) => {
      if (step(e)) return;
      const lv = e.target.closest("[data-lvl]");
      if (lv && selected) TT.store.setHideoutLevel(selected, +lv.dataset.lvl);
    });
    $("h-detail").addEventListener("change", (e) => {
      const inp = e.target.closest("[data-own]");
      if (inp) TT.store.setItemCount(inp.dataset.own, parseInt(inp.value, 10) || 0);
    });
    $("h-detail").addEventListener("keydown", (e) => {
      if (e.target.closest("[data-own]") && e.key === "Enter") { e.target.blur(); e.stopPropagation(); }
    });
    $("h-search").addEventListener("input", (e) => { F.q = e.target.value; render(); });
    $("h-missing").addEventListener("change", (e) => { F.onlyMissing = e.target.checked; render(); });
    $("h-fir").addEventListener("change", (e) => { F.ignoreFir = e.target.checked; render(); });
    TT.store.on((k) => {
      if (k === "counts" || k === "hideout" || k === "progress" || k === "data") render();
    });
    TT.i18n.onChange(() => render());
    render();
  }

  TT.hideout = { init, render, select, onShow: render };
})();
