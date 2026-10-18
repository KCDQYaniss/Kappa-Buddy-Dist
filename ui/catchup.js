"use strict";
// Rattrapage : marquer en masse les quêtes déjà terminées avant que l'app ne suive les logs.
// L'intérêt : marquer une quête avancée marque automatiquement tous ses prérequis (déduction),
// donc quelques clics suffisent à remplir tout l'arbre en amont.
(function () {
  const TT = (window.TT = window.TT || {});
  const $ = (id) => document.getElementById(id);
  const t = (k, p) => TT.i18n.t(k, p);
  const esc = (s) => TT.store.esc(s);
  const MAX = 250;   // on n'affiche pas 500 lignes d'un coup : la recherche affine.

  const F = { q: "", state: "notdone" };

  function quests() {
    const idx = TT.store.S.idx;
    if (!idx) return [];
    const st = TT.store;
    const q = F.q.trim().toLowerCase();
    let list = Object.values(idx.tasks);
    if (F.state === "locked") list = list.filter((x) => st.stateOf(x) === "locked");
    else if (F.state === "notdone") list = list.filter((x) => st.stateOf(x) !== "finished");
    else if (F.state === "started") list = list.filter((x) => st.stateOf(x) === "started");
    else if (F.state === "failed") list = list.filter((x) => st.stateOf(x) === "failed");
    else if (F.state === "finished") list = list.filter((x) => st.stateOf(x) === "finished");
    if (q) list = list.filter((x) => x.name.toLowerCase().includes(q));
    list.sort((a, b) => (a.minPlayerLevel || 0) - (b.minPlayerLevel || 0) || a.name.localeCompare(b.name));
    return list;
  }

  function summary() {
    const st = TT.store, S = st.S;
    const done = Object.keys(S.progress.tasks).filter((id) => S.progress.tasks[id] === "finished").length;
    const inferred = Object.keys(S.progress.inferred).length;
    $("cu-summary").textContent = t("cu.summary", { done, inferred });
  }

  function render() {
    const st = TT.store;
    if (!st.S.idx) {
      $("cu-list").innerHTML = `<p class="dim pad">${esc(st.emptyMessage())}</p>`;
      $("cu-count").textContent = "";
      return;
    }
    const list = quests();
    $("cu-count").textContent = t("i.count", { n: list.length });
    const shown = list.slice(0, MAX);
    $("cu-list").innerHTML = shown.map((x) => {
      const s = st.stateOf(x), fin = s === "finished", lck = s === "locked";
      return `<button class="curow st-${s}${fin ? " done" : ""}${lck ? " locked" : ""}" data-id="${esc(x.id)}" type="button">` +
        `<i class="cucheck" aria-hidden="true"></i>` +
        `<span class="cun">${esc(x.name)}${lck ? `<span class="cus">${esc(t("cu.state.locked"))}</span>` : ""}</span>` +
        `<span class="cum">${esc(x.trader ? x.trader.name : "")}</span>` +
        `<em class="cul">${esc(t("q.lvlShort", { n: x.minPlayerLevel || 1 }))}</em></button>`;
    }).join("") + (list.length > MAX ? `<p class="dim pad">${esc(t("cu.more", { n: list.length - MAX }))}</p>` : "") ||
      `<p class="dim pad">${esc(t("cu.none"))}</p>`;
    summary();
  }

  function open() {
    F.q = ""; F.state = "notdone";
    $("cu-search").value = "";
    $("cu-state").value = "notdone";
    // Force la mise à jour des traductions dans le dialogue
    if (window.TT && TT.i18n) TT.i18n.apply($("catchup"));
    render();
    $("catchup").showModal();
  }
  const close = () => { if ($("catchup").close) $("catchup").close(); else $("catchup").open = false; };

  function init() {
    $("q-catchup").addEventListener("click", open);
    $("cu-close").addEventListener("click", close);
    $("cu-search").addEventListener("input", (e) => { F.q = e.target.value; render(); });
    $("cu-state").addEventListener("change", (e) => { F.state = e.target.value; render(); });
    $("cu-list").addEventListener("click", (e) => {
      const b = e.target.closest("[data-id]");
      if (!b) return;
      const id = b.dataset.id, st = TT.store;
      const isDone = st.stateOf(st.S.idx.tasks[id]) === "finished";
      st.setTaskStatus(id, isDone ? null : "finished");
      render();
    });

    // --- OCR ---
    const btn = $("cu-ocr-btn");
    const pickerBtn = $("cu-ocr-pick");
    const cancel = $("cu-ocr-cancel");
    btn.addEventListener("click", runLatestOcr);
    pickerBtn.addEventListener("click", handleOpenOcr);
    $("cu-ocr-open").addEventListener("click", handleOpenOcr);
    cancel.addEventListener("click", closeOcr);
    $("cu-ocr-apply").addEventListener("click", applyOcr);
    $("cu-ocr-file").addEventListener("change", runSelectedOcr);
    // Un seul écouteur délégué pour tout le panneau OCR : choisir l'état d'une quête.
    $("cu-ocr-results").addEventListener("click", (e) => {
      const pick = e.target.closest(".state-pick");
      if (!pick) return;
      e.preventDefault();
      const row = pick.closest(".ocr-row");
      if (!row) return;
      ocrState.set(row.dataset.id, pick.dataset.pick);
      renderOcrResults();
    });

    // Le reste de l'app peut changer la progression pendant que le panneau est ouvert.
    TT.store.on((k) => { if (k === "progress") render(); });
    TT.i18n.onChange(render);
  }

  /* ================= OCR depuis une capture d'écran ================= */

  // Quêtes accumulées depuis un ou plusieurs screenshots (persistance locale pour reprise).
  let ocrSeen = new Map();
  // État sélectionné pour chaque quête: "notdone" | "started" | "failed" | "finished"
  let ocrState = new Map();

  // Normalise une chaîne pour la comparaison : minuscules, sans accents, sans ponctuation.
  function norm(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  }

  // Distance de Levenshtein (programmation dynamique, deux lignes).
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), curr = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, curr] = [curr, prev];
    }
    return prev[n];
  }

  // Similarité de 0 à 1 entre deux chaînes normalisées.
  function similar(a, b) {
    if (!a || !b) return 0;
    const d = lev(a, b);
    return 1 - d / Math.max(a.length, b.length);
  }

  // États proposés par le sélecteur, dans l'ordre d'affichage.
  const STATES = ["notdone", "started", "failed", "finished"];

  // Trouve les quêtes correspondant aux lignes OCR. Retourne un tableau {id, name, line, score}.
  const OCR_THRESHOLD = 0.72;
  function matchQuests(lines) {
    const idx = TT.store.S.idx;
    if (!idx || !lines.length) return [];
    const tasks = Object.values(idx.tasks);
    const found = new Map();
    for (const line of lines) {
      const n = norm(line);
      if (n.length < 4) continue;
      let best = null, bestScore = 0;
      for (const task of tasks) {
        // Le jeu peut être dans une autre langue que l'app : on compare aussi au nom
        // normalisé anglais (`normalizedName`), qui reflète le libellé anglais du jeu.
        let s = similar(n, norm(task.name));
        if (task.normalizedName) s = Math.max(s, similar(n, norm(task.normalizedName)));
        if (s > bestScore) { bestScore = s; best = task; }
      }
      if (best && bestScore >= OCR_THRESHOLD && !found.has(best.id)) {
        found.set(best.id, { id: best.id, name: best.name, line, score: bestScore });
      }
    }
    return [...found.values()].sort((a, b) => b.score - a.score);
  }

  function closeOcr() {
    ocrSeen.clear();
    ocrState.clear();
    $("cu-ocr").hidden = true;
    $("cu-list").hidden = false;
    $("cu-search").parentElement.hidden = false;
    render();
  }

  async function loadScreenshots() {
    const sel = $("cu-ocr-file");
    sel.innerHTML = "";
    try {
      const files = await TT.store.invoke("screenshots_list");
      if (!files.length) { $("cu-ocr-status").textContent = t("cu.ocr.none"); return; }
      files.slice(0, 30).forEach((f, i) => {
        const o = document.createElement("option");
        o.value = f;
        o.textContent = f.split(/[\\\/]/).pop();
        sel.appendChild(o);
      });
      sel.value = files[0]; // pré-sélectionne la plus récente
    } catch (e) { $("cu-ocr-status").textContent = t("cu.ocr.status.error", { msg: String(e) }); }
  }

  /** Lit la capture la plus récente du dossier Screenshots. */
  async function runLatestOcr() {
    $("cu-ocr-picker").hidden = true;
    // On cumule les quêtes de plusieurs captures sans effacer celles déjà trouvées.
    $("cu-ocr-status").textContent = t("cu.ocr.status.reading");
    $("cu-ocr-apply").disabled = true;
    try {
      const lines = await TT.store.invoke("read_screen_text", { path: null });
      $("cu-ocr-status").textContent = t("cu.ocr.status.matching");
      const found = matchQuests(lines);
      for (const f of found) {
        // On garde la meilleure reconnaissance (meilleur score) pour chaque quête.
        const existing = ocrSeen.get(f.id);
        if (!existing || f.score > existing.score) ocrSeen.set(f.id, f);
      }
      renderOcrResults();
    } catch (e) {
      $("cu-ocr-status").textContent = t("cu.ocr.status.error", { msg: String(e) });
    }
  }

  /** Lit la capture sélectionnée dans le `<select>` ci-dessus. */
  async function runSelectedOcr() {
    const file = $("cu-ocr-file").value;
    if (!file) return;
    $("cu-ocr-status").textContent = t("cu.ocr.status.reading");
    $("cu-ocr-apply").disabled = true;
    try {
      const lines = await TT.store.invoke("read_screen_text", { path: file });
      $("cu-ocr-status").textContent = t("cu.ocr.status.matching");
      const found = matchQuests(lines);
      for (const f of found) {
        // On garde la meilleure reconnaissance (meilleur score) pour chaque quête.
        const existing = ocrSeen.get(f.id);
        if (!existing || f.score > existing.score) ocrSeen.set(f.id, f);
      }
      renderOcrResults();
    } catch (e) {
      $("cu-ocr-status").textContent = t("cu.ocr.status.error", { msg: String(e) });
    }
  }

  /** Ouvre le panneau OCR, charge la liste des captures et laisse l'utilisateur choisir. */
  async function handleOpenOcr() {
    $("cu-list").hidden = true;
    $("cu-search").parentElement.hidden = true;
    $("cu-ocr").hidden = false;
    $("cu-ocr-status").textContent = "";
    $("cu-ocr-results").innerHTML = "";
    $("cu-ocr-apply").disabled = true;
    $("cu-ocr-picker").hidden = false;
    // Ne PAS vider ici : les captures précédentes sont cumulées tant que le dialogue reste ouvert.
    // Les effacer seulement si l'utilisateur ferme puis rouvre le dialogue.
    await loadScreenshots();
    // Ne PAS lire automatiquement — laisser l'utilisateur choisir dans la liste ou cliquer "Lire la dernière".
  }

  /** Pastilles d'état d'une ligne : une par état, coche dans celle qui est choisie. */
  function statePicksHtml(current) {
    return `<span class="state-picks" role="group">` + STATES.map((s) => {
      const label = esc(t("cu.ocr.state." + s));
      return `<button type="button" class="state-pick s-${s}${s === current ? " on" : ""}" data-pick="${s}"` +
        ` aria-pressed="${s === current}" title="${label}" aria-label="${label}"></button>`;
    }).join("") + `</span>`;
  }

  function renderOcrResults() {
    const st = TT.store;
    const found = [...ocrSeen.values()].sort((a, b) => b.score - a.score);
    const box = $("cu-ocr-results");
    if (!found.length) {
      $("cu-ocr-status").textContent = t("cu.ocr.status.none");
      box.innerHTML = "";
      return;
    }
    $("cu-ocr-status").textContent = t("cu.ocr.status.done", { n: found.length });

    const legend = `<div class="cu-legend">` +
      STATES.map((s) => `<span class="lg s-${s}"><i></i>${esc(t("cu.ocr.state." + s))}</span>`).join("") +
      `<span class="cu-legend-text">${esc(t("cu.ocr.legend"))}</span></div>`;

    // Dans l'OCR, seules les quêtes ACCESSIBLES sont visibles. Les quêtes verrouillées
    // (prérequis non remplis) n'apparaissent pas sur l'écran du jeu, donc on ignore leur état.
    // On utilise l'état connu dans la progression quand il est valide, sinon "notdone".
    box.innerHTML = legend + found.map((f) => {
      const pct = Math.round(f.score * 100);
      const task = st.S.idx && st.S.idx.tasks[f.id];
      // Priorité au choix utilisateur (ocrState), sinon état de la progression.
      const known = ocrState.get(f.id) || (task ? st.stateOf(task) : "notdone");
      const state = STATES.includes(known) ? known : "notdone";
      // Si le texte reconnu diffère du nom affiché (jeu dans une autre langue), on le montre.
      const src = f.line && norm(f.line) !== norm(f.name) ? `<em class="src">${esc(f.line)}</em>` : "";
      return `<div class="curow ocr-row" data-id="${esc(f.id)}">` +
        `<label class="ocr-name"><input type="checkbox" class="ocr-check" checked><span class="cun">${esc(f.name)}${src}</span></label>` +
        statePicksHtml(state) +
        `<span class="ocr-pct">${pct}%</span>` +
      `</div>`;
    }).join("");
    $("cu-ocr-apply").disabled = false;
  }

  function applyOcr() {
    const st = TT.store;
    const rows = document.querySelectorAll("#cu-ocr-results .ocr-row input:checked");
    let count = 0;
    rows.forEach((cb) => {
      const row = cb.closest(".ocr-row");
      const id = row.dataset.id;
      const pick = row.querySelector(".state-pick.on");
      const newState = pick ? pick.dataset.pick : "notdone";

      // « Pas encore fait » = on retire le statut déjà enregistré.
      if (newState === "notdone") {
        if (st.S.progress.tasks[id]) { st.setTaskStatus(id, null); count++; }
      } else if (st.stateOf(st.S.idx.tasks[id]) !== newState) {
        st.setTaskStatus(id, newState);
        count++;
      }
    });
    ocrSeen.clear();
    ocrState.clear();
    renderOcrResults();
    $("cu-ocr-status").textContent = count > 0 ? t("cu.ocr.status.applied", { n: count }) : t("cu.ocr.status.nochange");
    render();
  }

  TT.catchup = { init, open, close };
})();