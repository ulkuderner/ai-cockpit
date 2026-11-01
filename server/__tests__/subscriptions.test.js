/**
 * @file Tests for AI Cockpit subscription detection (plan parsing from local files and CLI output).
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const s = require("../lib/subscriptions");

test("claude plan from oauthAccount", () => {
  assert.equal(
    s.claudePlan({
      organizationRateLimitTier: "default_claude_max_20x",
      organizationType: "claude_max",
    }),
    "Max 20x"
  );
  assert.equal(s.claudePlan({ organizationType: "claude_pro" }), "Pro");
  assert.equal(s.claudePlan(null), null);
});

test("codex plan decoded from id_token claims", () => {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_plan_type: "team" } })
  ).toString("base64url");
  assert.equal(
    s.codexPlan({ auth_mode: "chatgpt", tokens: { id_token: `h.${payload}.sig` } }),
    "ChatGPT Team"
  );
  assert.equal(s.codexPlan({ auth_mode: "apikey", OPENAI_API_KEY: "x" }), "API anahtarı");
});

test("cursor tier from `about` output and gemini auth type", () => {
  assert.equal(s.cursorPlan("Model   Grok\nSubscription Tier   Ultra\nOS darwin"), "Ultra");
  assert.equal(s.cursorPlan("nothing"), null);
  assert.equal(
    s.geminiAuth({ security: { auth: { selectedType: "oauth-personal" } } }),
    "Google hesabı"
  );
});
