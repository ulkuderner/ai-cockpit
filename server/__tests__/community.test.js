/**
 * @file Tests for AI Cockpit community board logic: task states, PR linking, estimates, branch slugs, stale-task flags, per-task activity, the release handover comment and its /config route validation.
 * @author Caglar Ulkuderner
 */

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const c = require("../lib/community");

test("estimate labels", () => {
  assert.equal(c.estimateFromLabels([{ name: "est:3h" }]), 3 * 3_600_000);
  assert.equal(c.estimateFromLabels([{ name: "bug" }, { name: "est:45m" }]), 45 * 60_000);
  assert.equal(c.estimateFromLabels([{ name: "bug" }]), null);
});

test("closed issues from link data and body keywords", () => {
  assert.deepEqual(
    c.closedIssues({ closingIssuesReferences: [{ number: 4 }], body: "Fixes #7, refs #9" }).sort(),
    [4, 7]
  );
});

test("slug is ascii and short", () => {
  assert.equal(c.slug("Çevrimdışı eşitleme: İlk sürüm!"), "cevrimdisi-esitleme-ilk-surum");
});

test("board states: open, mine, taken, review", () => {
  const issues = [
    { number: 1, title: "A", assignees: [], labels: [{ name: "est:2h" }] },
    { number: 2, title: "B", assignees: [{ login: "me" }], labels: [] },
    { number: 3, title: "C", assignees: [{ login: "ali" }], labels: [] },
    { number: 4, title: "D", assignees: [{ login: "ali" }], labels: [] },
    { number: 5, title: "E", assignees: [], labels: [] },
  ];
  const prs = [{ number: 9, url: "u", body: "Closes #4", author: { login: "ali" } }];
  const b = c.buildBoard(issues, prs, "me");
  assert.deepEqual(
    b.tasks.map((t) => t.state),
    ["open", "mine", "taken", "review", "open"]
  );
  assert.equal(b.totals.open_estimate_ms, 2 * 3_600_000);
  assert.equal(b.totals.open_unestimated, 1);
  assert.equal(b.tasks[0].branch, "task/1-a");
});

test("config validation per provider", () => {
  const here = require("path").resolve(__dirname, "../..");
  const bad = (cfg, re) => assert.throws(() => c.validateConfig(cfg), re);
  bad({ provider: "svn", repo: "a/b", localPath: here, label: "x" }, /github, gitlab/);
  bad({ provider: "github", repo: "x; rm", localPath: here, label: "cockpit-task" }, /owner\/name/);
  bad({ provider: "github", repo: "a/b", localPath: "/tmp", label: "cockpit-task" }, /git/);
  bad({ provider: "local", localPath: here, planFile: "../../etc/passwd.md" }, /Plan/);
  c.validateConfig({
    provider: "gitlab",
    repo: "group/sub/project",
    localPath: here,
    label: "cockpit-task",
    host: "gitlab.example.com",
  });
});

test("progress and claim metadata", () => {
  const b = c.buildBoard(
    [
      {
        number: 1,
        title: "A",
        assignees: [{ login: "ali" }],
        labels: [],
        claimed_at: "2026-11-01T10:00:00Z",
      },
    ],
    [
      {
        number: 5,
        url: "u",
        body: "Closes #1",
        author: { login: "ali" },
        review: "APPROVED",
        draft: false,
        created_at: "2026-11-01T12:00:00Z",
      },
    ],
    "me",
    { total: 3, recent: [{ number: 9, title: "X", at: "2026-10-30T00:00:00Z", by: ["veli"] }] }
  );
  assert.equal(b.progress.done, 3);
  assert.equal(b.progress.total, 4);
  assert.equal(b.tasks[0].claimed_at, "2026-11-01T10:00:00Z");
  assert.equal(b.tasks[0].pr.review, "APPROVED");
  assert.equal(b.done[0].by[0], "veli");
});

test("estimate can come from a plan title token", () => {
  assert.equal(c.estimateFromLabels([{ name: "Tam metin arama (est:3h)" }]), 3 * 3_600_000);
});

test("folder picker stays inside home and flags git repos", () => {
  const os = require("os");
  const home = require("fs").realpathSync(os.homedir());
  const r = c.listDirs("");
  assert.equal(r.path, home);
  assert.equal(r.parent, null);
  assert.ok(r.dirs.every((d) => !d.name.startsWith(".")));
  assert.throws(() => c.listDirs("/etc"), /ev dizini/);
  assert.throws(() => c.listDirs(home + "/../.."), /ev dizini/);
});

test("ready, blocked and conflicting tasks", () => {
  const issues = [
    {
      number: 1,
      title: "A",
      assignees: [{ login: "ali" }],
      labels: [],
      body: "Alan: server/lib/**",
    },
    { number: 2, title: "B", assignees: [], labels: [], body: "Alan: server/lib/plan.js" },
    { number: 3, title: "C", assignees: [], labels: [], body: "Alan: client/**\nBağlı: #2, #99" },
    { number: 4, title: "D", assignees: [], labels: [], body: "" },
  ];
  const b = c.buildBoard(issues, [], "me");
  const by = Object.fromEntries(b.tasks.map((t) => [t.number, t]));
  assert.deepEqual(by[2].conflicts_with, [1]);
  assert.equal(by[2].ready, false);
  assert.deepEqual(by[3].blocked_by, [2]); // #99 is not open: counts as done
  assert.equal(by[3].ready, false);
  assert.equal(by[4].ready, true); // no fields: claimable
  assert.equal(b.totals.ready, 1);
});

test("estimate falls back to the body field", () => {
  const b = c.buildBoard(
    [{ number: 1, title: "A", assignees: [], labels: [], body: "est: 30m" }],
    [],
    "me"
  );
  assert.equal(b.tasks[0].estimate_ms, 30 * 60_000);
});

test("a task not in the open state is never ready", () => {
  const issues = [
    { number: 1, title: "A", assignees: [{ login: "me" }], labels: [], body: "" },
    { number: 2, title: "B", assignees: [{ login: "ali" }], labels: [], body: "" },
    { number: 3, title: "C", assignees: [], labels: [], body: "" },
    { number: 4, title: "D", assignees: [], labels: [], body: "" },
  ];
  const prs = [{ number: 9, url: "u", body: "Closes #3", author: { login: "ali" } }];
  const b = c.buildBoard(issues, prs, "me");
  const by = Object.fromEntries(b.tasks.map((t) => [t.number, t]));
  assert.equal(by[1].ready, false); // mine
  assert.equal(by[2].ready, false); // taken
  assert.equal(by[3].ready, false); // review
  assert.equal(by[4].ready, true);
  assert.equal(b.totals.ready, 1);
});

// Claim tests swap the github adapter for a fake (restored afterwards), so
// claim() runs its guards without ever reaching a git subprocess.
const claimCfg = {
  provider: "github",
  repo: "a/b",
  localPath: "/tmp/ai-cockpit-community-test",
  label: "t",
};

async function withFakeAdapter(fake, fn) {
  const real = c._adapters.github;
  c._adapters.github = fake;
  try {
    await fn();
  } finally {
    c._adapters.github = real;
  }
}

test("claim refuses with 409 while a dependency is open", async () => {
  const issues = [
    { number: 2, title: "B", assignees: [], labels: [], body: "" },
    { number: 3, title: "C", assignees: [], labels: [], body: "Bağlı: #2" },
  ];
  let assigned = false;
  await withFakeAdapter(
    {
      reviewName: "PR",
      me: async () => "me",
      snapshot: async () => ({ issues, reviews: [], done: { total: 0, recent: [] } }),
      issue: async (cfg, n) => ({
        number: n,
        title: "C",
        body: "",
        url: null,
        open: true,
        assignees: [],
      }),
      assign: async () => {
        assigned = true;
      },
    },
    async () => {
      await assert.rejects(c.claim(claimCfg, 3), {
        status: 409,
        message: "Önce bitmesi gereken görevler: #2",
      });
    }
  );
  assert.equal(assigned, false); // refused before taking the task
});

test("claim refuses with 409 when another task works the same area", async () => {
  const issues = [
    {
      number: 1,
      title: "A",
      assignees: [{ login: "ali" }],
      labels: [],
      body: "Alan: server/lib/**",
    },
    { number: 2, title: "B", assignees: [], labels: [], body: "Alan: server/lib/plan.js" },
  ];
  let assigned = false;
  await withFakeAdapter(
    {
      reviewName: "PR",
      me: async () => "me",
      snapshot: async () => ({ issues, reviews: [], done: { total: 0, recent: [] } }),
      issue: async (cfg, n) => ({
        number: n,
        title: "B",
        body: "",
        url: null,
        open: true,
        assignees: [],
      }),
      assign: async () => {
        assigned = true;
      },
    },
    async () => {
      await assert.rejects(c.claim(claimCfg, 2), {
        status: 409,
        message: "Aynı alanda çalışan görev var: #1",
      });
    }
  );
  assert.equal(assigned, false); // refused before taking the task
});

test("claim of a task already assigned to me skips both checks (continue work)", async () => {
  // #2 is mine but still has an open dependency (#1) and an area clash with it:
  // either check would refuse a fresh claim. Continuing my own task must get
  // past them; the re-read then reports a lost race, which stops claim before
  // any git call and proves how far it came.
  const issues = [
    {
      number: 1,
      title: "A",
      assignees: [{ login: "ali" }],
      labels: [],
      body: "Alan: server/lib/**",
    },
    {
      number: 2,
      title: "B",
      assignees: [{ login: "me" }],
      labels: [],
      body: "Alan: server/lib/plan.js\nBağlı: #1",
    },
  ];
  let reads = 0;
  const calls = { assign: 0, unassign: 0 };
  await withFakeAdapter(
    {
      reviewName: "PR",
      me: async () => "me",
      snapshot: async () => ({ issues, reviews: [], done: { total: 0, recent: [] } }),
      issue: async (cfg, n) => {
        reads += 1;
        return {
          number: n,
          title: "B",
          body: "",
          url: null,
          open: true,
          assignees: [{ login: reads === 1 ? "me" : "veli" }],
        };
      },
      assign: async () => {
        calls.assign += 1;
      },
      unassign: async () => {
        calls.unassign += 1;
      },
    },
    async () => {
      await assert.rejects(c.claim(claimCfg, 2), {
        status: 409,
        message: "Aynı anda başkası aldı: veli",
      });
    }
  );
  assert.equal(calls.assign, 0); // already mine: no re-assign either
});

test("a task listing itself as a dependency is not blocked by it", () => {
  const b = c.buildBoard(
    [{ number: 5, title: "E", assignees: [], labels: [], body: "Bağlı: #5" }],
    [],
    "me"
  );
  assert.deepEqual(b.tasks[0].blocked_by, []);
  assert.equal(b.tasks[0].ready, true);
});

test("stale only when claimed, idle and past the threshold", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const issues = [
    {
      number: 1,
      title: "A",
      assignees: [{ login: "me" }],
      labels: [],
      body: "",
      claimed_at: "2026-11-04T06:00:00Z",
    },
    {
      number: 2,
      title: "B",
      assignees: [{ login: "me" }],
      labels: [],
      body: "",
      claimed_at: "2026-11-04T06:00:00Z",
    },
    {
      number: 3,
      title: "C",
      assignees: [{ login: "me" }],
      labels: [],
      body: "",
      claimed_at: "2026-11-04T06:00:00Z",
    },
    { number: 4, title: "D", assignees: [], labels: [], body: "" },
  ];
  const activity = {
    2: { last_commit_at: "2026-11-04T11:00:00Z", live: false },
    3: { last_commit_at: null, live: true },
  };
  const b = c.buildBoard(issues, [], "me", undefined, activity, now);
  assert.deepEqual(
    b.tasks.map((t) => t.stale),
    [true, false, false, false]
  );
  assert.equal(b.tasks[1].last_activity_at, "2026-11-04T11:00:00Z");
});

test("a task under review is never stale", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const b = c.buildBoard(
    [
      {
        number: 1,
        title: "A",
        assignees: [{ login: "me" }],
        labels: [],
        body: "",
        claimed_at: "2026-11-04T02:00:00Z",
      },
    ],
    [{ number: 9, url: "u", body: "Closes #1", author: { login: "me" } }],
    "me",
    undefined,
    {},
    now
  );
  assert.equal(b.tasks[0].state, "review");
  assert.equal(b.tasks[0].stale, false);
});

test("someone else's task goes stale by claim time alone", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const b = c.buildBoard(
    [
      {
        number: 1,
        title: "A",
        assignees: [{ login: "ali" }],
        labels: [],
        body: "",
        claimed_at: "2026-11-04T06:00:00Z",
      },
    ],
    [],
    "me",
    undefined,
    {},
    now
  );
  assert.equal(b.tasks[0].state, "taken");
  assert.equal(b.tasks[0].stale, true);
});

test("releaseComment: full text, empty note and no last commit", () => {
  assert.equal(
    c.releaseComment({ branch: "task/7-a", lastSubject: "fix: x", note: " elinde kaldı " }),
    "Yarıda kaldı. Dal: task/7-a. Son commit: fix: x. Not: elinde kaldı"
  );
  assert.equal(
    c.releaseComment({ branch: "task/7-a", lastSubject: null, note: "" }),
    "Yarıda kaldı. Dal: task/7-a. Son commit: yok. Not: -"
  );
});

test("releaseComment caps the note at 500 characters", () => {
  const text = c.releaseComment({ branch: "b", lastSubject: "s", note: "n".repeat(600) });
  assert.equal(text, `Yarıda kaldı. Dal: b. Son commit: s. Not: ${"n".repeat(500)}`);
});

// boardActivity / release tests below run with AI_COCKPIT_HOME (and, for the
// local provider, the whole repo) inside throwaway mkdtemp sandboxes; git goes
// through the module's own runner (`_git`), never a subprocess of this file.
const fs = require("fs");
const os = require("os");
const path = require("path");
const git = (cwd, args) => c._git(cwd, args);
const sandboxes = [];

async function withTempHome(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-task4-"));
  sandboxes.push(root);
  const prev = process.env.AI_COCKPIT_HOME;
  const prevUserHome = process.env.HOME;
  process.env.AI_COCKPIT_HOME = path.join(root, "home");
  // claim reads claude-mem settings from HOME: a closed port, never the real home.
  process.env.HOME = path.join(root, "userhome");
  fs.mkdirSync(path.join(process.env.HOME, ".claude-mem"), { recursive: true });
  fs.writeFileSync(
    path.join(process.env.HOME, ".claude-mem", "settings.json"),
    '{"CLAUDE_MEM_WORKER_PORT":"1"}'
  );
  try {
    return await fn(root);
  } finally {
    process.env.HOME = prevUserHome;
    if (prev === undefined) delete process.env.AI_COCKPIT_HOME;
    else process.env.AI_COCKPIT_HOME = prev;
  }
}

test("boardActivity: a worktree that does not exist reports no commit time and does not throw", async () => {
  await withTempHome(async (root) => {
    const cfg = { provider: "local", localPath: path.join(root, "repo"), planFile: "plan.md" };
    const a = await c.boardActivity(cfg, [{ number: 1, branch: "task/1-a", state: "mine" }], []);
    assert.deepEqual(a, { 1: { last_commit_at: null, live: false } });
  });
});

test("boardActivity: live when an active session cwd sits inside the worktree", async () => {
  await withTempHome(async (root) => {
    const cfg = { provider: "local", localPath: path.join(root, "repo"), planFile: "plan.md" };
    const wt = c.worktreePath(cfg, "task/1-a");
    const a = await c.boardActivity(
      cfg,
      [
        { number: 1, branch: "task/1-a", state: "mine" },
        { number: 2, branch: "task/2-b", state: "taken" },
      ],
      [path.join(wt, "alt"), "/başka-yer"]
    );
    assert.equal(a[1].live, true);
    assert.equal(a[2].live, false);
    assert.equal(a[2].last_commit_at, null); // someone else's machine is invisible
  });
});

test("boardActivity: a sibling folder sharing the name prefix is not live", async () => {
  await withTempHome(async (root) => {
    const cfg = { provider: "local", localPath: path.join(root, "repo"), planFile: "plan.md" };
    const wt10 = c.worktreePath(cfg, "task/10-a");
    const a = await c.boardActivity(cfg, [{ number: 1, branch: "task/1", state: "mine" }], [wt10]);
    assert.equal(c.worktreePath(cfg, "task/1") + "0-a", wt10);
    assert.equal(a[1].live, false);
  });
});

test("release unassigns first, then writes the handover comment", async () => {
  const calls = [];
  await withFakeAdapter(
    {
      reviewName: "PR",
      issue: async (_cfg, n) => ({
        number: n,
        title: "A",
        body: "",
        url: null,
        open: true,
        assignees: [{ login: "me" }],
      }),
      unassign: async (_cfg, n) => calls.push(["unassign", n]),
      comment: async (_cfg, n, text) => calls.push(["comment", n, text]),
    },
    async () => {
      const p = await c.releasePreview(claimCfg, 7, "not");
      assert.deepEqual(calls, []); // preview writes nothing
      const r = await c.release(claimCfg, 7, "not");
      assert.deepEqual(
        calls.map((x) => x[0]),
        ["unassign", "comment"]
      );
      assert.equal(calls[1][2], "Yarıda kaldı. Dal: task/7-a. Son commit: yok. Not: not");
      assert.equal(r.ok, true);
      assert.equal(p.comment, calls[1][2]);
    }
  );
});

test("local release keeps the branch and worktree, stores the note and survives a re-claim", async () => {
  await withTempHome(async (root) => {
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    await git(repo, ["init", "-q", "-b", "main"]);
    await git(repo, ["config", "user.name", "Kokpit Test"]);
    await git(repo, ["config", "user.email", "test@ai-cockpit.example"]);
    fs.writeFileSync(path.join(repo, "plan.md"), "# Plan\n\n### Task 1: İlk\nGövde 1\n");
    fs.writeFileSync(path.join(repo, "f.txt"), "one\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "-qm", "c1"]);
    const cfg = { provider: "local", localPath: repo, planFile: "plan.md" };
    c.writeConfig(cfg);
    const r = await c.claim(cfg, 1);
    fs.writeFileSync(path.join(r.cwd, "f.txt"), "one\ntwo\n");
    await git(r.cwd, ["commit", "-qam", "görev commit'i"]);

    const act = await c.boardActivity(cfg, [{ number: 1, branch: r.branch, state: "mine" }], []);
    assert.match(act[1].last_commit_at, /^\d{4}-\d{2}-\d{2}T\d{2}:/);
    assert.equal(act[1].live, false);

    const out = await c.release(cfg, 1, "yarıda kaldı");
    assert.ok(
      out.comment.startsWith(
        `Yarıda kaldı. Dal: ${r.branch}. Son commit: görev commit'i. Not: yarıda kaldı`
      )
    );
    const claims = c.readConfig().claims;
    assert.equal(claims[1].by, undefined); // assignment gone…
    assert.deepEqual(claims[1].notes, [out.comment]); // …note kept
    assert.ok(fs.existsSync(path.join(r.cwd, ".git"))); // worktree kept
    const branchExists = await git(repo, [
      "rev-parse",
      "-q",
      "--verify",
      `refs/heads/${r.branch}`,
    ]).then(
      () => true,
      () => false
    );
    assert.equal(branchExists, true); // branch kept
    const snap = await c._adapters.local.snapshot(cfg);
    assert.deepEqual(snap.issues[0].assignees, []); // back on the open list

    await c.claim(cfg, 1); // re-claim must not wipe the handover note
    assert.deepEqual(c.readConfig().claims[1].notes, [out.comment]);
  });
});

test("PUT /config rejects staleHours outside 1-168 and accepts 4", async () => {
  await withTempHome(async () => {
    const http = require("http");
    const express = require("express");
    const communityRouter = require("../routes/community");
    const server = express().use(express.json()).use(communityRouter).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const put = (staleHours) =>
      new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port: server.address().port,
            path: "/config",
            method: "PUT",
            headers: { "Content-Type": "application/json" },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
          }
        );
        req.on("error", reject);
        req.end(
          JSON.stringify({
            provider: "github",
            repo: "a/b",
            localPath: path.resolve(__dirname, "../.."),
            label: "t",
            ...(staleHours === undefined ? {} : { staleHours }),
          })
        );
      });
    try {
      assert.equal((await put(0)).status, 400);
      assert.equal((await put(169)).status, 400);
      c.writeConfig({
        provider: "github",
        repo: "a/b",
        localPath: path.resolve(__dirname, "../.."),
        claims: { 1: { by: "x", notes: ["n"] } },
      });
      const ok = await put(4);
      assert.deepEqual(c.readConfig().claims, { 1: { by: "x", notes: ["n"] } }); // saving keeps claims
      assert.equal(ok.status, 200);
      assert.equal(ok.body.staleHours, 4);
      assert.equal(c.readConfig().staleHours, 4);
    } finally {
      server.close();
    }
  });
});

after(() => {
  for (const dir of sandboxes) fs.rmSync(dir, { recursive: true, force: true });
});
