#!/usr/bin/env node
/**
 * @file cockpit-tee.js
 * @description Statusline wrapper for AI Cockpit. Claude Code only exposes
 * usage limits on the statusline stdin JSON (`rate_limits.five_hour` and
 * `rate_limits.seven_day`, each `{used_percentage, resets_at}`, both optional).
 * This script saves them to ~/.ai-cockpit/claude-limits.json (atomic write,
 * normalized to `used_percent`) and then runs the user's previous statusline
 * command with the same stdin, passing its stdout through. Local only.
 *
 * Wiring (done by the user; this repo never edits ~/.claude/settings.json):
 *   "statusLine": { "type": "command",
 *     "command": "node /path/to/ai-cockpit/statusline/cockpit-tee.js -- <previous command>" }
 * With one argument after `--` it runs as a shell command string; with several
 * it is exec'd directly. With none, nothing is printed. It never throws.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function win(w) {
  if (!w || typeof w !== "object") return null;
  const used = Number(w.used_percentage ?? w.used_percent);
  let reset =
    typeof w.resets_at === "string" ? Date.parse(w.resets_at) / 1000 : Number(w.resets_at);
  if (!Number.isFinite(used) || !Number.isFinite(reset)) return null;
  if (reset > 1e12) reset = Math.floor(reset / 1000);
  return { used_percent: used, resets_at: reset };
}

function save(input) {
  try {
    const rl = JSON.parse(input).rate_limits;
    if (!rl) return;
    const dir = process.env.AI_COCKPIT_DIR || path.join(os.homedir(), ".ai-cockpit");
    fs.mkdirSync(dir, { recursive: true });
    const out = {
      five_hour: win(rl.five_hour),
      seven_day: win(rl.seven_day),
      updated_at: Math.floor(Date.now() / 1000),
    };
    const tmp = path.join(dir, `claude-limits.json.${process.pid}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, path.join(dir, "claude-limits.json"));
  } catch {
    /* never break the statusline */
  }
}

function main() {
  let input = "";
  try {
    input = fs.readFileSync(0, "utf8");
  } catch {
    /* no stdin */
  }
  save(input);
  const i = process.argv.indexOf("--");
  const inner = i >= 0 ? process.argv.slice(i + 1) : [];
  if (!inner.length) return;
  try {
    const r =
      inner.length === 1
        ? spawnSync(inner[0], { shell: true, input, encoding: "utf8", timeout: 5000 })
        : spawnSync(inner[0], inner.slice(1), { input, encoding: "utf8", timeout: 5000 });
    if (r.stdout) process.stdout.write(r.stdout);
  } catch {
    /* ignore */
  }
}

try {
  main();
} catch {
  /* ignore */
}
