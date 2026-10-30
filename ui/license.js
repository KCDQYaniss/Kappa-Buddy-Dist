"use strict";
// Licence : écran d'activation (gate) et appels au module Rust (license.rs).
//
// Modèle (license-worker/README.md) : un achat itch.io = une licence à vie,
// 1 appareil par clé, libération self-service 1×/30 j. Tant que l'essai de 3
// jours court, l'app est complète ; expirée, un voile bloque l'interface
// jusqu'à l'activation. L'overlay de jeu est en plus refusé côté Rust.
(function () {
  const TT = (window.TT = window.TT || {});
  const { esc } = TT.store;
  const t = (k, p) => TT.i18n.t(k, p);
  const $ = (id) => document.getElementById(id);
  const T = window.__TAURI__;
  const invoke = T ? T.core.invoke : null;
  // Page itch.io : renseignée à la mise en vente. Vide = bouton d'achat caché
  // (jamais de lien mort dans l'app).
  const ITCH_URL = "";

  /** État de fond (steady) : licensed | trial | expired. */
  let steady = null;
  /** Dernier refus d'activation/swap (LicenseState avec error_code). */
  let lastErr = null;
  let busy = false;

  /** Traduit le code d'un refus ; un code inconnu retombe sur le générique. */
  function errText(err) {
    if (!err || !err.error_code) return "";
    let txt = t(err.error_code, err.error_params || {});
    if (txt === err.error_code) txt = t("license.err.server");
    return txt;
  }

  async function refresh() {
    if (!invoke) return;
    try {
      steady = await invoke("license_state");
      lastErr = null;
    } catch (e) {
      console.error("license_state:", e); // pas de gate en cas de panne du pont
    }
    renderGate();
  }

  function renderGate() {
    const g = $("gate");
    if (!g) return;
    const blocked = !!steady && steady.status === "expired";
    g.hidden = !blocked;
    if (!blocked) return;
    const err = errText(lastErr);
    const swappable = lastErr && lastErr.can_swap === true;
    const itch = steady.itch_name ? esc(t("license.licensedAs").replace("{itch}", "")) : "";
    g.innerHTML =
      `<div class="gate-card" role="dialog" aria-modal="true" aria-labelledby="gate-title">` +
      `<h2 id="gate-title">${esc(t("license.gateTitle"))}</h2>` +
      `<p class="dim">${esc(t("license.gateText", { d: steady.trial_days_total || 3 }))}</p>` +
      (ITCH_URL ? `<p><a class="btn primary" href="${esc(ITCH_URL)}" target="_blank" rel="noreferrer">${esc(t("license.buy"))}</a></p>` : "") +
      `<input id="gate-key" type="text" autocomplete="off" spellcheck="false" placeholder="${esc(t("license.keyPlaceholder"))}">` +
      `<input id="gate-label" type="text" autocomplete="off" placeholder="${esc(t("license.labelPlaceholder"))}">` +
      `<div class="gate-actions">` +
      `<button id="gate-activate" class="btn primary" type="button">${esc(t(busy ? "license.activating" : "license.activate"))}</button>` +
      (swappable ? `<button id="gate-swap" class="btn" type="button">${esc(t(busy ? "license.swapping" : "license.swap"))}</button>` : "") +
      `</div>` +
      (err ? `<p class="gate-err" role="alert">${esc(err)}</p>` : "") +
      `</div>`;
    const act = $("gate-activate");
    if (act) act.addEventListener("click", () => runActivate());
    const sw = $("gate-swap");
    if (sw) sw.addEventListener("click", () => runSwap());
  }

  async function runActivate() {
    if (busy) return;
    const key = ($("gate-key") || {}).value || "";
    const label = (($("gate-label") || {}).value || "").trim();
    if (!key.trim()) {
      lastErr = { error_code: "license.err.missingKey" };
      renderGate();
      return;
    }
    busy = true;
    renderGate();
    try {
      const r = await invoke("license_activate", { key, label: label || null });
      accept(r);
    } catch (e) {
      lastErr = { error_code: "license.err.network", error_params: { e: String(e) } };
      renderGate();
    }
    busy = false;
    renderGate();
  }

  async function runSwap() {
    if (busy) return;
    const label = (($("gate-label") || {}).value || "").trim();
    busy = true;
    renderGate();
    try {
      const r = await invoke("license_swap", { label: label || null });
      accept(r);
    } catch (e) {
      lastErr = { error_code: "license.err.network", error_params: { e: String(e) } };
      renderGate();
    }
    busy = false;
    renderGate();
  }

  /** Traite une réponse d'activation/swap : succès → débloque ; refus →
   *  affiché dans le gate si l'accès est bloqué, sinon en notification. */
  function accept(r) {
    if (r && (r.status === "licensed" || r.status === "trial")) {
      steady = r;
      lastErr = null;
      TT.notify(t("license.thanks"), "ok");
    } else {
      lastErr = r || { error_code: "license.err.server" };
      if (!steady || steady.status !== "expired") TT.notify(errText(lastErr), "warn");
    }
  }

  /** Point d'entrée (appelé par app.js après get_state). */
  async function init() {
    if (!invoke) return; // hors Tauri (tests, démo) : pas de gate
    await refresh();
  }

  TT.license = { init, refresh, errText, ITCH_URL };
  // Hook de test uniquement : force un état (steady + erreur) et redessine.
  TT.license._setState = (s, e) => { steady = s; lastErr = e || null; renderGate(); };
})();
