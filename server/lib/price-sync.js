/**
 * @file AI Cockpit price sync: pulls the public LiteLLM model price list on demand ("Sync" button) and, once a week, only checks it and reports differences for the models this machine actually uses. Claude and Gemini rates go to model_pricing, OpenAI/Codex rates to gpt_model_pricing; Cursor keeps its own billing table. Existing rows only get their base input/output/cache rates updated, so fast-mode, 1h-cache and long-context rates stay as curated. Only a GET to the price list leaves the machine; no usage data is sent.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { db } = require("../db");
const { matchesModelPattern } = require("../routes/pricing");

const SOURCE_URL =
  process.env.AI_COCKPIT_PRICES_URL ||
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const WEEK_MS = 7 * 24 * 3600 * 1000;
// First-party providers win over cloud resellers that list the same model at other prices.
const PREFERRED = ["anthropic", "openai", "gemini", "xai", "deepseek", "mistral"];

function stateFile() {
  return path.join(
    process.env.AI_COCKPIT_HOME || path.join(os.homedir(), ".ai-cockpit"),
    "prices.json"
  );
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return { last_sync: null, last_check: null, pending: [] };
  }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(s, null, 2));
}

const perMTok = (v) => (typeof v === "number" ? Math.round(v * 1e6 * 10000) / 10000 : 0);

/** Pure: LiteLLM JSON → { modelName: { input, output, cache_read, cache_write, cache_write_1h, provider } }. */
function parseCatalog(json) {
  const out = {};
  const rank = (p) => (PREFERRED.includes(p) ? PREFERRED.indexOf(p) : PREFERRED.length);
  for (const [key, v] of Object.entries(json || {})) {
    if (!v || typeof v !== "object" || typeof v.input_cost_per_token !== "number") continue;
    if (v.mode && v.mode !== "chat" && v.mode !== "responses") continue;
    const name = key.includes("/") ? key.split("/").pop() : key;
    const provider = v.litellm_provider || "";
    const prev = out[name];
    if (prev && rank(prev.provider) <= rank(provider)) continue;
    out[name] = {
      provider,
      input: perMTok(v.input_cost_per_token),
      output: perMTok(v.output_cost_per_token),
      cache_read: perMTok(v.cache_read_input_token_cost),
      cache_write: perMTok(v.cache_creation_input_token_cost),
      cache_write_1h: perMTok(v.cache_creation_input_token_cost_above_1hr),
    };
  }
  return out;
}

function usedModels() {
  return db
    .prepare(
      `SELECT DISTINCT s.provider AS provider, tu.model AS model
       FROM token_usage tu JOIN sessions s ON s.id = tu.session_id
       WHERE tu.model IS NOT NULL AND tu.model <> '' AND tu.model <> 'unknown'`
    )
    .all();
}

const ruleFor = (rules, model) =>
  [...rules]
    .sort((a, b) => b.model_pattern.length - a.model_pattern.length)
    .find((r) => matchesModelPattern(r.model_pattern, model));

const differs = (a, b) => Math.abs((a || 0) - (b || 0)) > 1e-9;

/** Pure: diff used models against the catalog and the current rate cards. Exported for tests. */
function diff(catalog, used, claudeRules, gptRules) {
  const changes = [];
  const seen = new Set();
  for (const { provider, model } of used) {
    if (provider === "cursor" || seen.has(model)) continue;
    seen.add(model);
    const price = catalog[model];
    if (!price) continue;
    if (provider === "codex") {
      const rule = ruleFor(gptRules, model);
      const cur = rule && {
        input: rule.short_input_per_mtok,
        output: rule.short_output_per_mtok,
        cache_read: rule.short_cached_input_per_mtok,
        cache_write: rule.short_cache_write_per_mtok,
      };
      if (
        !rule ||
        ["input", "output", "cache_read", "cache_write"].some((k) => differs(cur[k], price[k]))
      ) {
        changes.push({
          table: "gpt",
          model,
          pattern: rule?.model_pattern || model,
          kind: rule ? "change" : "add",
          old: cur || null,
          new: price,
        });
      }
      continue;
    }
    const rule = ruleFor(claudeRules, model);
    const cur = rule && {
      input: rule.input_per_mtok,
      output: rule.output_per_mtok,
      cache_read: rule.cache_read_per_mtok,
      cache_write: rule.cache_write_per_mtok,
    };
    if (
      !rule ||
      ["input", "output", "cache_read", "cache_write"].some((k) => differs(cur[k], price[k]))
    ) {
      changes.push({
        table: "claude",
        model,
        pattern: rule?.model_pattern || model,
        kind: rule ? "change" : "add",
        old: cur || null,
        new: price,
      });
    }
  }
  return changes;
}

async function fetchCatalog() {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok)
    throw Object.assign(new Error(`Fiyat listesi alınamadı: HTTP ${res.status}`), { status: 502 });
  return parseCatalog(await res.json());
}

function currentDiff(catalog) {
  return diff(
    catalog,
    usedModels(),
    db.prepare("SELECT * FROM model_pricing").all(),
    db.prepare("SELECT * FROM gpt_model_pricing").all()
  );
}

function apply(changes) {
  const insClaude = db.prepare(
    `INSERT INTO model_pricing (model_pattern, display_name, input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok, cache_write_1h_per_mtok, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  );
  const updClaude = db.prepare(
    `UPDATE model_pricing SET input_per_mtok = ?, output_per_mtok = ?, cache_read_per_mtok = ?, cache_write_per_mtok = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE model_pattern = ?`
  );
  const insGpt = db.prepare(
    `INSERT INTO gpt_model_pricing (model_pattern, display_name, short_input_per_mtok, short_cached_input_per_mtok, short_cache_write_per_mtok, short_output_per_mtok, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`
  );
  const updGpt = db.prepare(
    `UPDATE gpt_model_pricing SET short_input_per_mtok = ?, short_cached_input_per_mtok = ?, short_cache_write_per_mtok = ?, short_output_per_mtok = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE model_pattern = ?`
  );
  db.transaction(() => {
    for (const c of changes) {
      const p = c.new;
      if (c.table === "gpt") {
        if (c.kind === "add")
          insGpt.run(c.model, c.model, p.input, p.cache_read, p.cache_write, p.output);
        else updGpt.run(p.input, p.cache_read, p.cache_write, p.output, c.pattern);
      } else if (c.kind === "add") {
        insClaude.run(
          c.model,
          c.model,
          p.input,
          p.output,
          p.cache_read,
          p.cache_write,
          p.cache_write_1h || p.cache_write
        );
      } else {
        updClaude.run(p.input, p.output, p.cache_read, p.cache_write, c.pattern);
      }
    }
  })();
}

/** "Sync" button: fetch, apply every difference for used models, clear pending. */
async function sync() {
  const changes = currentDiff(await fetchCatalog());
  apply(changes);
  const now = new Date().toISOString();
  writeState({ ...readState(), last_sync: now, last_check: now, pending: [] });
  return { applied: changes, source: SOURCE_URL };
}

/** Weekly check: fetch and record differences without touching prices. */
async function check() {
  const pending = currentDiff(await fetchCatalog());
  writeState({ ...readState(), last_check: new Date().toISOString(), pending });
  return pending;
}

function status() {
  return { ...readState(), source: SOURCE_URL };
}

let timer = null;
function startWeekly() {
  if (timer || process.env.AI_COCKPIT_PRICE_CHECK === "0") return;
  const due = () => {
    const last = Date.parse(readState().last_check || 0) || 0;
    if (Date.now() - last >= WEEK_MS) check().catch(() => {});
  };
  setTimeout(due, 60_000).unref();
  timer = setInterval(due, 6 * 3600 * 1000);
  timer.unref();
}

module.exports = { parseCatalog, diff, sync, check, status, startWeekly, SOURCE_URL };
