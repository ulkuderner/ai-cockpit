/**
 * @file cursor-run.test.js
 * @description Tests the Cursor provider of the Run feature with a fake
 * `cursor-agent` script (CURSOR_AGENT_BIN): exact argv, command-line preview
 * endpoint, stream-json envelopes, completion, and SIGTERM stop.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-run-test-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
const FAKE = path.join(TMP, "fake-cursor-agent.sh");
// Records argv (one per line) to argv.txt; "sleep" prompt blocks until killed.
fs.writeFileSync(
  FAKE,
  `#!/bin/sh
printf '%s\\n' "$@" > "${TMP}/argv.txt"
echo '{"type":"system","subtype":"init","session_id":"cur-sess-12345678"}'
echo '{"type":"assistant","message":"hi"}'
if [ "$5" = "sleep" ] || [ "$4" = "sleep" ]; then exec sleep 30; fi
echo '{"type":"result","subtype":"success"}'
`,
  { mode: 0o755 }
);
process.env.CURSOR_AGENT_BIN = FAKE;

const { createApp } = require("../index");
const cursor = require("../lib/cursor-run-spawner");

let server;
let BASE;
const post = (p, body) =>
  new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(body));
    const u = new URL(p, BASE);
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": data.length },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
      }
    );
    req.on("error", reject);
    req.end(data);
  });
const waitFor = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timeout");
};

describe("cursor run provider", () => {
  before(async () => {
    server = http.createServer(createApp());
    await new Promise((r) => server.listen(0, r));
    BASE = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    await new Promise((r) => server.close(r));
    cursor.__reset();
  });

  it("adds --trust only when the user opts in", async () => {
    const trusted = await post("/api/run/preview", {
      provider: "cursor",
      prompt: "x",
      trust: true,
    });
    assert.deepEqual(trusted.body.argv, [
      "-p",
      "--output-format",
      "stream-json",
      "--trust",
      "--",
      "x",
    ]);
    const plain = await post("/api/run/preview", { provider: "cursor", prompt: "x", trust: "yes" });
    assert.ok(!plain.body.argv.includes("--trust"));
  });

  it("preview returns the exact command line without spawning", async () => {
    const { status, body } = await post("/api/run/preview", {
      provider: "cursor",
      prompt: "fix it's bug",
      model: "gpt-5",
      cwd: TMP,
    });
    assert.equal(status, 200);
    assert.deepEqual(body.argv, [
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      "gpt-5",
      "--",
      "fix it's bug",
    ]);
    assert.equal(
      body.commandLine,
      `${FAKE} -p --output-format stream-json --model gpt-5 -- 'fix it'\\''s bug'`
    );
    assert.equal(cursor.listRuns().length, 0);
    assert.equal(
      (await post("/api/run/preview", { provider: "cursor", prompt: "x", model: "a b;rm" })).status,
      400
    );
    assert.equal((await post("/api/run/preview", { provider: "claude", prompt: "x" })).status, 400);
  });

  it("spawns, streams envelopes and completes", async () => {
    const { status, body } = await post("/api/run", {
      provider: "cursor",
      prompt: "hello; $(touch pwned)",
      model: "gpt-5",
      cwd: TMP,
    });
    assert.equal(status, 201);
    assert.equal(body.provider, "cursor");
    const done = await waitFor(() => {
      const r = cursor.getRun(body.id, { includeEnvelopes: true });
      return r.status === "completed" ? r : null;
    });
    assert.equal(done.sessionId, "cur-sess-12345678");
    assert.deepEqual(
      done.envelopes.map((e) => e.type),
      ["system", "assistant", "result"]
    );
    assert.deepEqual(fs.readFileSync(path.join(TMP, "argv.txt"), "utf8").trim().split("\n"), [
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      "gpt-5",
      "--",
      "hello; $(touch pwned)",
    ]);
    assert.equal(fs.existsSync(path.join(TMP, "pwned")), false);
  });

  it("stop sends SIGTERM", async () => {
    const h = cursor.spawnRun({ prompt: "sleep", cwd: TMP });
    await waitFor(() => cursor.getRun(h.id).status === "running");
    assert.equal(cursor.killRun(h.id), true);
    assert.equal(cursor.getRun(h.id).status, "killed");
    await waitFor(() => h.child.exitCode !== null || h.child.signalCode !== null);
    assert.equal(h.child.signalCode, "SIGTERM");
  });
});
