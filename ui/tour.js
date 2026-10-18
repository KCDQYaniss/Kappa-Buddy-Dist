"use strict";
// Visite guidée du premier lancement : met un élément en évidence et l'explique en une phrase.
// Rejouable depuis Réglages. L'état est mémorisé dans localStorage.
(function () {
  const TT = (window.TT = window.TT || {});
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => TT.i18n.t(k, p);

  const STEPS = [
    { sel: "#map-select", text: "tour.mapSelect", place: "bottom" },
    { sel: "#floor-bar", text: "tour.floor", place: "bottom" },
    { sel: "#center-btn", text: "tour.center", place: "bottom" },
    { sel: "#map-side", text: "tour.layers", place: "right" },
    { sel: '[data-view="quests"]', text: "tour.quests", place: "top" },
    { sel: '[data-view="items"]', text: "tour.items", place: "top" },
    { sel: '[data-view="hideout"]', text: "tour.hideout", place: "top" },
    { sel: null, text: "tour.ctrlF", place: "center" },
    { sel: "#ontop-btn", text: "tour.ontop", place: "top" },
    { sel: "#mode-badge", text: "tour.mode", place: "top" },
    { sel: "#settings-btn", text: "tour.settings", place: "top" },
  ];
  const KEY = "tourDone";

  let spot = null, box = null, idx = 0, active = false;

  function ensureDom() {
    if (box) return;
    spot = document.createElement("div");
    spot.className = "tour-spot";
    box = document.createElement("div");
    box.className = "tour-box";
    document.body.append(spot, box);
  }

  /** L'élément ciblé s'il est réellement affiché (les étapes sans cible sont au centre). */
  function targetOf(sel) {
    if (!sel) return null;
    const el = document.querySelector(sel);
    if (!el) return null;
    // Masqué par l'attribut `hidden` (onglet non affiché, sélecteur d'étage absent sur cette carte).
    if (el.hidden || el.closest("[hidden]")) return null;
    return el;
  }

  function placeBubble(rect, where) {
    const bw = box.offsetWidth, bh = box.offsetHeight, gap = 12;
    let x = (window.innerWidth - bw) / 2, y = (window.innerHeight - bh) / 2;
    if (rect) {
      x = rect.left + rect.width / 2 - bw / 2;
      y = rect.bottom + gap;
      if (where === "top") y = rect.top - bh - gap;
      else if (where === "right") { x = rect.right + gap; y = rect.top + rect.height / 2 - bh / 2; }
      else if (where === "left") { x = rect.left - bw - gap; y = rect.top + rect.height / 2 - bh / 2; }
    }
    box.style.left = Math.max(10, Math.min(x, window.innerWidth - bw - 10)) + "px";
    box.style.top = Math.max(10, Math.min(y, window.innerHeight - bh - 10)) + "px";
  }

  function draw() {
    const step = STEPS[idx];
    const el = targetOf(step.sel);
    const rect = el ? el.getBoundingClientRect() : null;
    if (rect) {
      spot.hidden = false;
      spot.style.left = rect.left - 6 + "px";
      spot.style.top = rect.top - 6 + "px";
      spot.style.width = rect.width + 12 + "px";
      spot.style.height = rect.height + 12 + "px";
    } else {
      spot.hidden = true;
    }
    const last = idx === STEPS.length - 1;
    box.innerHTML = `<p>${TT.store.esc(t(step.text))}</p><div class="tour-foot">` +
      `<span class="tour-count">${idx + 1} / ${STEPS.length}</span>` +
      `<button class="btn sm" type="button" data-tour="skip">${TT.store.esc(t("tour.skip"))}</button>` +
      (idx ? `<button class="btn sm" type="button" data-tour="prev">${TT.store.esc(t("tour.prev"))}</button>` : "") +
      `<button class="btn sm primary" type="button" data-tour="next">${TT.store.esc(last ? t("tour.done") : t("tour.next"))}</button></div>`;
    box.hidden = false;
    placeBubble(rect, step.place);
  }

  /** Avance à l'étape suivante réellement affichable (certaines cibles n'existent pas sur toutes les cartes). */
  function go(delta) {
    let i = idx + delta;
    while (i >= 0 && i < STEPS.length) {
      if (!STEPS[i].sel || targetOf(STEPS[i].sel)) { idx = i; draw(); return; }
      i += delta;
    }
    finish();
  }

  function finish() {
    active = false;
    if (spot) spot.hidden = true;
    if (box) box.hidden = true;
    try { localStorage.setItem(KEY, "1"); } catch (_) {}
  }

  function start() {
    ensureDom();
    idx = 0;
    active = true;
    // On repart de la carte : c'est là que se trouve la plupart des éléments expliqués.
    if (TT.nav) TT.nav.show("map");
    if (!STEPS[0].sel || targetOf(STEPS[0].sel)) draw(); else go(1);
  }

  document.addEventListener("click", (e) => {
    if (!active) return;
    const b = e.target.closest("[data-tour]");
    if (!b) return;
    e.preventDefault();
    const a = b.dataset.tour;
    if (a === "next") go(1);
    else if (a === "prev") go(-1);
    else finish();
  });
  window.addEventListener("resize", () => { if (active) draw(); });
  document.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Escape") finish();
    else if (e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); go(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
  });

  TT.tour = {
    start,
    /** Lance la visite au premier démarrage seulement. */
    maybeStart() { try { if (!localStorage.getItem(KEY)) setTimeout(start, 900); } catch (_) { setTimeout(start, 900); } },
    reset() { try { localStorage.removeItem(KEY); } catch (_) {} start(); },
    isActive: () => active,
  };
})();
