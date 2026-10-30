const fs = require("fs");
const d = fs.readFileSync("dist/latest.json");
const j = JSON.parse(d);
const lines = JSON.stringify(j, null, 1) || "{}";
fs.writeFileSync("manifest-summary.txt", lines + "\n");
console.log("Written:", "manifest-summary.txt");
