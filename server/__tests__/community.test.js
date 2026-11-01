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
