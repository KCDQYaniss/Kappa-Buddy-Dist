const { execSync } = require("child_process");
try {
  const opts = { cwd: "C:/Users/Sinqy/Documents/tarkov-tracker", stdio: "inherit" };
  execSync("git add -A", { ...opts, encoding: "utf8" });
  execSync("git commit --amend --no-edit -q", { ...opts, encoding: "utf8" });
  execSync("git push --force-with-lease", { ...opts, encoding: "utf8" });
  console.log("PUSH_OK");
} catch (e) {
  console.log("ERR:", e.message);
}
