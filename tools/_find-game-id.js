const s = require("fs").readFileSync("kappa.html", "utf8");
const m = s.match(/data-game-id="(\d+)"/);
const t = s.match(/"title":\s*"([^"]+)"/);
const d = s.match(/itchio_game_url":\s*"([^"]+)"/);
const e = s.match(/"id":"(\d+)","name":"yelt"/);
console.log("GAME_ID=" + (m ? m[1] : "not found (data-game-id)"));
console.log("title=" + (t ? t[1] : "unknown"));
console.log("page_url=" + (d ? d[1] : "not found"));
if (!m) {
  console.log("--- fallback search ---");
  const all = [...s.matchAll(/game_id["\s:=]+(\d{4,})/gi)];
  console.log("game_id matches:", all.map(x => x[1]));
}
