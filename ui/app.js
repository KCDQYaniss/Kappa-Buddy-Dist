"use strict";
// Assemblage : navigation, réglages, évènements envoyés par le backend Rust.
(function () {
  const TT = (window.TT = window.TT || {});
  const T = window.__TAURI__;
  const DEMO = !T;
  const $ = (id) => document.getElementById(id);
  const invoke = T ? T.core.invoke : async () => { throw new Error("hors Tauri"); };
  const listen = T ? T.event.listen : async () => () => {};
  const esc = (s) => TT.store.esc(s);
  const t = (k, p) => TT.i18n.t(k, p);
  let state = null;
  let lastMapEvent = "";
  const shown = new Set();

  /** Message bref (vert = information, orange = attention) qui disparaît tout seul. */
  TT.notify = function (text, kind) {
    const li = document.createElement("li");
    li.className = kind === "warn" ? "" : "ok";
    li.textContent = text;
    $("warnings").appendChild(li);
    while ($("warnings").children.length > 5) $("warnings").firstChild.remove();
    setTimeout(() => li.remove(), kind === "warn" ? 12000 : 7000);
  };

  TT.warn = function (text) {
    if (!text || shown.has(text)) return;
    shown.add(text);
    const li = document.createElement("li");
    li.textContent = text;
    const x = document.createElement("button");
    x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "Fermer"); x.textContent = "×";
    x.addEventListener("click", () => { li.remove(); shown.delete(text); });
    li.append(x);
    $("warnings").appendChild(li);
  };

  /* ---------- Clic droit ---------- */
  // On bloque le menu natif du navigateur sauf sur la carte (pour le menu contextuel personnalisé)
  document.addEventListener("contextmenu", (e) => {
    const t = e.target;
    const editable = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    // Autoriser le clic droit sur la carte et les menus contextuels personnalisés
    const inMap = t.closest("#map") || t.closest(".context-menu") || t.closest(".custom-point");
    if (!editable && !inMap) e.preventDefault();
  }, true); // Use capture phase to run before Leaflet

  /* ---------- Navigation ---------- */
  const VIEWS = ["map", "quests", "items", "hideout"];
  TT.nav = {
    show(view) {
      if (!VIEWS.includes(view)) view = "map";
      for (const v of VIEWS) {
        $("view-" + v).hidden = v !== view;
        const tab = document.querySelector(`[data-view="${v}"]`);
        tab.setAttribute("aria-selected", String(v === view));
      }
      localStorage.setItem("view", view);
      if (view === "map") TT.mapview.onShow();
      if (view === "items") TT.items.onShow();
      if (view === "hideout" && TT.hideout) TT.hideout.onShow();
    },
  };

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeLookup(); if (TT.hoverCard) TT.hoverCard.hide(); return; }
    const t = e.target, typing = t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) { e.preventDefault(); TT.lookup.toggle(); return; }
    if (typing || e.ctrlKey || e.altKey || e.metaKey || $("settings").open) return;
    if (e.key === "1" || e.key === "2" || e.key === "3" || e.key === "4") TT.nav.show(VIEWS[+e.key - 1]);
    else if (e.key === "f" || e.key === "F") { if (!$("view-map").hidden) TT.mapview.setFollow(!TT.mapview.isFollowing()); }
    else if (e.key === "/") {
      const box = !$("view-quests").hidden ? $("q-search") : !$("view-items").hidden ? $("i-search") : !$("view-hideout").hidden ? $("h-search") : null;
      if (box) { e.preventDefault(); box.focus(); box.select(); }
    }
  });

  /* ---------- Overlay : recherche globale + fiche objet ---------- */
  const lookup = (TT.lookup = {});
  function openLookup() {
    const box = $("lookup");
    if (!box) return;
    box.hidden = false;
    const q = $("lookup-q");
    q.value = ""; renderLookupResults(); q.focus();
  }
  function closeLookup() { const b = $("lookup"); if (b) b.hidden = true; }
  lookup.toggle = () => ($("lookup") && $("lookup").hidden ? openLookup() : closeLookup());
  lookup.close = closeLookup;

  function renderLookupResults() {
    const q = $("lookup-q") && $("lookup-q").value;
    const box = $("lookup-res");
    if (!q) { box.hidden = true; box.innerHTML = ""; return; }
    const res = TT.store.searchAll(q, 14);
    if (!res.length) { box.innerHTML = `<li class="dim">${t("look.noResult")}</li>`; box.hidden = false; box._res = []; return; }
    const kind = { item: t("look.kindItem"), quest: t("look.kindQuest"), map: t("look.kindMap") };
    box.innerHTML = res.map((r, i) => `<li><button type="button" data-res="${i}"><i class="k k-${r.kind}">${kind[r.kind]}</i> ${TT.store.esc(r.label)}` +
      (r.price != null ? `<em>${TT.store.fmtPrice(r.price)}</em>` : r.sub ? `<em>${TT.store.esc(r.sub)}</em>` : "") + "</button></li>").join("");
    box._res = res; box.hidden = false;
  }

  function showLookupCard(id) {
    const st = TT.store, d = st.lookupItem(id), card = $("lookup-card");
    if (!d) { card.innerHTML = `<p class="dim pad">${t("i.notFound")}</p>`; card.hidden = false; return; }
    let h = `<header><b>${st.esc(d.item.name)}</b>${d.category ? `<span class="dim">${st.esc(d.category)}</span>` : ""}</header>`;
    h += `<div class="lc-prices"><div class="lc-row flea"><span>${t("look.flea")}</span><b>${st.fmtPrice(d.flea)}</b></div>` +
      `<div class="lc-row trader"><span>${t("look.bestTrader")}${d.bestTrader ? " · " + st.esc(d.bestTrader.name) : d.base ? ` (${t("look.baseValue")})` : ""}</span>` +
      `<b>${st.fmtPrice(d.bestTrader ? d.bestTrader.price : d.base)}</b></div></div>`;
    if (d.traders.length > 1) h += '<div class="lc-sub">' + d.traders.slice(0, 4).map((t) => `${st.esc(t.name)} : ${st.fmtPrice(t.price)}`).join("<br>") + "</div>";
    if (d.needed) h += `<div class="lc-need">${t("i.forQuests")} : × ${d.needed.count}${d.needed.fir ? ` (${t("i.fir")})` : ""}</div>`;
    if (d.quests.length) h += `<h4>${t("i.allQuests")}</h4><div class="lc-links">` + d.quests.slice(0, 6).map((q) =>
      `<button type="button" class="link st-${st.esc(q.state)}" data-task="${st.esc(q.id)}">${st.esc(q.name)}${q.fir ? " (FIR)" : ""}</button>`).join("") + "</div>";
    if (d.hideout.length) h += `<h4>${t("i.hideout")}</h4><div class="lc-links">` + d.hideout.slice(0, 8).map((u) =>
      `<span class="link">${st.esc(u.station)} <em>niv. ${u.level} · × ${u.count}${u.fir ? " FIR" : ""}</em></span>`).join("") + "</div>";
    if (d.maps.length) h += `<h4>${t("i.loot")}</h4><div class="lc-links">` + d.maps.slice(0, 6).map((m) =>
      `<button type="button" class="link" data-loc="${st.esc(m.slug)}">${st.esc(m.name)} <em>${m.count}</em></button>`).join("") + "</div>";
    else h += `<h4>${t("i.loot")}</h4><p class="dim">${t("i.noLoot")}</p>`;
    card.innerHTML = h; card.hidden = false; card.dataset.id = id;
  }

  // Carte compacte qui suit la souris (survol d'un objet dans une liste).
  const hover = document.createElement("div");
  hover.className = "hovercard"; hover.hidden = true;
  document.body.appendChild(hover);
  TT.hoverCard = {
    show(id, x, y) {
      const st = TT.store, d = st.lookupItem(id);
      if (!d) return;
      hover.innerHTML = `<b>${st.esc(d.item.name)}</b>` +
        `<div class="hc-row"><span>${t("look.flea")}</span><b>${st.fmtPrice(d.flea)}</b></div>` +
        `<div class="hc-row"><span>${d.bestTrader ? st.esc(d.bestTrader.name) : t("look.bestTrader")}</span><b>${st.fmtPrice(d.bestTrader ? d.bestTrader.price : d.base)}</b></div>` +
        (d.needed ? `<div class="hc-need">${t("look.kindQuest")} : × ${d.needed.count}${d.needed.fir ? " FIR" : ""}</div>` : "");
      hover.hidden = false; this.move(x, y);
    },
    move(x, y) {
      if (hover.hidden) return;
      const w = hover.offsetWidth || 200, hh = hover.offsetHeight || 80;
      hover.style.left = Math.max(4, Math.min(x + 16, window.innerWidth - w - 8)) + "px";
      hover.style.top = Math.max(4, Math.min(y + 18, window.innerHeight - hh - 8)) + "px";
    },
    hide() { hover.hidden = true; },
  };

  /* ---------- Cursor Overlay (style Blitz) ---------- */
  let cursorOverlay = null;
  let cursorOverlayEnabled = false;

  function getCursorOverlay() {
    if (!cursorOverlay) cursorOverlay = document.getElementById("cursor-overlay");
    return cursorOverlay;
  }

  function formatPrice(price) {
    if (price == null || price === 0) return "—";
    return price.toLocaleString(navigator.language || "fr-FR") + " ₽";
  }

  // Trigger a one-shot capture + OCR via the Rust side (bound to the F2 hotkey
  // at the native level). There is no polling loop: each press does a single
  // capture pass (~1s) and shows the card at the top-left corner.
  async function lookupItemFromOCR() {
    try {
      return await invoke("capture_overlay");
    } catch (e) {
      console.error("[overlay] capture failed:", e);
    }
  }

  // Hide the main-window placeholder overlay (the real card lives in the
  // separate alwaysOnTop overlay.html window which the Rust side drives).
  function hideCursorOverlay() {
    const overlay = getCursorOverlay();
    if (overlay) overlay.style.display = "none";
  }

  function initCursorOverlay() {
    const overlay = getCursorOverlay();
    if (!overlay) return;
    overlay.style.opacity = String(state?.cursor_overlay_opacity ?? 0.95);
    // The fixed-card era uses CSS for visibility; no cursor-following here anymore.
}

  /* ---------- Mises à jour ---------- */
  /** Extrait les notes dans la langue de l'app depuis le format [FR]/[EN]. */
  function pickNotes(raw) {
    const text = String(raw || "").trim();
    if (!text) return "";
    const lang = (TT.i18n && TT.i18n.current && TT.i18n.current()) || "fr";
    const want = lang.startsWith("en") ? "EN" : lang.startsWith("fr") ? "FR" : null;
    // Extraire les sections [FR] et [EN]
    const sections = {};
    const re = /\[(FR|EN)\]\s*\n([\s\S]*?)(?=\n\[(?:FR|EN)\]|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) sections[m[1]] = m[2].trim();
    // Choisir la langue de l'app, sinon l'autre langue, sinon tout le texte
    if (want && sections[want]) return sections[want];
    if (sections.FR) return sections.FR;
    if (sections.EN) return sections.EN;
    return text;
  }
  function showUpdateBar(u) {
    $("update-title").textContent = t("upd.available", { version: u.version, current: u.current });
    $("update-version").textContent = `v${u.version}`;
    const notes = pickNotes(u.notes);
    $("update-notes").textContent = notes;
    $("update-install").disabled = false;
    $("update-manual").hidden = true;
    $("update-bar").hidden = false;
  }
  async function checkUpdates(manual) {
    if (DEMO) { if (manual) TT.notify(t("upd.appOnly"), "warn"); return; }
    try {
      const u = await invoke("check_update");
      if (!u) { if (manual) TT.notify(t("upd.upToDate"), "ok"); return; }
      showUpdateBar(u);
    } catch (e) {
      // Serveur injoignable (dépôt pas encore configuré) : silencieux au démarrage, visible si demandé.
      if (manual) TT.warn(t("upd.checkFailed", { err: e }));
    }
  }
  async function installUpdate() {
    $("update-install").disabled = true;
    $("update-manual").hidden = true;
    $("update-title").textContent = t("upd.downloading");
    $("update-notes").textContent = "";
    try { await invoke("install_update"); }
    catch (e) {
      // La mise à jour automatique a échoué : on garde le bandeau, on explique, et on propose de
      // télécharger l'installateur à la main. L'utilisateur n'est jamais bloqué.
      $("update-install").disabled = false;
      $("update-title").textContent = t("upd.failed");
      $("update-notes").textContent = String(e);
      $("update-manual").hidden = false;
    }
  }
  async function openManualDownload() {
    try { await invoke("open_releases"); TT.notify(t("upd.manualOpened"), "ok"); }
    catch (e) { TT.warn(t("upd.checkFailed", { err: e })); }
  }

  /* ---------- État des données ---------- */
  function renderBadges() {
    const st = TT.store;
    if (!st.S.idx) { $("badge-q").hidden = true; $("badge-i").hidden = true; return; }
    const q = st.startedTasks().length, i = st.neededItems().size;
    $("badge-q").hidden = !q; $("badge-q").textContent = q ? `> ${q}` : "";
    $("badge-i").hidden = !i; $("badge-i").textContent = i || "";
    $("badge-q").title = `${q} ${t("misc.questCount")}`; $("badge-i").title = `${i} ${t("misc.itemCount")}`;
  }
  function renderSyncNote() {
    const sy = TT.store.S.sync, el = $("sync-note");
    el.textContent = sy.busy ? t("misc.syncing") : sy.lastAt ? t("misc.syncNote", { ago: TT.store.agoMs(sy.lastAt) }) : "";
    el.title = "";
  }
  function renderStatus() {
    const S = TT.store.S;
    const el = $("data-status");
    if (S.busy) el.textContent = S.busy;
    else if (S.error && S.retryAt) el.textContent = t("misc.serverDown", { time: new Date(S.retryAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) });
    else if (S.data) el.textContent = t("misc.dataAgo", { ago: TT.store.ago(S.data.fetchedAt) });
    else el.textContent = t("misc.noDataShort");
    $("refresh-btn").disabled = !!S.busy;
    if (S.error) TT.warn(S.error);
  }

  /* ---------- Réglages ---------- */
  const fmtBytes = (n) => {
    if (n > 1048576) return (n / 1048576).toFixed(1) + " " + t("misc.mb");
    return Math.max(1, Math.round(n / 1024)) + " " + t("misc.kb");
  };
  function fmtDiag(d) {
    const L = [];
    L.push(`${t("diag.logsDir")} : ${d.logs_dir || t("diag.notFound")} (${d.logs_dir_source})`);
    L.push(`${t("diag.logSessions")} : ${d.sessions}${d.latest_session ? " · " + t("diag.latest") + " : " + d.latest_session : ""}`);
    if (d.files.length) {
      L.push(t("diag.lastSessionFiles") + " :");
      d.files.forEach((f) => L.push(`  ${f.name} · ${fmtBytes(f.bytes)} · ${t("diag.modified")} ${f.modified_secs_ago == null ? "?" : t("diag.ago", { secs: f.modified_secs_ago })}`));
    }
    L.push(`${t("diag.lastMapInLogs")} : ${d.last_map_raw ? d.last_map_raw + " → " + (d.last_map_slug || t("diag.unknown")) : t("diag.none")}`);
    L.push(`${t("diag.locationLines")} : ${d.location_lines}`);
    L.push(`${t("diag.questEvents")} : ${d.task_events_latest_session}`);
    const dq = TT.store.S.data && TT.store.S.data.quality;
    L.push(dq
      ? `${t("diag.dataQuality")} : ${dq.tasks} ${t("diag.quests")} · ${dq.tasks_with_trader} ${t("diag.withTrader")} · ${dq.objectives_with_zone}/${dq.objectives} ${t("diag.objectivesPlaced")} · ${dq.items} ${t("diag.items")} (${dq.items_with_category} ${t("diag.withCategory")}, ${dq.items_with_price} ${t("diag.withPrice")}) · ${dq.maps} ${t("diag.maps")}, ${dq.extracts} ${t("diag.extracts")}, ${dq.containers} ${t("diag.containers")} (${dq.containers_named} ${t("diag.named")}) · ${dq.loose_points} ${t("diag.lootSpots")} · ${dq.locks || 0} ${t("diag.locks")} · ${t("diag.hideout")} : ${dq.hideout_stations || 0} ${t("diag.stations")}, ${dq.hideout_items || 0} ${t("diag.itemsRequired")}`
      : t("diag.noData"));
    L.push(`${t("diag.lastMapEvent")} : ${lastMapEvent || t("diag.none")}`);
    L.push(`${t("diag.screenshots")} : ${d.screenshots_dir} (${d.screenshots_dir_exists ? t("diag.exists") : t("diag.absent")})${d.newest_screenshot ? " · " + t("diag.newest") + " : " + d.newest_screenshot : ""}`);
    L.push("", t("diag.conclusion") + " :");
    d.hints.forEach((h) => L.push("  - " + h));
    if (d.recent_lines.length) { L.push("", t("diag.recentLogLines") + " :"); d.recent_lines.forEach((l) => L.push("  " + l)); }
    if (d.tried.length) { L.push("", t("diag.checkedPaths") + " :"); d.tried.slice(0, 12).forEach((tp) => L.push("  " + tp)); }
    return L.join("\n");
  }
  function fmtDiag(d) {
    const L = [];
    L.push(`Dossier des logs : ${d.logs_dir || "introuvable"} (${d.logs_dir_source})`);
    L.push(`Sessions de logs : ${d.sessions}${d.latest_session ? " · dernière : " + d.latest_session : ""}`);
    if (d.files.length) {
      L.push("Fichiers de la dernière session :");
      d.files.forEach((f) => L.push(`  ${f.name} · ${fmtBytes(f.bytes)} · modifié ${f.modified_secs_ago == null ? "?" : "il y a " + f.modified_secs_ago + " s"}`));
    }
    L.push(`Dernière map trouvée dans les logs : ${d.last_map_raw ? d.last_map_raw + " → " + (d.last_map_slug || "non reconnue") : "aucune"}`);
    L.push(`Lignes « Location: » : ${d.location_lines}`);
    L.push(`Évènements de quête (dernière session) : ${d.task_events_latest_session}`);
    const dq = TT.store.S.data && TT.store.S.data.quality;
    L.push(dq
      ? `Données (json.tarkov.dev) : ${dq.tasks} quêtes dont ${dq.tasks_with_trader} avec marchand ; ${dq.objectives_with_zone}/${dq.objectives} objectifs placés sur une carte ; ${dq.items} objets (${dq.items_with_category} avec catégorie, ${dq.items_with_price} avec prix) ; ${dq.maps} cartes, ${dq.extracts} extractions, ${dq.containers} conteneurs (${dq.containers_named} nommés), ${dq.loose_points} emplacements de loot au sol, ${dq.locks || 0} verrous ; hideout : ${dq.hideout_stations || 0} station(s), ${dq.hideout_items || 0} objet(s) requis`
      : "Données : pas encore téléchargées (ou ancien format)");
    L.push(`Dernier évènement de map reçu par l'app : ${lastMapEvent || "aucun depuis le lancement"}`);
    L.push(`Captures : ${d.screenshots_dir} (${d.screenshots_dir_exists ? "existe" : "absent"})${d.newest_screenshot ? " · la plus récente : " + d.newest_screenshot : ""}`);
    L.push("", "Conclusion :");
    d.hints.forEach((h) => L.push("  - " + h));
    if (d.recent_lines.length) { L.push("", "Dernières lignes du log (identifiants masqués) :"); d.recent_lines.forEach((l) => L.push("  " + l)); }
    if (d.tried.length) { L.push("", "Emplacements vérifiés automatiquement :"); d.tried.slice(0, 12).forEach((t) => L.push("  " + t)); }
    return L.join("\n");
  }
  async function runDiag() {
    const out = $("diag-out");
    if (DEMO) { out.className = "diag-out"; out.textContent = t("diag.appOnly"); return; }
    out.className = "diag-out"; out.textContent = t("diag.running");
    diagText = "";
    try { renderDiag(await invoke("diagnose")); }
    catch (e) { diagText = t("diag.failed", { err: e }); out.className = "diag-out has-error"; out.textContent = diagText; }
  }

  /* ---------- Diagnostic (débogage) ---------- */
  let diagText = "";
  const SEV_LABEL = { error: "diag.sev.error", warn: "diag.sev.warn", ok: "diag.sev.ok" };
  const SEV_ORDER = { error: 0, warn: 1, ok: 2 };

  /** Liste des points à afficher : le format structuré s'il existe, sinon les anciens « hints ». */
  function diagIssues(d) {
    if (Array.isArray(d.issues) && d.issues.length) return d.issues;
    return (d.hints || []).map((h) => ({
      severity: /en ordre|rien à signaler/i.test(h) ? "ok" : "warn",
      title: h, detail: "", fix: "",
    }));
  }
  /** Affiche le verdict en clair : d'abord ce qui cloche, puis le détail technique repliable. */
  function renderDiag(d) {
    diagText = fmtDiag(d);
    const out = $("diag-out");
    const issues = diagIssues(d);
    const errs = issues.filter((i) => i.severity === "error").length;
    const warns = issues.filter((i) => i.severity === "warn").length;
    const state = errs ? "error" : warns ? "warn" : "ok";
    const verdict = errs
      ? t("diag.verdict.err", { n: errs }) + (warns ? t("diag.verdict.more", { n: warns }) : "")
      : warns ? t("diag.verdict.warn", { n: warns }) : t("diag.verdict.ok");
    const cards = [...issues]
      .sort((a, b) => (SEV_ORDER[a.severity] ?? 3) - (SEV_ORDER[b.severity] ?? 3))
      .map((i) => `<div class="diag-card ${esc(i.severity)}"><div class="diag-head"><span class="diag-sev">${esc(t(SEV_LABEL[i.severity] || "diag.sev.ok"))}</span><b>${esc(i.title)}</b></div>` +
        (i.detail ? `<p class="diag-detail">${esc(i.detail)}</p>` : "") +
        (i.fix ? `<p class="diag-fix"><b>${esc(t("diag.fix"))}</b> ${esc(i.fix)}</p>` : "") + "</div>").join("");
    out.className = "diag-out has-" + state;
    out.innerHTML =
      `<div class="diag-verdict ${state}">${esc(verdict)}</div>` + cards +
      `<details class="diag-raw"><summary>${esc(t("diag.raw"))}</summary><pre>${esc(diagText)}</pre></details>`;
  }

  async function copyDiag() {
    const text = diagText || $("diag-out").textContent;
    try { await navigator.clipboard.writeText(text); TT.warn(t("diag.copied")); }
    catch (_) {
      const pre = $("diag-out").querySelector("pre") || $("diag-out");
      const r = document.createRange(); r.selectNodeContents(pre);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      TT.warn(t("diag.selectManually"));
    }
  }

  /* ---------- Thèmes ---------- */
  function themeOptions(sel) {
    const cur = sel.value;
    sel.innerHTML = TT.theme.list.map(([id, key]) => `<option value="${esc(id)}">${esc(t(key))}</option>`).join("");
    if (cur) sel.value = cur;
  }
  function initTheme() {
    const sel = $("s-theme");
    if (!sel || !TT.theme) return;
    themeOptions(sel);
    sel.value = TT.theme.current();
    sel.addEventListener("change", () => TT.theme.set(sel.value));
    TT.i18n.onChange(() => themeOptions(sel));
  }

  function openSettings(withDiag) {
    $("s-shots").value = (state && state.screenshots_dir) || "";
    $("s-logs").value = (state && state.logs_dir) || "";
    $("s-delete").checked = !!(state && state.delete_screenshots);
    $("s-lang").value = TT.store.S.lang;
    $("s-mode").value = (state && state.game_mode) || TT.store.S.mode;
    $("s-autostart").checked = !!(state && state.auto_start);
    $("s-totray").checked = !!(state && state.close_to_tray);
    $("s-startmin").checked = !!(state && state.start_minimized);
    $("s-ontop").checked = !!(state && state.always_on_top);
    $("s-updates").checked = !state || state.check_updates !== false;
    $("s-cursor-overlay").checked = !!(state && state.cursor_overlay_enabled);
    $("s-capture-hotkey").value = (state && state.overlay_capture_hotkey) || "F2";
    $("s-toggle-hotkey").value = (state && state.overlay_toggle_hotkey) || "Shift+F2";
    $("s-game-lang").value = (state && state.overlay_game_lang) || "en";
    $("s-autohide").value = (state && state.overlay_autohide_sec) || 8;
    $("s-hint").innerHTML = t("set.hint", { path: "<code>…\\Escape from Tarkov\\build\\Logs</code>" });
    $("settings").showModal();
    // Un souci est déjà connu (logs introuvables) : on montre le diagnostic tout de suite.
    if (withDiag === true || (!DEMO && TT.logsOk === false)) { $("diag").open = true; runDiag(); }
  }
  TT.openSettings = openSettings;
  async function saveSettings() {
    const settings = {
      screenshots_dir: $("s-shots").value.trim() || null,
      logs_dir: $("s-logs").value.trim() || null,
      delete_screenshots: $("s-delete").checked,
      lang: $("s-lang").value,
      game_mode: $("s-mode").value,
      auto_start: $("s-autostart").checked,
      close_to_tray: $("s-totray").checked,
      start_minimized: $("s-startmin").checked,
      always_on_top: $("s-ontop").checked,
      check_updates: $("s-updates").checked,
      cursor_overlay_enabled: $("s-cursor-overlay").checked,
      cursor_overlay_opacity: state?.cursor_overlay_opacity ?? 0.95,
      overlay_capture_hotkey: $("s-capture-hotkey").value.trim() || "F2",
      overlay_toggle_hotkey: $("s-toggle-hotkey").value.trim() || "Shift+F2",
      overlay_game_lang: $("s-game-lang").value,
      overlay_autohide_sec: parseInt($("s-autohide").value, 10) || 8,
    };
    try {
      shown.clear(); $("warnings").textContent = "";
      state = await invoke("apply_settings", { settings });
      state.warnings.forEach(TT.warn);
      TT.logsOk = !!state.logs_dir; TT.mapview.updateChip(); TT.quests.render();
      applyOnTopUi(state.always_on_top);
      applyModeUi(state.game_mode);
      // Apply cursor overlay setting
      if (!DEMO) {
        cursorOverlayEnabled = state.cursor_overlay_enabled;
        try {
          // toggle_overlay(active=true) starts the sidecar + shows the fixed card.
          // toggle_overlay(false) stops the sidecar. The capture itself is fired
          // by the registered global hotkey (F2 by default).
          await invoke("toggle_overlay", { enabled: state.cursor_overlay_enabled });
          hideCursorOverlay();
        } catch (e) { console.error("Overlay start error:", e); }
      }
      if (TT.logsOk) TT.store.rescan(true);
    } catch (e) { TT.warn(t("set.saveFailed", { err: e })); }
    const lang = $("s-lang").value;
    if (lang !== TT.store.S.lang) TT.store.setLang(lang);
  }

  /* ---------- Fenêtre au premier plan, mode de jeu ---------- */
  function applyOnTopUi(on) {
    const b = $("ontop-btn");
    if (!b) return;
    b.setAttribute("aria-pressed", String(!!on));
    b.classList.toggle("on", !!on);
    b.title = on ? t("nav.ontop.on") : t("nav.ontop");
  }
  async function toggleOnTop() {
    if (DEMO) { TT.notify(t("misc.demoOnly"), "warn"); return; }
    const on = $("ontop-btn").getAttribute("aria-pressed") !== "true";
    try { state = await invoke("set_always_on_top", { on }); applyOnTopUi(state.always_on_top); }
    catch (e) { TT.warn(String(e)); }
  }
  function applyModeUi(mode) {
    const b = $("mode-badge");
    if (b) b.textContent = TT.store.MODE_LABEL[mode] || mode || "PvP";
  }
  async function setMode(mode) {
    await TT.store.setGameMode(mode);
    applyModeUi(mode);
    if (!DEMO) { try { state = await invoke("set_game_mode", { mode }); } catch (e) { TT.warn(String(e)); } }
    TT.notify(t("misc.modeChanged", { mode: TT.store.MODE_LABEL[mode] || mode }), "ok");
  }
  async function cycleMode() {
    const order = ["PvP", "PvE", "Season"];
    const next = order[(order.indexOf(TT.store.S.mode) + 1) % order.length];
    await setMode(next);
  }

  /* ---------- Démarrage ---------- */
  async function main() {
    // La langue choisie pilote toute l'interface : on l'applique avant le premier rendu.
    TT.i18n.setLang(TT.store.S.lang);
    TT.mapDefs = await (await fetch("maps.json")).json();
    TT.mapview.init(TT.mapDefs);
    TT.quests.init();
    TT.items.init();
    if (TT.hideout) TT.hideout.init();
    TT.catchup.init();

    document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => TT.nav.show(b.dataset.view)));
    $("refresh-btn").addEventListener("click", () => TT.store.refresh());
    $("settings-btn").addEventListener("click", () => openSettings());
    $("ontop-btn").addEventListener("click", toggleOnTop);
    $("mode-badge").addEventListener("click", cycleMode);
    $("update-install").addEventListener("click", installUpdate);
    $("update-manual").addEventListener("click", openManualDownload);
    $("update-later").addEventListener("click", () => { $("update-bar").hidden = true; });
    $("s-check-now").addEventListener("click", () => checkUpdates(true));
    $("s-tour").addEventListener("click", () => {
      if ($("settings").close) $("settings").close(); else $("settings").open = false;
      TT.tour.reset();
    });
    initTheme();
    $("lookup-q").addEventListener("input", renderLookupResults);
    $("lookup-close").addEventListener("click", closeLookup);
    $("lookup-res").addEventListener("click", (e) => {
      const b = e.target.closest("[data-res]");
      if (!b) return;
      const r = ($("lookup-res")._res || [])[+b.dataset.res];
      if (!r) return;
      if (r.kind === "item") showLookupCard(r.id);
      else if (r.kind === "quest") { closeLookup(); TT.nav.show("quests"); TT.quests.select(r.id); }
      else if (r.kind === "map") { closeLookup(); TT.nav.show("map"); TT.mapview.showSlug(r.id); }
    });
    $("lookup-card").addEventListener("click", (e) => {
      const b = e.target.closest("[data-task],[data-loc]");
      if (!b) return;
      const id = $("lookup-card").dataset.id;
      if (b.dataset.task) { closeLookup(); TT.nav.show("quests"); TT.quests.select(b.dataset.task); }
      else if (b.dataset.loc && TT.mapview.locateItem(id, b.dataset.loc)) { closeLookup(); TT.nav.show("map"); }
    });
    $("diag-run").addEventListener("click", runDiag);
    $("diag-copy").addEventListener("click", copyDiag);
    $("settings-form").addEventListener("submit", (e) => { if (e.submitter && e.submitter.value === "save") saveSettings(); });

    // Saisie des raccourcis : cliquer dans le champ puis appuyer sur la
    // combinaison écrit directement « Ctrl+Shift+F2 » etc. Évite les fautes de
    // frappe qui rendaient les raccourcis inenregistrables côté Rust.
    const bindHotkeyInput = (id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("keydown", (e) => {
        if (e.key === "Tab" || e.key === "Escape") return;
        e.preventDefault();
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        const mods = [];
        if (e.ctrlKey) mods.push("Ctrl");
        if (e.altKey) mods.push("Alt");
        if (e.shiftKey) mods.push("Shift");
        let key = e.key;
        if (key === " ") key = "Space";
        else if (key.length === 1) key = key.toUpperCase();
        else if (key.startsWith("Arrow")) key = key.replace("Arrow", "");
        el.value = [...mods, key].join("+");
      });
      el.addEventListener("focus", () => el.select());
    };
    bindHotkeyInput("s-capture-hotkey");
    bindHotkeyInput("s-toggle-hotkey");
    TT.store.on((k) => {
      if (k === "status" || k === "data") renderStatus();
      if (k === "progress" || k === "data") renderBadges();
      if (k === "sync" || k === "progress") renderSyncNote();
    });

    // Les évènements de quêtes ne doivent être appliqués qu'une fois la progression sauvegardée relue.
    const ready = TT.store.load();
    await listen("position", (e) => TT.mapview.onPosition(e.payload));
    await listen("map", (e) => {
      lastMapEvent = `${e.payload.raw} → ${e.payload.slug || "non reconnue"}${e.payload.from_scene ? " (via la scène chargée)" : ""} à ${new Date().toLocaleTimeString("fr-FR")}`;
      TT.mapview.onMap(e.payload);
    });
    await listen("warning", (e) => TT.warn(e.payload));
    await listen("task", (e) => ready.then(() => TT.store.applyTaskEvent(e.payload)));
    if (!DEMO) {
      state = await invoke("get_state");
      state.warnings.forEach(TT.warn);
      applyOnTopUi(state.always_on_top);
      applyModeUi(state.game_mode || TT.store.S.mode);
      TT.logsOk = !!state.logs_dir; TT.mapview.updateChip(); TT.quests.render();
      if (state.map) TT.mapview.onMap(state.map);
      if (state.position) TT.mapview.onPosition(state.position);
    } else {
      TT.warn(t("misc.demoMode"));
      applyModeUi(TT.store.S.mode);
      TT.mapview.showSlug(TT.mapview.resolveSlug() || "customs");
      const def = TT.mapDefs.find((m) => m.slug === TT.mapview.current().slug);
      const b = def.bounds;
      setTimeout(() => TT.mapview.onPosition({ x: (b[0][0] + b[1][0]) / 2, y: 3.2, z: (b[0][1] + b[1][1]) / 2, fx: 0.7, fz: 0.7, yaw_deg: 45, file: "demo" }), 400);
    }
    await ready;
    renderStatus(); renderBadges();
    // Initialise l'overlay prix : applique l'opacité du paramètre et active
    // l'état mémorisé (la case "s-cursor-overlay" dans les réglages).
    if (!DEMO && state?.cursor_overlay_enabled) {
      initCursorOverlay();
    }
    // Resynchronisation complète au démarrage : rattrape tout ce qui s'est passé pendant que l'app était fermée.
    if (!DEMO && TT.logsOk) TT.store.rescan(true).then((r) => {
      if (r && (r.changed || r.inferred)) {
        const extra = r.inferred ? t("misc.inferred", { n: r.inferred }) : "";
        TT.notify(t("misc.synced", { n: r.changed }) + extra + ".", "ok");
      }
    });
    TT.nav.show(localStorage.getItem("view") || "map");
    // Visite guidée au tout premier lancement (rejouable depuis Réglages).
    TT.tour.maybeStart();
    // Vérification des mises à jour au démarrage (désactivable dans Réglages). Silencieuse si rien.
    if (!DEMO && state && state.check_updates !== false) checkUpdates(false);
    // Changement de langue : on redessine tout ce qui dépend de l'interface.
    TT.i18n.onChange(() => { renderStatus(); renderBadges(); renderSyncNote(); applyOnTopUi($("ontop-btn").getAttribute("aria-pressed") === "true"); });
  }

  main().catch((e) => TT.warn(t("misc.startError", { err: e.message || e })));
})();
