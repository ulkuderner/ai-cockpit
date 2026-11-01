/**
 * @file AI Cockpit subscriptions: which AI coding subscriptions are set up on this machine and what each one reports locally. Plans come from each tool's own local files (Claude ~/.claude.json, Codex ~/.codex/auth.json id_token claims decoded locally, Cursor `cursor-agent about`, Gemini ~/.gemini/settings.json); usage windows reuse usage-limits.js; tools that keep no quota locally get today's local activity instead. No network calls.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { db } = require("../db");
const { getLimits } = require("./usage-limits");

const home = () => os.homedir();
const readJson = (p) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};

/** Pure: "default_claude_max_20x" / "claude_max" → "Max 20x". Exported for tests. */
function claudePlan(acct) {
  if (!acct) return null;
  const tier = String(acct.organizationRateLimitTier || acct.userRateLimitTier || "");
  const m = /max_(\d+)x/.exec(tier);
  if (m) return `Max ${m[1]}x`;
  const type = String(acct.organizationType || "");
  if (type.includes("max")) return "Max";
  if (type.includes("pro")) return "Pro";
  if (type.includes("team")) return "Team";
  if (type.includes("enterprise")) return "Enterprise";
  return type ? type.replace(/^claude_/, "").replace(/_/g, " ") : null;
}

/** Pure: plan claim from a ChatGPT id_token, decoded locally (signature not needed for display). */
function codexPlan(auth) {
  if (!auth) return null;
  if (auth.auth_mode !== "chatgpt") return auth.OPENAI_API_KEY ? "API anahtarı" : null;
  try {
    const payload = JSON.parse(
      Buffer.from(auth.tokens.id_token.split(".")[1], "base64url").toString("utf8")
    );
    const plan = payload["https://api.openai.com/auth"]?.chatgpt_plan_type;
    return plan ? `ChatGPT ${plan.charAt(0).toUpperCase()}${plan.slice(1)}` : "ChatGPT";
  } catch {
    return "ChatGPT";
  }
}

/** Pure: "Subscription Tier   Ultra" line from `cursor-agent about`. */
function cursorPlan(aboutText) {
  const m = /Subscription Tier\s+(.+)/.exec(aboutText || "");
  return m ? m[1].trim() : null;
}

function geminiAuth(settings) {
  const t = settings?.security?.auth?.selectedType || settings?.selectedAuthType || null;
  if (!t) return null;
  if (t === "oauth-personal") return "Google hesabı";
  if (t === "gemini-api-key") return "API anahtarı";
  if (t === "vertex-ai") return "Vertex AI";
  return t;
}

// `cursor-agent about` takes a few seconds; cache it.
let cursorCache = { at: 0, plan: null, installed: false };
function refreshCursor() {
  if (Date.now() - cursorCache.at < 6 * 3600 * 1000) return;
  cursorCache.at = Date.now();
  const bin = process.env.CURSOR_AGENT_BIN || "cursor-agent";
  execFile(bin, ["about"], { timeout: 20_000 }, (err, stdout) => {
    cursorCache = {
      at: Date.now(),
      plan: err ? null : cursorPlan(stdout),
      installed: !err || err.code !== "ENOENT",
    };
  });
}

function today(provider) {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS sessions FROM sessions WHERE provider = ? AND started_at >= date('now','localtime','start of day','utc')`
      )
      .get(provider);
    return row.sessions;
  } catch {
    return null;
  }
}

function geminiRequestsToday() {
  try {
    return db
      .prepare(
        `SELECT COUNT(*) AS n FROM events e JOIN sessions s ON s.id = e.session_id
         WHERE s.provider = 'gemini' AND e.event_type = 'gemini_response_message'
           AND e.created_at >= date('now','localtime','start of day','utc')`
      )
      .get().n;
  } catch {
    return null;
  }
}

function list() {
  refreshCursor();
  const limits = getLimits();
  const out = [];

  const claudeAcct = readJson(path.join(home(), ".claude.json"))?.oauthAccount;
  if (claudeAcct || fs.existsSync(path.join(home(), ".claude"))) {
    out.push({
      provider: "claude",
      name: "Claude Code",
      plan: claudePlan(claudeAcct),
      windows: limits.claude,
      sessions_today: today("claude"),
      dashboard: "https://claude.ai/settings/usage",
      note: limits.claude ? null : "statusline",
    });
  }

  const codexAuth = readJson(path.join(home(), ".codex", "auth.json"));
  if (codexAuth || fs.existsSync(path.join(home(), ".codex"))) {
    out.push({
      provider: "codex",
      name: "Codex",
      plan: codexPlan(codexAuth),
      windows: limits.codex,
      sessions_today: today("codex"),
      dashboard: "https://chatgpt.com/codex/settings/usage",
      note: null,
    });
  }

  if (cursorCache.installed || fs.existsSync(path.join(home(), ".cursor", "cli-config.json"))) {
    out.push({
      provider: "cursor",
      name: "Cursor",
      plan: cursorCache.plan,
      windows: null,
      sessions_today: today("cursor"),
      dashboard: "https://cursor.com/dashboard?tab=usage",
      note: "no-local-quota",
    });
  }

  const geminiSettings = readJson(path.join(home(), ".gemini", "settings.json"));
  if (geminiSettings || fs.existsSync(path.join(home(), ".gemini", "oauth_creds.json"))) {
    out.push({
      provider: "gemini",
      name: "Gemini CLI",
      plan: geminiAuth(geminiSettings),
      windows: null,
      sessions_today: today("gemini"),
      requests_today: geminiRequestsToday(),
      dashboard: "https://aistudio.google.com/usage",
      note: "no-local-quota",
    });
  }
  return { items: out };
}

module.exports = { list, claudePlan, codexPlan, cursorPlan, geminiAuth };
