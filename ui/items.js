"use strict";
// Onglet Objets : liste virtualisée (milliers de lignes, seules les lignes visibles existent dans le DOM).
(function () {
  const TT = (window.TT = window.TT || {});
  const { esc, fmtPrice } = TT.store;
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => TT.i18n.t(k, p);
  const ROW = 54;

  const F = { q: "", cat: "all", sort: "name", needed: false, hideout: false };
  let list = [], selected = null, raf = 0;

  const needed = () => TT.store.neededItems();
  const trName = (idx, slug) => { const t = (idx.traders || []).find((x) => x.normalizedName === slug); return t ? t.name : slug; };

  function compute() {
    const idx = TT.store.S.idx;
    if (!idx) { list = []; return; }
    const q = F.q.trim().toLowerCase(), need = F.needed ? needed() : null;
    list = Object.values(idx.items).filter((it) => {
      if (F.cat !== "all" && !(it.category && it.category.name === F.cat)) return false;
      if (need && !need.has(it.id)) return false;
      if (F.hideout && !(idx.hideoutByItem[it.id] || []).length) return false;
      return !q || (it.name || "").toLowerCase().includes(q) || (it.shortName || "").toLowerCase().includes(q);
    });
    const price = (it) => it.avg24hPrice || it.basePrice || 0;
    list.sort(F.sort === "price" ? (a, b) => price(b) - price(a) : (a, b) => (a.name || "").localeCompare(b.name || ""));
    $("i-count").textContent = t("i.count", { n: list.length });
    $("i-spacer").style.height = list.length * ROW + "px";
    $("i-scroll").scrollTop = 0;
  }

  function paint() {
    raf = 0;
    const sc = $("i-scroll"), idx = TT.store.S.idx;
    if (!idx) return;
    const h = sc.clientHeight || 600;
    const first = Math.max(0, Math.floor(sc.scrollTop / ROW) - 4);
    const last = Math.min(list.length, Math.ceil((sc.scrollTop + h) / ROW) + 4);
    const need = needed();
    let html = "";
    for (let i = first; i < last; i++) {
      const it = list[i];
      const have = TT.store.itemCount(it.id);
      html += `<div class="irow${it.id === selected ? " sel" : ""}${need.has(it.id) ? " need" : ""}${have ? " have" : ""}" style="top:${i * ROW}px" data-id="${esc(it.id)}" role="button" tabindex="0">` +
        `<span class="ico">${it.iconLink ? `<img src="${esc(it.iconLink)}" alt="" loading="lazy" onerror="this.remove()">` : ""}</span>` +
        `<span class="in"><b>${esc(it.name)}${need.has(it.id) ? `<i class="need-tag">× ${need.get(it.id).count}${need.get(it.id).fir ? " FIR" : ""}</i>` : ""}</b><small>${esc(it.category ? it.category.name : "")}</small></span>` +
        `<span class="icnt" title="${esc(t("i.have"))}">` +
          `<button class="cbtn" data-dec="${esc(it.id)}" type="button" aria-label="−" tabindex="-1">−</button>` +
          `<input class="cn" type="text" inputmode="numeric" value="${have}" data-own="${esc(it.id)}" aria-label="${esc(t("i.have"))}" tabindex="-1">` +
          `<button class="cbtn" data-inc="${esc(it.id)}" type="button" aria-label="+" tabindex="-1">+</button>` +
        `</span>` +
        `<span class="ip">${fmtPrice(it.avg24hPrice || it.basePrice)}</span></div>`;
    }
    $("i-rows").innerHTML = html;
  }
  /** Met à jour en place les compteurs affichés, sans reconstruire les lignes (garde le focus). */
  function refreshCounts() {
    $("i-rows").querySelectorAll("[data-own]").forEach((el) => {
      if (document.activeElement === el) return;
      const v = TT.store.itemCount(el.dataset.own);
      if (el.value !== String(v)) el.value = v;
      el.closest(".irow").classList.toggle("have", !!v);
    });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(paint); };

  function detail() {
    const st = TT.store, idx = st.S.idx, it = selected && idx && idx.items[selected];
    const box = $("i-detail");
    if (!it) { box.innerHTML = `<p class="dim pad">${esc(t("i.none"))}</p>`; return; }
    const uses = idx.usage[it.id] || [];
    const where = idx.lootByItem[it.id] || {};
    let h = `<header class="qhead"><h2>${esc(it.name)}</h2></header>` +
      `<div class="meta"><span>${esc(it.category ? it.category.name : "")}</span><span>${it.width}×${it.height}</span></div>` +
      `<div class="kv"><span>${esc(t("i.base"))}</span><b>${fmtPrice(it.basePrice)}</b><span>${esc(t("i.avg24"))}</span><b>${fmtPrice(it.avg24hPrice)}</b></div>`;
    // Compteur « possédé » : quantité en inventaire, partagée avec le hideout et les verrous.
    const have = st.itemCount(it.id);
    h += `<div class="ownrow"><span>${esc(t("i.have"))}</span>` +
      `<button class="cbtn" data-dec="${esc(it.id)}" type="button" aria-label="−">−</button>` +
      `<input class="own-in" type="text" inputmode="numeric" value="${have}" data-own="${esc(it.id)}" aria-label="${esc(t("i.have"))}">` +
      `<button class="cbtn" data-inc="${esc(it.id)}" type="button" aria-label="+">+</button></div>`;
    // Clé : quelles portes / coffres elle ouvre.
    const keyLocks = idx.locksByKey[it.id] || [];
    if (keyLocks.length) {
      h += `<h3>${esc(t("i.opens"))}</h3><div class="links">` + keyLocks.slice(0, 14).map(({ slug, lock }) => {
        const def = (TT.mapDefs || []).find((m) => m.slug === slug);
        const label = lock.lockType === "trunk" ? t("map.lock.trunk") : t("map.lock.door");
        return `<button class="link" data-loc="${esc(slug)}" type="button">${esc(def ? def.name : slug)} <em>${esc(label)}${lock.needsPower ? " ⚡" : ""}</em></button>`;
      }).join("") + (keyLocks.length > 14 ? `<span class="dim">+${keyLocks.length - 14}</span>` : "") + "</div>";
    }
    const nd = needed().get(it.id);
    const sell = (it.sellFor || []).filter((s) => s.price != null);
    const traders = sell.filter((s) => !/flea/.test(s.source || "")).sort((a, b) => b.price - a.price);
    const best = traders[0];
    h += `<div class="kv"><span>${esc(t("i.bestTrader"))}</span><b>${best ? `${esc(trName(idx, best.source))} · ${fmtPrice(best.price)}` : fmtPrice(it.basePrice)}</b></div>`;
    if (nd) {
      h += `<h3>${esc(t("i.forQuests"))}</h3><p class="needline"><b>× ${nd.count}</b>${nd.fir ? ` <span class="tag">${esc(t("i.fir"))}</span>` : ""}</p><div class="links">` +
        nd.quests.map((q) => `<button class="link st-started" data-task="${esc(q.task.id)}" type="button"><i class="dot"></i>${esc(q.task.name)} <em>× ${q.count}</em></button>`).join("") + "</div>";
    }
    h += `<h3>${esc(t("i.allQuests"))}</h3>`;
    // Une quête qui demande de trouver puis de remettre le même objet ne doit apparaître qu'une fois.
    const byTask = new Map();
    for (const u of uses) {
      const e = byTask.get(u.taskId) || { count: 0, fir: false };
      e.count = Math.max(e.count, u.obj.count || 1); e.fir = e.fir || !!u.obj.foundInRaid;
      byTask.set(u.taskId, e);
    }
    h += byTask.size ? '<div class="links">' + [...byTask].map(([tid, u]) => {
      const task = idx.tasks[tid], s = st.stateOf(task);
      return `<button class="link st-${s}" data-task="${esc(task.id)}" type="button"><i class="dot"></i>${esc(task.name)}${u.count > 1 ? " × " + u.count : ""}${u.fir ? " (FIR)" : ""}</button>`;
    }).join("") + "</div>" : `<p class="dim">${esc(t("i.noQuest"))}</p>`;
    h += `<h3>${esc(t("i.hideout"))}</h3>`;
    const ho = idx.hideoutByItem[it.id] || [];
    h += ho.length ? '<div class="links">' + ho.slice(0, 12).map((u) =>
      `<span class="link"><i class="dot"></i>${esc(u.station)} <em>${esc(t("q.lvlShort", { n: u.level }))} · × ${u.count}${u.fir ? " FIR" : ""}</em></span>`).join("") +
      (ho.length > 12 ? `<span class="dim">+${ho.length - 12}</span>` : "") + "</div>"
      : `<p class="dim">${esc(t("i.noHideout"))}</p>`;
    h += `<h3>${esc(t("i.loot"))}</h3>`;
    const maps = Object.entries(where).sort((a, b) => b[1] - a[1]);
    h += maps.length ? '<div class="links">' + maps.map(([slug, n]) => {
      const def = (TT.mapDefs || []).find((m) => m.slug === slug);
      return `<button class="link" data-loc="${esc(slug)}" type="button">${esc(def ? def.name : slug)} <em>${esc(t("i.spots", { n }))}</em></button>`;
    }).join("") + "</div>" : `<p class="dim">${esc(t("i.noLoot"))}</p>`;
    box.innerHTML = h;
  }

  function select(id) {
    selected = id;
    // On fait défiler jusqu'à l'objet si on le trouve dans la liste actuelle.
    let i = list.findIndex((x) => x.id === id);
    if (i < 0 && TT.store.S.idx) { F.q = ""; F.cat = "all"; F.needed = false; F.hideout = false; $("i-search").value = ""; $("i-cat").value = "all"; $("i-needed").checked = false; $("i-hideout").checked = false; compute(); i = list.findIndex((x) => x.id === id); }
    if (i >= 0) $("i-scroll").scrollTop = Math.max(0, i * ROW - 80);
    paint(); detail();
  }

  function render() {
    const idx = TT.store.S.idx, cat = $("i-cat");
    if (idx && cat.options.length <= 1) idx.categories.forEach(([n, c]) => cat.append(new Option(`${n} (${c})`, n)));
    if (!idx) { $("i-count").textContent = ""; $("i-rows").innerHTML = ""; $("i-spacer").style.height = "0"; $("i-detail").innerHTML = `<p class="dim pad">${esc(TT.store.emptyMessage())}</p>`; return; }
    compute(); paint(); detail();
  }

  function init() {
    $("i-cat").append(new Option(t("i.cat.all"), "all"));
    $("i-search").addEventListener("input", (e) => { F.q = e.target.value; compute(); paint(); });
    $("i-cat").addEventListener("change", (e) => { F.cat = e.target.value; compute(); paint(); });
    $("i-sort").addEventListener("change", (e) => { F.sort = e.target.value; compute(); paint(); });
    $("i-needed").addEventListener("change", (e) => { F.needed = e.target.checked; compute(); paint(); });
    $("i-hideout").addEventListener("change", (e) => { F.hideout = e.target.checked; compute(); paint(); });
    $("i-scroll").addEventListener("scroll", schedule, { passive: true });
    $("i-rows").addEventListener("click", (e) => {
      // Compteur « possédé » : boutons +/− (on ne sélectionne pas la ligne dans ce cas).
      const step = e.target.closest("[data-inc],[data-dec]");
      if (step) {
        e.preventDefault(); e.stopPropagation();
        const id = step.dataset.inc || step.dataset.dec;
        TT.store.adjustItemCount(id, step.dataset.inc ? 1 : -1);
        return;
      }
      if (e.target.closest("[data-own]")) { e.stopPropagation(); return; } // saisie en cours
      const b = e.target.closest("[data-id]"); if (b) { selected = b.dataset.id; paint(); detail(); }
    });
    // Saisie directe de la quantité (on valide au changement, pas à chaque frappe, pour ne pas perdre le focus).
    $("i-rows").addEventListener("change", (e) => {
      const inp = e.target.closest("[data-own]");
      if (inp) TT.store.setItemCount(inp.dataset.own, parseInt(inp.value, 10) || 0);
    });
    $("i-rows").addEventListener("keydown", (e) => {
      const inp = e.target.closest("[data-own]");
      if (inp) { if (e.key === "Enter") { inp.blur(); } e.stopPropagation(); return; }
      if (e.key === "Enter" || e.key === " ") { const b = e.target.closest("[data-id]"); if (b) { e.preventDefault(); selected = b.dataset.id; paint(); detail(); } }
    });
    // Overlay : au survol d'une ligne, une fiche compacte suit la souris (flea + meilleur marchand + besoin quête).
    $("i-rows").addEventListener("mousemove", (e) => {
      const b = e.target.closest(".irow");
      if (b && TT.hoverCard) TT.hoverCard.show(b.dataset.id, e.clientX, e.clientY);
      else if (TT.hoverCard) TT.hoverCard.hide();
    });
    $("i-rows").addEventListener("mouseleave", () => TT.hoverCard && TT.hoverCard.hide());
    $("i-detail").addEventListener("click", (e) => {
      const step = e.target.closest("[data-inc],[data-dec]");
      if (step) {
        const id = step.dataset.inc || step.dataset.dec;
        TT.store.adjustItemCount(id, step.dataset.inc ? 1 : -1);
        return;
      }
      const b = e.target.closest("[data-task],[data-loc]");
      if (!b) return;
      if (b.dataset.task) { TT.nav.show("quests"); TT.quests.select(b.dataset.task); }
      else if (TT.mapview.locateItem(selected, b.dataset.loc)) TT.nav.show("map");
    });
    $("i-detail").addEventListener("change", (e) => {
      const inp = e.target.closest("[data-own]");
      if (inp) TT.store.setItemCount(inp.dataset.own, parseInt(inp.value, 10) || 0);
    });
    $("i-detail").addEventListener("keydown", (e) => {
      if (e.target.closest("[data-own]") && e.key === "Enter") { e.target.blur(); e.stopPropagation(); }
    });
    TT.store.on((k) => {
      if (k === "data") { $("i-cat").length = 1; render(); }
      else if (k === "progress") { paint(); detail(); }
      else if (k === "counts") { refreshCounts(); detail(); }
      else if (k === "status" && !TT.store.S.idx) render();
    });
    TT.i18n.onChange(() => { const sel = $("i-cat").value; $("i-cat").options[0].text = t("i.cat.all"); $("i-cat").value = sel; compute(); paint(); detail(); });
    render();
  }

  TT.items = { init, render, select, onShow: schedule };
})();
