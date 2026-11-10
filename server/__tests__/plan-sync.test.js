/**
 * @file Tests for AI Cockpit plan sync ("Planı tahtaya aç"): parsePlanSections on both plan styles (body, files, issue marker, estimates equal to parsePlan), the sync flow against a fake adapter (marker right under the heading, a second run updates instead of duplicating, a halfway-stopped run is safe to rerun), the write-free preview, hosted planFile validation, gh issue-number parsing and the GET/POST plan-sync routes.
 * @author Caglar Ulkuderner
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const plan = require("../lib/plan");
const c = require("../lib/community");

// No git subprocess is spawned here (see no-mutating-git-in-tests.test.js):
// the fake adapter answers issue creates/updates and the fake gh is a plain
// echo script. Every plan file lives in a throwaway mkdtemp dir, never in a
// real plan.
const sandbox = [];
let prevHome;
let prevGhBin;

before(() => {
  prevHome = process.env.AI_COCKPIT_HOME;
  prevGhBin = process.env.GH_BIN;
});

after(() => {
  if (prevHome === undefined) delete process.env.AI_COCKPIT_HOME;
  else process.env.AI_COCKPIT_HOME = prevHome;
  if (prevGhBin === undefined) delete process.env.GH_BIN;
  else process.env.GH_BIN = prevGhBin;
  for (const dir of sandbox) fs.rmSync(dir, { recursive: true, force: true });
});

const md =
  "# Plan\n\n### Task 1: Bir (est:30m)\n- Create: `server/a.js`\n- Modify: `server/b.js:10-20`\nadım\n\n### Task 2: İki\n<!-- issue:#41 -->\n- Test: `server/__tests__/b.test.js`\n";

/** Temp dir shaped like a clone (a .git entry is all validateConfig checks) with `text` as the plan file; never a real plan. */
function cfgWithPlan(text) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-sync-"));
  sandbox.push(root);
  const localPath = path.join(root, "repo");
  fs.mkdirSync(path.join(localPath, ".git"), { recursive: true });
  fs.writeFileSync(path.join(localPath, "plan.md"), text);
  return {
    cfg: { provider: "github", repo: "a/b", localPath, label: "t", planFile: "plan.md" },
    planPath: path.join(localPath, "plan.md"),
  };
}

/** Records every call; createIssue hands out numbers from `start`, and the failOnCreate-th create throws. */
function fakeAdapter({ start = 50, failOnCreate = 0 } = {}) {
  const calls = { create: [], update: [] };
  let next = start;
  return {
    calls,
    fake: {
      reviewName: "PR",
      async createIssue(_cfg, issue) {
        if (calls.create.length === failOnCreate - 1) throw new Error("issue açılamadı");
        calls.create.push(issue);
        return next++;
      },
      async updateIssue(_cfg, n, issue) {
        calls.update.push({ n, ...issue });
      },
    },
  };
}

async function withFakeGithub(fake, fn) {
  const real = c._adapters.github;
  c._adapters.github = fake;
  try {
    return await fn();
  } finally {
    c._adapters.github = real;
  }
}

test("plan sections carry body, files and issue marker", () => {
  const s = plan.parsePlanSections(md);
  assert.deepEqual(
    s.map((x) => [x.id, x.issue]),
    [
      ["1", null],
      ["2", 41],
    ]
  );
  assert.deepEqual(s[0].files, ["server/a.js", "server/b.js"]);
  assert.equal(s[0].estimate_ms, 30 * 60_000);
});

test("parsePlanSections reads card plans with parsePlan's own estimates", () => {
  const card = [
    "# Plan",
    "## 5. Görev kartları",
    "### M0 — Depo (≈1 hafta)",
    "#### T01 · Monorepo iskeleti — 1 gün",
    "- **Kabul:** yeşil",
    "#### T02 · Lisans — 0,5 gün",
    "<!-- issue:#9 -->",
    "adım",
    "### M8 — Kalite",
    "#### T26 · Uçtan uca — sürekli",
    "## 6. Sonraki fazlar",
    "",
  ].join("\n");
  const s = plan.parsePlanSections(card);
  const parsed = plan.parsePlan(card).flatMap((p) => p.tasks);
  assert.deepEqual(
    s.map((x) => [x.id, x.title, x.estimate_ms]),
    parsed.map((t) => [t.id, t.title, t.estimate_ms])
  );
  assert.deepEqual(
    s.map((x) => x.issue),
    [null, 9, null]
  );
  assert.equal(s[0].line, 3);
  assert.equal(s[0].body, "- **Kabul:** yeşil"); // ends at the next #### card
  assert.equal(s[1].body, "<!-- issue:#9 -->\nadım"); // ends at ### M8, not at T26
});

test("second sync creates nothing and updates marked tasks", async () => {
  const { cfg, planPath } = cfgWithPlan(md);
  const { fake, calls } = fakeAdapter();
  const first = await c._planSyncWith(fake, cfg);
  assert.deepEqual(first.created, [50]);
  assert.deepEqual(first.updated, [41]);
  const after = fs.readFileSync(planPath, "utf8");
  assert.match(after, /### Task 1: Bir \(est:30m\)\n<!-- issue:#50 -->/);
  assert.equal(calls.create[0].title, "1: Bir");
  assert.match(calls.create[0].body, /Alan: server\/a\.js, server\/b\.js/);
  assert.match(calls.create[0].body, /est: 30m/);
  assert.equal(calls.update[0].n, 41);
  assert.equal(calls.update[0].title, "2: İki");
  const fresh = cfgWithPlan(after);
  const second = await c._planSyncWith(fake, fresh.cfg);
  assert.deepEqual(second.created, []);
  assert.deepEqual(second.updated.sort(), [41, 50]);
});

test("a sync stopped halfway is safe to run again: no duplicate issues", async () => {
  const three =
    "# Plan\n\n### Task 1: Bir\nadım 1\n\n### Task 2: İki\nadım 2\n\n### Task 3: Üç\n<!-- issue:#41 -->\nadım 3\n";
  const { cfg, planPath } = cfgWithPlan(three);
  const broken = fakeAdapter({ failOnCreate: 2 });
  await assert.rejects(c._planSyncWith(broken.fake, cfg), /issue açılamadı/);
  const halfway = fs.readFileSync(planPath, "utf8");
  assert.match(halfway, /### Task 1: Bir\n<!-- issue:#50 -->/); // first issue was saved…
  assert.doesNotMatch(halfway, /### Task 2: İki\n<!-- issue:/); // …the second not yet
  const { fake } = fakeAdapter({ start: 60 });
  const r = await c._planSyncWith(fake, cfg);
  assert.deepEqual(r.created, [60]); // only the task that never got an issue
  assert.deepEqual(r.updated.sort(), [41, 50]);
  const done = fs.readFileSync(planPath, "utf8");
  assert.equal((done.match(/<!-- issue:#50 -->/g) || []).length, 1); // never duplicated
});

test("preview lists creates and updates but writes nothing", async () => {
  const { cfg } = cfgWithPlan(md);
  const { fake, calls } = fakeAdapter();
  await withFakeGithub(fake, async () => {
    const p = await c.planSyncPreview(cfg);
    assert.deepEqual(p.create, [{ id: "1", title: "Bir" }]);
    assert.deepEqual(p.update, [{ id: "2", title: "İki", number: 41 }]);
  });
  assert.deepEqual(calls, { create: [], update: [] });
});

test("plan sync refuses the local provider and a missing plan file", async () => {
  const { cfg } = cfgWithPlan(md);
  await assert.rejects(
    () => c.planSyncPreview({ provider: "local", localPath: cfg.localPath, planFile: "plan.md" }),
    { status: 400, message: "Yerel depoda görevler zaten plan dosyasından okunuyor" }
  );
  const noPlan = { ...cfg, planFile: undefined };
  await assert.rejects(() => c.planSyncPreview(noPlan), {
    status: 400,
    message: "Planı tahtaya açmak için plan dosyası seç",
  });
  const { fake } = fakeAdapter();
  await assert.rejects(c._planSyncWith(fake, noPlan), { status: 400 });
});

test("hosted planFile must be a repo-internal .md file", () => {
  const { cfg } = cfgWithPlan(md);
  c.validateConfig(cfg);
  assert.throws(() => c.validateConfig({ ...cfg, planFile: "../plan-disarda.md" }), /Plan dosyası/);
  const clean = { ...cfg };
  delete clean.planFile;
  c.validateConfig(clean); // still optional for hosted providers
});

/** A fake gh CLI that ignores its args and prints `out`; enough for issue create's number parsing. */
function fakeGh(root, out) {
  const dir = path.join(root, "bin");
  fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, "gh");
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' '${out}'\n`);
  fs.chmodSync(bin, 0o755);
  process.env.GH_BIN = bin;
}

test("github createIssue reads the number from the printed URL and rejects other output", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plan-sync-gh-"));
  sandbox.push(root);
  const gh = c._adapters.github;
  fakeGh(root, "https://github.com/a/b/issues/123");
  assert.equal(
    await gh.createIssue({ repo: "a/b", label: "t" }, { title: "1: Bir", body: "gövde" }),
    123
  );
  fakeGh(root, "issue açıldı");
  await assert.rejects(
    gh.createIssue({ repo: "a/b", label: "t" }, { title: "1: Bir", body: "gövde" }),
    /numarası/
  );
});

test("GET /community/plan-sync previews without writes; POST runs the sync", async () => {
  const { cfg } = cfgWithPlan(md);
  const root = path.dirname(path.dirname(cfg.localPath));
  process.env.AI_COCKPIT_HOME = path.join(root, "home");
  fs.mkdirSync(process.env.AI_COCKPIT_HOME, { recursive: true });
  c.writeConfig(cfg);
  const { fake, calls } = fakeAdapter();
  const http = require("http");
  const express = require("express");
  const communityRouter = require("../routes/community");
  await withFakeGithub(fake, async () => {
    const server = express().use(express.json()).use(communityRouter).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const req = (method) =>
      new Promise((resolve, reject) => {
        const r = http.request(
          {
            hostname: "127.0.0.1",
            port: server.address().port,
            path: "/plan-sync",
            method,
          },
          (res) => {
            let text = "";
            res.on("data", (chunk) => (text += chunk));
            res.on("end", () => {
              // A non-JSON body (an error page) must fail the assertions, not hang the runner.
              let body;
              try {
                body = JSON.parse(text);
              } catch {
                body = text;
              }
              resolve({ status: res.statusCode, body });
            });
          }
        );
        r.on("error", reject);
        r.end();
      });
    try {
      const preview = await req("GET");
      assert.equal(preview.status, 200);
      assert.deepEqual(preview.body.create, [{ id: "1", title: "Bir" }]);
      assert.deepEqual(preview.body.update, [{ id: "2", title: "İki", number: 41 }]);
      assert.deepEqual(calls, { create: [], update: [] }); // GET wrote nothing
      const run = await req("POST");
      assert.equal(run.status, 200);
      assert.deepEqual(run.body, { created: [50], updated: [41] });
      assert.equal(calls.create.length, 1);
    } finally {
      server.close();
    }
  });
});

test("a create that returns no issue number stops the sync instead of opening issue after issue", async () => {
  const { cfg, planPath } = cfgWithPlan(md);
  let creates = 0;
  const bad = {
    reviewName: "PR",
    createIssue: async () => (creates++, undefined),
    updateIssue: async () => {},
  };
  await assert.rejects(c._planSyncWith(bad, cfg), { status: 502 });
  assert.equal(creates, 1);
  assert.doesNotMatch(fs.readFileSync(planPath, "utf8"), /issue:#undefined/);
});

test("the marker keeps the plan file's CRLF line ends", async () => {
  const { cfg, planPath } = cfgWithPlan(md.replace(/\n/g, "\r\n"));
  const { fake } = fakeAdapter();
  await c._planSyncWith(fake, cfg);
  const after = fs.readFileSync(planPath, "utf8");
  assert.match(after, /### Task 1: Bir \(est:30m\)\r\n<!-- issue:#50 -->\r\n/);
  assert.doesNotMatch(after.replace(/\r\n/g, ""), /\n/);
});
