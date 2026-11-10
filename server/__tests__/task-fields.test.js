/**
 * @file Tests for AI Cockpit task fields: Alan/Bağlı/est/Kabul lines in issue bodies, area overlap and the plan-task-to-issue-body writer.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const f = require("../lib/task-fields");

test("parses fields from an issue body", () => {
  const r = f.parseTaskFields(
    "Açıklama\n\nAlan: server/lib/**, client/src/pages/Plan.tsx\nBağlı: #12, #14\nest: 1.5h\nKabul:\n- testler yeşil\n- tahta açılır\n\nson"
  );
  assert.deepEqual(r.area, ["server/lib/**", "client/src/pages/Plan.tsx"]);
  assert.deepEqual(r.deps, [12, 14]);
  assert.equal(r.estimate_ms, 1.5 * 3_600_000);
  assert.deepEqual(r.acceptance, ["testler yeşil", "tahta açılır"]);
});

test("old issue without fields", () => {
  assert.deepEqual(f.parseTaskFields(""), {
    area: [],
    deps: [],
    estimate_ms: null,
    acceptance: [],
  });
  assert.deepEqual(f.parseTaskFields("Bagli: #3").deps, [3]);
});

test("area overlap by literal root", () => {
  assert.equal(f.areasOverlap(["server/lib/**"], ["server/lib/plan.js"]), true);
  assert.equal(f.areasOverlap(["server/lib/plan.js"], ["server/lib/plan.js"]), true);
  assert.equal(f.areasOverlap(["server/lib/**"], ["server/libx/a.js"]), false);
  assert.equal(f.areasOverlap(["client/**"], ["server/**"]), false);
  assert.equal(f.areasOverlap([], ["server/**"]), false);
});

test("issue body from a plan task round-trips", () => {
  const body = f.taskIssueBody({
    body: "Adımlar",
    files: ["server/a.js", "server/b.js"],
    estimate_ms: 45 * 60_000,
    deps: [3],
  });
  const r = f.parseTaskFields(body);
  assert.deepEqual(r.area, ["server/a.js", "server/b.js"]);
  assert.deepEqual(r.deps, [3]);
  assert.equal(r.estimate_ms, 45 * 60_000);
  assert.match(body, /Adımlar/);
});

test("acceptance list ends at the first blank line", () => {
  const r = f.parseTaskFields("Kabul:\n- a\n- b\n\n- c\n- d");
  assert.deepEqual(r.acceptance, ["a", "b"]);
});

test("est in minutes", () => {
  assert.equal(f.parseTaskFields("est: 45m").estimate_ms, 45 * 60_000);
});

test("trailing-slash pattern overlaps files under the directory", () => {
  assert.equal(f.areasOverlap(["server/lib/"], ["server/lib/x.js"]), true);
  assert.equal(f.areasOverlap(["server/lib/"], ["server/libx/a.js"]), false);
});

test("Alan with extra spaces", () => {
  assert.deepEqual(f.parseTaskFields("Alan:   server/a.js ,  server/b.js").area, [
    "server/a.js",
    "server/b.js",
  ]);
  assert.deepEqual(f.parseTaskFields("Alan : server/a.js").area, ["server/a.js"]);
});

test("a whole-repo pattern overlaps everything; an inline Kabul value counts", () => {
  assert.equal(f.areasOverlap(["**"], ["client/a.tsx"]), true);
  assert.deepEqual(f.parseTaskFields("Kabul: testler yeşil\n- tahta açılır").acceptance, [
    "testler yeşil",
    "tahta açılır",
  ]);
});
