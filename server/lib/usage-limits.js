/**
 * @file usage-limits.js
 * @description Reads provider usage-limit windows. Codex: the last
 * `rate_limits` record in the tail of the newest rollout under the Codex
 * sessions dir. Claude: ~/.ai-cockpit/claude-limits.json, written both by
 * statusline/cockpit-tee.js and by pollClaudeUsage(), which asks Anthropic's
 * usage endpoint (the one Claude Code's /usage uses) every 5 minutes with
 * Claude Code's own OAuth token. Windows whose reset time has passed are
 * dropped.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { getCodexSessionsDir } = require("./codex-home");

const TAIL_BYTES = 512 * 1024;
const MAX_ROLLOUTS_TRIED = 5;

function cockpitDir() {
  return process.env.AI_COCKPIT_DIR || path.join(os.homedir(), ".ai-cockpit");
}

/** Normalize one window; null when unusable or already reset. */
function normWindow(raw, now) {
  if (!raw || typeof raw !== "object") return null;
  const used = Number(raw.used_percent ?? raw.used_percentage);
  let reset = raw.resets_at;
  if (typeof reset === "string") reset = Date.parse(reset) / 1000;
  reset = Number(reset);
  if (!Number.isFinite(used) || !Number.isFinite(reset)) return null;
  if (reset > 1e12) reset = Math.floor(reset / 1000); // tolerate ms
  if (reset <= now) return null;
  return { used_percent: used, resets_at: reset };
}

function readTail(file) {
  const fd = fs.openSync(file, "r");
  try {
    const { size } = fs.fstatSync(fd);
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function findRateLimits(node) {
  if (!node || typeof node !== "object") return null;
  if (node.rate_limits && typeof node.rate_limits === "object") return node.rate_limits;
  for (const v of Object.values(node)) {
    const hit = findRateLimits(v);
    if (hit) return hit;
  }
  return null;
}

function newestRollouts(root) {
  const sub = (dir) => {
    try {
      return fs.readdirSync(dir).sort().reverse();
    } catch {
      return [];
    }
  };
  const out = [];
  for (const y of sub(root))
    for (const m of sub(path.join(root, y)))
      for (const d of sub(path.join(root, y, m))) {
        const dir = path.join(root, y, m, d);
        const files = sub(dir).filter((f) => /^rollout-.*\.jsonl$/.test(f));
        const withTime = files.map((f) => {
          const p = path.join(dir, f);
          try {
            return { p, t: fs.statSync(p).mtimeMs };
          } catch {
            return { p, t: 0 };
          }
        });
        withTime.sort((a, b) => b.t - a.t);
        out.push(...withTime.map((x) => x.p));
        if (out.length >= MAX_ROLLOUTS_TRIED) return out;
      }
  return out;
}

function codexLimits(now) {
  const files = newestRollouts(getCodexSessionsDir()).slice(0, MAX_ROLLOUTS_TRIED);
  for (const file of files) {
    let text;
    try {
      text = readTail(file);
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      let rl;
      try {
        rl = findRateLimits(JSON.parse(lines[i]));
      } catch {
        continue; // partial first line of the tail window
      }
      if (!rl) continue;
      const out = { five_hour: null, seven_day: null };
      for (const w of [rl.primary, rl.secondary]) {
        const key =
          w &&
          (w.window_minutes === 300
            ? "five_hour"
            : w.window_minutes === 10080
              ? "seven_day"
              : null);
        if (key) out[key] = normWindow(w, now);
      }
      let updated = Date.now() / 1000;
      try {
        updated = fs.statSync(file).mtimeMs / 1000;
      } catch {
        /* keep now */
      }
      return { ...out, updated_at: Math.floor(updated) };
    }
  }
  return null;
}

function claudeLimits(now) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(cockpitDir(), "claude-limits.json"), "utf8"));
    return {
      five_hour: normWindow(j.five_hour, now),
      seven_day: normWindow(j.seven_day, now),
      updated_at: Number(j.updated_at) || null,
    };
  } catch {
    return null;
  }
}

function getLimits(now = Math.floor(Date.now() / 1000)) {
  return { claude: claudeLimits(now), codex: codexLimits(now) };
}

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_POLL_MS = 5 * 60 * 1000;

/**
 * Claude Code's OAuth access token: ~/.claude/.credentials.json on Linux and
 * Windows, the "Claude Code-credentials" Keychain item on macOS. Never
 * refreshed here: rotating the refresh token would sign Claude Code out.
 */
async function claudeToken() {
  const dir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const sources = [() => fs.promises.readFile(path.join(dir, ".credentials.json"), "utf8")];
  if (process.platform === "darwin") {
    sources.push(
      () =>
        new Promise((resolve, reject) =>
          execFile(
            "security",
            ["find-generic-password", "-s", "Claude Code-credentials", "-w"],
            { timeout: 10_000 },
            (err, out) => (err ? reject(err) : resolve(out))
          )
        )
    );
  }
  for (const read of sources) {
    try {
      const oauth = JSON.parse(await read()).claudeAiOauth;
      if (oauth?.accessToken && !(oauth.expiresAt <= Date.now())) return oauth.accessToken;
    } catch {
      /* try the next source */
    }
  }
  return null;
}

/** Map the usage response to the claude-limits.json shape. */
function claudeUsageToLimits(body, nowSec) {
  const win = (w) =>
    w && Number.isFinite(Number(w.utilization))
      ? { used_percent: Number(w.utilization), resets_at: w.resets_at }
      : null;
  return { five_hour: win(body?.five_hour), seven_day: win(body?.seven_day), updated_at: nowSec };
}

async function pollClaudeUsage() {
  const token = await claudeToken();
  if (!token) return false;
  const res = await fetch(CLAUDE_USAGE_URL, {
    headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return false;
  const out = claudeUsageToLimits(await res.json(), Math.floor(Date.now() / 1000));
  const file = path.join(cockpitDir(), "claude-limits.json");
  fs.mkdirSync(cockpitDir(), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(out));
  fs.renameSync(`${file}.tmp`, file);
  return true;
}

let claudeTimer = null;
function startClaudeUsagePoll() {
  if (claudeTimer || process.env.AI_COCKPIT_CLAUDE_USAGE === "0") return;
  const tick = () => pollClaudeUsage().catch(() => {});
  setTimeout(tick, 5_000).unref();
  claudeTimer = setInterval(tick, CLAUDE_POLL_MS);
  claudeTimer.unref();
}

module.exports = { getLimits, claudeUsageToLimits, startClaudeUsagePoll };
