/**
 * @file Tests for AI Cockpit remote hook config: hook target and token read from ~/.ai-cockpit (remote.json, hook-token), HTTPS required unless the user opted into insecure.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

test("hooks go to the remote.json target with the stored token", async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-remote-"));
  let resolveGot;
  const gotP = new Promise((r) => (resolveGot = r));
  const server = http.createServer((req, res) => {
    resolveGot({ url: req.url, token: req.headers["x-ccam-hook-token"] });
    res.end("{}");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  fs.writeFileSync(
    path.join(home, "remote.json"),
    JSON.stringify({ url: `http://localhost:${port}` })
  );
  fs.writeFileSync(path.join(home, "hook-token"), "sekret\n");
  process.env.AI_COCKPIT_HOME = home;
  delete process.env.CCAM_DASHBOARD_URL;
  delete process.env.CCAM_HOOK_TOKEN;
  delete process.env.CCAM_HOOK_TOKEN_FILE;
  delete require.cache[require.resolve("../../scripts/hook-transport")];
  const { sendHook } = require("../../scripts/hook-transport");
  await sendHook(() => [1], "/api/hooks/event", { a: 1 });
  const got = await Promise.race([gotP, new Promise((r) => setTimeout(() => r(null), 3000))]);
  server.close();
  assert.ok(got, "hook never arrived");
  assert.equal(got.url, "/api/hooks/event");
  assert.equal(got.token, "sekret");
});
