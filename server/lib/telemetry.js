/**
 * @file AI Cockpit live telemetry: samples cumulative token usage every few seconds, keeps the last hour of deltas in memory, and reports token throughput, cache hit rate and the money saved by prompt caching (actual cost vs. the same tokens billed as plain input).
 * @author Caglar Ulkuderner
 */

const { db, stmts } = require("../db");
const { calculateProviderCost } = require("../routes/pricing");

const SAMPLE_MS = Number.parseInt(process.env.AI_COCKPIT_TELEMETRY_MS || "", 10) || 10_000;
const KEEP_MS = 60 * 60 * 1000;

const TOTALS_SQL = `
  SELECT s.provider AS provider, tu.model AS model, tu.speed AS speed,
    tu.inference_geo AS inference_geo, tu.service_tier AS service_tier, tu.context_size AS context_size,
    SUM(tu.input_tokens + tu.baseline_input) AS input_tokens,
    SUM(tu.output_tokens + tu.baseline_output) AS output_tokens,
    SUM(tu.cache_read_tokens + tu.baseline_cache_read) AS cache_read_tokens,
    SUM(tu.cache_write_tokens + tu.baseline_cache_write) AS cache_write_tokens,
    SUM(tu.cache_write_1h_tokens + tu.baseline_cache_write_1h) AS cache_write_1h_tokens
  FROM token_usage tu JOIN sessions s ON s.id = tu.session_id
  GROUP BY s.provider, tu.model, tu.speed, tu.inference_geo, tu.service_tier, tu.context_size`;

/** Same tokens with every cached token billed as fresh input: what the run would cost without caching. */
function withoutCache(rows) {
  return rows.map((r) => ({
    ...r,
    input_tokens: (r.input_tokens || 0) + (r.cache_read_tokens || 0) + (r.cache_write_tokens || 0),
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    cache_write_1h_tokens: 0,
  }));
}

/** Pure: totals + cost for a set of token_usage rows. Exported for tests. */
function summarize(rows, rules) {
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const cost = calculateProviderCost(rows, rules.claude, rules.gpt, rules.cursor).total_cost;
  const noCache = calculateProviderCost(
    withoutCache(rows),
    rules.claude,
    rules.gpt,
    rules.cursor
  ).total_cost;
  return {
    input: sum("input_tokens"),
    output: sum("output_tokens"),
    cache_read: sum("cache_read_tokens"),
    cache_write: sum("cache_write_tokens"),
    cost,
    no_cache_cost: noCache,
  };
}

/** Share of prompt tokens served from cache. */
function hitRate(t) {
  const prompt = t.input + t.cache_read + t.cache_write;
  return prompt > 0 ? t.cache_read / prompt : null;
}

function diff(a, b) {
  const out = {};
  for (const k of Object.keys(b)) out[k] = Math.max((b[k] || 0) - (a[k] || 0), 0);
  return out;
}

const samples = []; // [{ t, totals }]
let timer = null;

function loadRules() {
  return {
    claude: stmts.listPricing.all(),
    gpt: stmts.listGptPricing.all(),
    cursor: stmts.listCursorPricing.all(),
  };
}

/** Per provider+model totals, so the UI can show Claude next to GPT, Cursor and Gemini models. */
function byModel(rows, rules) {
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.provider || "claude"}|${r.model}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = {};
  for (const [key, group] of groups) out[key] = summarize(group, rules);
  return out;
}

function sample(now = Date.now()) {
  const rows = db.prepare(TOTALS_SQL).all();
  const rules = loadRules();
  const totals = summarize(rows, rules);
  samples.push({ t: now, totals, models: byModel(rows, rules) });
  while (samples.length > 1 && samples[0].t < now - KEEP_MS) samples.shift();
  return totals;
}

function start() {
  if (timer || SAMPLE_MS <= 0) return;
  try {
    sample();
  } catch {
    /* DB not ready yet; next tick retries */
  }
  timer = setInterval(() => {
    try {
      sample();
    } catch {
      /* keep sampling; a transient lock must not stop telemetry */
    }
  }, SAMPLE_MS);
  timer.unref();
}

function stop() {
  clearInterval(timer);
  timer = null;
}

/** Report: all-time totals, last-hour window and per-minute series. */
function report(now = Date.now()) {
  const latest = samples.length ? samples[samples.length - 1].totals : sample(now);
  const first = samples[0];
  const windowTotals = first ? diff(first.totals, latest) : diff(latest, latest);
  const series = [];
  for (let i = 1; i < samples.length; i++) {
    const d = diff(samples[i - 1].totals, samples[i].totals);
    const minute = Math.floor(samples[i].t / 60_000) * 60_000;
    let bucket = series[series.length - 1];
    if (!bucket || bucket.t !== minute) {
      bucket = {
        t: minute,
        input: 0,
        output: 0,
        cache_read: 0,
        cache_write: 0,
        cost: 0,
        no_cache_cost: 0,
      };
      series.push(bucket);
    }
    for (const k of Object.keys(d)) bucket[k] += d[k];
  }
  const decorate = (t) => {
    const tokens = t.input + t.output + t.cache_read + t.cache_write;
    return {
      ...t,
      tokens,
      cache_hit: hitRate(t),
      // No matching rate card (e.g. a model without pricing) → savings unknown, not $0.
      saved: tokens > 0 && t.no_cache_cost === 0 ? null : Math.max(t.no_cache_cost - t.cost, 0),
    };
  };
  const lastModels = samples.length ? samples[samples.length - 1].models : {};
  const firstModels = first ? first.models : lastModels;
  const models = Object.entries(lastModels)
    .map(([key, totals]) => {
      const [provider, ...rest] = key.split("|");
      const before = firstModels[key] || {};
      return {
        provider,
        model: rest.join("|"),
        all_time: decorate(totals),
        window: decorate(diff(before, totals)),
      };
    })
    .filter((m) => m.all_time.tokens > 0)
    .sort((a, b) => b.window.tokens - a.window.tokens || b.all_time.tokens - a.all_time.tokens);
  return {
    sample_ms: SAMPLE_MS,
    window_started_at: first ? first.t : now,
    all_time: decorate(latest),
    models,
    window: decorate(windowTotals),
    series: series.map(decorate),
  };
}

module.exports = {
  start,
  stop,
  sample,
  report,
  summarize,
  hitRate,
  withoutCache,
  _samples: samples,
};
