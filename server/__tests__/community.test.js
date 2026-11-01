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

test("config validation rejects bad repo and non-git folders", () => {
  assert.throws(
    () => c.validateConfig({ repo: "x; rm", localPath: "/", label: "cockpit-task" }),
    /owner\/name/
  );
  assert.throws(
    () => c.validateConfig({ repo: "a/b", localPath: "/tmp", label: "cockpit-task" }),
    /git/
  );
});
