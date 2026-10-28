// Test de la carte overlay (ui/overlay.html) : chaque payload du backend est
// rendu une seule fois, sections configurables, style configurable, états neutres.
const { JSDOM, VirtualConsole } = require("jsdom");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "ui") + "/";

const html = fs.readFileSync(root + "overlay.html", "utf8")
  .replace(/<link[^>]*>/g, "");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const page = html.replace(/<script>[\s\S]*?<\/script>/, "");

const vc = new VirtualConsole();
vc.sendTo(console);
const dom = new JSDOM(page, { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/", virtualConsole: vc });
const w = dom.window;
const doc = w.document;
const $ = (id) => doc.getElementById(id);
const qs = (sel) => doc.querySelector(sel);
const hidden = (id) => $(id).hasAttribute("hidden") || !!$(id).hidden;
const text = (id) => ($(id).textContent || "").trim();

const calls = [];
let nextData = null;
let sizeCalls = [];
w.__TAURI__ = {
  core: {
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      if (cmd === "get_overlay_data") return nextData;
      if (cmd === "hide_overlay") return null;
      if (cmd === "set_overlay_size") { sizeCalls.push(args); return null; }
      return null;
    },
  },
};
w.eval(script);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Mock canonique : la même forme que debug_overlay_test (src-tauri/src/main.rs).
const RESULT = {
  item_name: "Test Item — Long Name Truncated At Thirty",
  short_name: "TestItem",
  width: 2, height: 1, weight: 1.3,
  icon: "https://assets.tarkov.dev/test.webp",
  flea_price: 50000, flea_low_24h: 45000, flea_high_24h: 55000,
  flea_last_offer_count: 42, flea_change_48h_pct: -3.4,
  trader_price: 30000,
  sell_for: [
    { name: "Therapist", price: 30000, min_level: 2 },
    { name: "Prapor", price: 22000, min_level: 1 },
    { name: "Skier", price: 18000, min_level: 1 },
  ],
  used_in_tasks: [
    { id: "t1", name: "Test Quest", count: 3, fir: true, kappa_required: true, task_status: null },
    { id: "t2", name: "Another Quest", count: 1, fir: false, kappa_required: false, task_status: "completed" },
  ],
  barters_for: [{ trader: "Prapor", level: 2, items: [{ count: 1, name: "Bandage" }, { count: 2, name: "Screw" }] }],
  barters_using: [{ trader: "Skier", level: 3, rewards: [{ count: 1, name: "AK-74N" }] }],
  buy_for: [{ name: "Therapist", price: 15000, min_level: 2 }],
  needed_for_hideout: [
    { station: "Medstation", level: 2, count: 3, fir: true },
    { station: "Intelligence Center", level: 1, count: 1, fir: false },
  ],
  crafts_for: [{ station: "Medstation", level: 2, duration_sec: 7200, items: [{ count: 1, name: "Splint" }] }],
  caliber: "Caliber545x39", caliber_display: "5.45x39",
  raw_text: "test item",
};
const DEF_CFG = { opacity: 0.95, scale: 1, sections: {} };

// L'Intl de jsdom suit navigator.language (« en-US » ici) : construire le
// format attendu avec LA MÊME locale que la carte utilise.
const fmt = (n) => new Intl.NumberFormat(w.navigator.language || "fr-FR").format(n);

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✅ " + msg); }
  else { failed++; console.error("  ❌ " + msg); }
}

async function feed(msg, payload) {
  nextData = payload;
  await wait(320);
  console.log(msg || "");
}

(async () => {
  console.log("— carte complète (mock canonique) —");
  await feed("", { status: "ok", seq: 1, result: RESULT, autohide: 8, cfg: DEF_CFG });
  ok(!$("cursor-overlay").classList.contains("hidden"), "carte affichée");
  ok(text("overlay-flea").includes(fmt(50000)) && /₽/.test(text("overlay-flea")), "prix flea formaté Tarkov");
  ok(/↘/.test(text("flea-trend")) && /3\.4%/.test(text("flea-trend")), "tendance 48h ↘ 3.4%");
  ok(/24h\s?45 k – 55 k/.test(text("overlay-flea-history")) && /42 offres/.test(text("overlay-flea-history")), "stats 24h + offres");
  ok(/Therapist/.test(text("overlay-trader")) && text("overlay-trader").includes(fmt(30000)), "meilleur marchand = sell_for[0]");
  ok(/Prapor\s?22 k · Skier\s?18 k/.test(text("overlay-traders-all")), "autres marchands");
  ok(text("overlay-slot").includes(fmt(25000)), "prix par slot = 50 000 / 2");
  ok(/⌖ 5\.45x39 · 1\.3 kg/.test(text("overlay-sub")), "sous-titre calibre + poids");
  ok($("overlay-icon").style.backgroundImage.includes("assets.tarkov.dev"), "icône chargée");
  ok(!hidden("sec-quests"), "section quête visible");
  ok(/×3/.test(text("overlay-quest-list")) && /⚑/.test(text("overlay-quest-list")) && /κ/.test(text("overlay-quest-list")), "quêtes : count/FIR/Kappa");
  ok(/done/.test($("overlay-quest-list").innerHTML) && /✓/.test(text("overlay-quest-list")), "quête terminée → ✓ + barrée");
  ok(!hidden("sec-barter") && /Prapor niv2/.test(text("overlay-barter-list")) && /2× Screw/.test(text("overlay-barter-list")), "barter premier échange");
  ok(!hidden("sec-barter-using") && /Skier niv3/.test(text("overlay-barter-using-list")) && /1× AK-74N/.test(text("overlay-barter-using-list")), "échangé : où dépenser");
  ok(!hidden("sec-hideout") && /Medstation niv2 — 3×/.test(text("overlay-hideout-list")) && /⚑/.test(text("overlay-hideout-list")), "planque FIR");
  ok(!hidden("sec-crafts") && /Medstation niv2/.test(text("overlay-craft-list")) && /~2h/.test(text("overlay-craft-list")) && /1× Splint/.test(text("overlay-craft-list")), "craft + durée");
  ok(hidden("sec-buy") && /Therapist niv2/.test(text("overlay-buy")), "section Acheter remplie mais masquée par défaut");
  ok(text("overlay-raw") === "test item", "texte brut lu conservé");

  console.log("— configuration : échelle du texte, opacité, sections —");
  await feed("", {
    status: "ok", seq: 2, result: RESULT, autohide: 0,
    cfg: { opacity: 0.6, scale: 1.3, sections: { flea_history: false, quests: false } },
  });
  ok($("cursor-overlay").style.getPropertyValue("--k") === "1.3", "échelle texte --k = 1.3");
  ok($("cursor-overlay").style.getPropertyValue("--bg-a") === "0.6", "opacité fond --bg-a = 0.6");
  ok(qs('[data-sec="flea_history"]').hidden, "flea_history cachée");
  ok(qs('[data-sec="quests"]').hidden, "quests cachée");
  ok(!qs('[data-sec="flea"]').hidden, "flea reste visible");
  ok(sizeCalls.length > 0, "set_overlay_size appelé au rendu (rect realisé par le vrai webview)");

  console.log("— déduplication par seq —");
  const fleaBefore = text("overlay-flea");
  await feed("", { status: "ok", seq: 2, result: Object.assign({}, RESULT, { flea_price: 999 }), autohide: 0, cfg: DEF_CFG });
  ok(text("overlay-flea") === fleaBefore, "payload au même seq ignoré (pas de re-rendu)");
  await feed("", { status: "ok", seq: 3, result: Object.assign({}, RESULT, { flea_price: 999999 }), autohide: 0, cfg: DEF_CFG });
  ok(text("overlay-flea").includes(fmt(999999)), "nouveau seq → re-rendu");

  console.log("— états neutres / erreurs —");
  await feed("", { status: "ok", seq: 4, result: { raw_text: "kard", flea_price: null, trader_price: null, item_name: null }, autohide: 0, cfg: DEF_CFG });
  ok(/kard/.test(text("overlay-name")) && $("overlay-name").classList.contains("placeholder"), "lecture ratée : le texte BRUT est le titre, en neutre");
  ok(/kard/.test(text("overlay-raw")), "texte brut affiché pour la correction");
  ok(text("overlay-flea") === "—", "aucun prix d'un AUTRE objet : —");
  await feed("", { status: "ok", seq: 5, result: { raw_text: "", item_name: null }, autohide: 0, cfg: DEF_CFG });
  ok(/Objet non reconnu/.test(text("overlay-name")), "rien du tout → « Objet non reconnu »");

  await feed("", { status: "auto-on", seq: 6, autohide: 3, cfg: DEF_CFG });
  ok(/Mode auto : activé/.test(text("overlay-name")), "retour visuel mode auto");
  await feed("", { status: "not-in-game", seq: 7, autohide: 4, cfg: DEF_CFG });
  ok(/Lance Tarkov d'abord/.test(text("overlay-name")), "message not-in-game");
  await feed("", { status: "error", seq: 8, message: "sidecar injoignable : boom", autohide: 8, cfg: DEF_CFG });
  ok(/sidecar injoignable/.test(text("overlay-name")), "erreur réseau explicite");
  await feed("", { status: "hide", seq: 9 });
  ok($("cursor-overlay").classList.contains("hidden"), "status hide → carte masquée");

  console.log("— config seule (sans toucher au contenu) —");
  await feed("", { status: "ok", seq: 10, result: RESULT, autohide: 0, cfg: DEF_CFG });
  const fleaRef = text("overlay-flea");
  await feed("", { status: "config", seq: 11, cfg: { opacity: 0.5, scale: 1, sections: { barter: false, buy: true } } });
  ok(text("overlay-flea") === fleaRef, "contenu intact après config-only");
  ok(qs('[data-sec="barter"]').hidden, "barter cachée depuis config");
  ok(!qs('[data-sec="buy"]').hidden, "buy montrée depuis config");
  ok($("cursor-overlay").style.getPropertyValue("--bg-a") === "0.5", "opacité 0.5 appliquée");

  console.log("— i18n de la carte (fr défaut, en, ru, fallback en pour de) —");
  await feed("", { status: "config", seq: 12, cfg: { lang: "en", opacity: 0.95, scale: 1, sections: {} } });
  ok(qs('[data-sec="quests"] .o-label').textContent === "Quest", "label quête traduit en anglais");
  ok(qs('[data-sec="barter_using"] .o-label').textContent === "Used in", "échangé → Used in");
  ok(qs('[data-sec="hideout"] .o-label').textContent === "Hideout", "planque → Hideout");
  ok(doc.documentElement.lang === "en", "html lang mis à jour");
  await feed("", { status: "config", seq: 13, cfg: { lang: "ru" } });
  ok(qs('[data-sec="quests"] .o-label').textContent === "Задание", "label quête en russe");
  await feed("", {
    status: "ok", seq: 14, autohide: 0, cfg: { lang: "ru" },
    result: Object.assign({}, RESULT, {
      used_in_tasks: RESULT.used_in_tasks.concat([{ id: "t3", name: "Q3" }, { id: "t4", name: "Q4" }]),
    }),
  });
  ok(/ур\.\s?2/.test(text("overlay-barter-list")), "niv2 → ур. 2 en russe");
  ok(/других/.test(text("overlay-quest-list")), "+N autres → +N других");
  ok(/Лучший/.test(text("overlay-trader-label")), "Meilleur → Лучший");
  await feed("", { status: "config", seq: 15, cfg: { lang: "de" } });
  ok(doc.documentElement.lang === "en" && qs('[data-sec="quests"] .o-label').textContent === "Quest", "de → fallback anglais");
  await feed("", { status: "config", seq: 16, cfg: { lang: "fr" } });
  ok(qs('[data-sec="quests"] .o-label').textContent === "Quête", "retour au français");

  console.log(`\nTOTAL: ${passed} passés, ${failed} échoués`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
