/**
 * @file Tests for AI Cockpit community board logic: task states, PR linking, estimates and branch slugs.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
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
