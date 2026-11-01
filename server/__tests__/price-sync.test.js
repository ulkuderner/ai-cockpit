/**
 * @file Tests for AI Cockpit price sync: LiteLLM catalog parsing and the diff against current rate cards.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const ps = require("../lib/price-sync");

const catalog = ps.parseCatalog({
  sample_spec: { input_cost_per_token: "x" },
  "claude-opus-5-5": {
    input_cost_per_token: 4e-6,
    output_cost_per_token: 2e-5,
    cache_read_input_token_cost: 2e-7,
    cache_creation_input_token_cost: 5e-6,
    litellm_provider: "anthropic",
    mode: "chat",
  },
  "vertex_ai/gemini-2.5-pro": {
    input_cost_per_token: 9e-6,
    output_cost_per_token: 9e-5,
    litellm_provider: "vertex_ai-language-models",
    mode: "chat",
  },
  "gemini/gemini-2.5-pro": {
    input_cost_per_token: 1.25e-6,
    output_cost_per_token: 1e-5,
    cache_read_input_token_cost: 1.25e-7,
    litellm_provider: "gemini",
    mode: "chat",
  },
  "gpt-5.6-sol": {
    input_cost_per_token: 4e-6,
    output_cost_per_token: 2e-5,
    cache_read_input_token_cost: 4e-7,
    litellm_provider: "openai",
    mode: "chat",
  },
  "text-embedding-x": { input_cost_per_token: 1e-7, litellm_provider: "openai", mode: "embedding" },
});

test("catalog: per-MTok rates, first-party provider wins, non-chat skipped", () => {
  assert.deepEqual(
    [catalog["claude-opus-5-5"].input, catalog["claude-opus-5-5"].cache_read],
    [4, 0.2]
  );
  assert.equal(catalog["gemini-2.5-pro"].provider, "gemini");
  assert.equal(catalog["gemini-2.5-pro"].input, 1.25);
  assert.equal(catalog["text-embedding-x"], undefined);
});

test("diff: unchanged skipped, changed and missing reported, cursor ignored", () => {
  const claudeRules = [
    {
      model_pattern: "claude-opus-5-5%",
      input_per_mtok: 4,
      output_per_mtok: 20,
      cache_read_per_mtok: 0.2,
      cache_write_per_mtok: 5,
    },
  ];
  const gptRules = [
    {
      model_pattern: "gpt-5.6%",
      short_input_per_mtok: 3,
      short_output_per_mtok: 20,
      short_cached_input_per_mtok: 0.4,
      short_cache_write_per_mtok: 0,
    },
  ];
  const used = [
    { provider: "claude", model: "claude-opus-5-5" },
    { provider: "gemini", model: "gemini-2.5-pro" },
    { provider: "codex", model: "gpt-5.6-sol" },
    { provider: "cursor", model: "gemini-2.5-pro" },
    { provider: "claude", model: "not-in-catalog" },
  ];
  const changes = ps.diff(catalog, used, claudeRules, gptRules);
  assert.deepEqual(
    changes.map((c) => [c.table, c.model, c.kind]),
    [
      ["claude", "gemini-2.5-pro", "add"],
      ["gpt", "gpt-5.6-sol", "change"],
    ]
  );
  assert.equal(changes[1].old.input, 3);
  assert.equal(changes[1].new.input, 4);
});
