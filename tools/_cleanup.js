const fs = require("fs");
const path = require("path");
const tmp = ["tools/_cargo-check.bat", "tools/_cargo-check2.bat", "tools/_run-node.bat", "tools/_release.bat", "tools/_grep.js", "tools/_patch-conf.js", "tools/_patch-conf2.js", "tools/_patch-conf3.js", "tools/_patch-conf4.js", "tools/_check-sidecar.js", "tools/_check-internal.js", "tools/_copy-sidecar.js", "tools/_install-butler.js", "cargo-check.log", "cargo-check2.log", "patch-out.txt", "release.log", "kappa.html"];
for (const f of tmp) {
  if (fs.existsSync(f)) { fs.unlinkSync(f); console.log("removed:", f); }
}
console.log("cleanup done");
