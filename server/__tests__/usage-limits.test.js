/**
 * @file usage-limits.test.js
 * @description Tests the local usage-limit reader (Codex rollout tail, Claude
 * statusline file written by cockpit-tee.js) and the GET /api/limits shape in
 * a temporary HOME.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "limits-test-"));
process.env.HOME = HOME;
delete process.env.CODEX_HOME;
delete process.env.DASHBOARD_CODEX_HOME;
delete process.env.AI_COCKPIT_DIR;
const { getLimits } = require("../lib/usage-limits");

const NOW = 1_793_000_000;
const rollout = path.join(HOME, ".codex/sessions/2026/10/28/rollout-2026-10-28T11-59-04-abc.jsonl");
fs.mkdirSync(path.dirname(rollout), { recursive: true });
const rl = (p, s) =>
  JSON.stringify({
    type: "event_msg",
    payload: {
      type: "token_count",
      rate_limits: {
        limit_id: "codex",
        primary: { used_percent: p, window_minutes: 300, resets_at: NOW + 3600 },
        secondary: { used_percent: s, window_minutes: 10080, resets_at: NOW - 5 },
      },
    },
  });
fs.writeFileSync(rollout, [rl(5, 1), '{"x":1}', rl(11, 2), '{"y":2}'].join("\n") + "\n");

describe("usage limits", () => {
  it("codex: takes the last rate_limits line and drops expired windows", () => {
    const { codex, claude } = getLimits(NOW);
    assert.equal(claude, null);
    assert.deepEqual(codex.five_hour, { used_percent: 11, resets_at: NOW + 3600 });
    assert.equal(codex.seven_day, null);
  });

  it("claude: cockpit-tee writes the file, passes inner stdout through", () => {
    const input = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 40, resets_at: NOW + 100 },
        seven_day: { used_percentage: 7, resets_at: NOW + 200 },
      },
    });
    const tee = path.join(__dirname, "../../statusline/cockpit-tee.js");
    const r = spawnSync("node", [tee, "--", "cat >/dev/null; echo inner-ok"], {
      input,
      encoding: "utf8",
      env: { ...process.env, HOME },
    });
    assert.equal(r.stdout.trim(), "inner-ok");
    const { claude } = getLimits(NOW);
    assert.deepEqual(claude.five_hour, { used_percent: 40, resets_at: NOW + 100 });
    assert.deepEqual(claude.seven_day, { used_percent: 7, resets_at: NOW + 200 });
    assert.equal(getLimits(NOW + 150).claude.five_hour, null);
  });

  it("tee with no inner command prints nothing and survives bad stdin", () => {
    const tee = path.join(__dirname, "../../statusline/cockpit-tee.js");
    const r = spawnSync("node", [tee], {
      input: "not json",
      encoding: "utf8",
      env: { ...process.env, HOME },
    });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, "");
  });
});
