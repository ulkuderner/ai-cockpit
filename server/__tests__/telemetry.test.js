/**
 * @file Tests for AI Cockpit telemetry math: cache hit rate and caching savings against a counterfactual without cache.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const telemetry = require("../lib/telemetry");

const rules = {
  claude: [
    {
      model_pattern: "claude-test%",
      display_name: "Test",
      input_per_mtok: 10,
      output_per_mtok: 50,
      cache_read_per_mtok: 1,
      cache_write_per_mtok: 12.5,
      cache_write_1h_per_mtok: 20,
    },
  ],
  gpt: [],
  cursor: [],
};

const row = (o) => ({
  provider: "claude",
  model: "claude-test-1",
  speed: "standard",
  inference_geo: "global",
  service_tier: "standard",
  context_size: "short",
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cache_write_1h_tokens: 0,
  ...o,
});

test("hit rate is cached prompt tokens over all prompt tokens", () => {
  assert.equal(telemetry.hitRate({ input: 100, cache_read: 800, cache_write: 100 }), 0.8);
  assert.equal(telemetry.hitRate({ input: 0, cache_read: 0, cache_write: 0 }), null);
});

test("savings = cost without cache minus actual cost", () => {
  // 1M cache reads: $1 actual vs $10 as plain input → $9 saved.
  const s = telemetry.summarize([row({ cache_read_tokens: 1_000_000 })], rules);
  assert.equal(s.cost, 1);
  assert.equal(s.no_cache_cost, 10);
});

test("cache writes cost more than plain input, so they reduce savings", () => {
  const s = telemetry.summarize([row({ cache_write_tokens: 1_000_000 })], rules);
  assert.equal(s.cost, 12.5);
  assert.equal(s.no_cache_cost, 10);
});
