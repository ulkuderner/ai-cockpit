/**
 * @file Tests for the AI Cockpit plan parser, task mention matching, status merge, queue order and duration estimate.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const plan = require("../lib/plan");

const MD = `# Plan
## Dilim A
### Task 1: Iskelet
### Task 2: Kiracılık
## Dilim B
### Görev 17a - Laboratuvar
### Task 17c: Referans
### Task 3: Not a task heading? yes it is
`;

test("parsePlan reads phases and task ids", () => {
  const phases = plan.parsePlan(MD);
  assert.deepEqual(
    phases.map((p) => [p.title, p.tasks.map((t) => t.id)]),
    [
      ["Dilim A", ["1", "2"]],
      ["Dilim B", ["17a", "17c", "3"]],
    ]
  );
});

test("mentionRegex needs a prefix and a full id", () => {
  const re = plan.mentionRegex("17a");
  assert.ok(re.test("Görev 17a'yı uygula"));
  assert.ok(re.test("task 17a"));
  assert.ok(re.test("G17a review"));
  assert.ok(!re.test("Görev 17ab"));
  assert.ok(!re.test("version 17a"));
  assert.ok(!plan.mentionRegex("1").test("Task 17"));
});

test("buildPlan merges manual status, running detection, queue and estimate", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-"));
  const file = path.join(dir, "p.md");
  fs.writeFileSync(file, MD);
  const cfg = { id: "p", name: "P", file };
  const state = {
    plans: [cfg],
    tasks: { p: { 1: { status: "done" }, 2: { status: "done" }, 3: { status: "blocked" } } },
    order: { p: ["17c"] },
  };
  const now = Date.parse("2026-11-01T12:00:00Z");
  const h = 3600_000;
  const work = [
    {
      text: "Task 1",
      started_at: "2026-11-01T00:00:00Z",
      ended_at: "2026-11-01T02:00:00Z",
      live: false,
      label: "a",
    },
    {
      text: "Task 2",
      started_at: "2026-11-01T00:00:00Z",
      ended_at: "2026-11-01T04:00:00Z",
      live: false,
      label: "b",
    },
    {
      text: "Görev 17a başla",
      started_at: "2026-11-01T11:00:00Z",
      ended_at: null,
      live: true,
      label: "grok",
    },
  ];
  const out = plan.buildPlan(cfg, state, work, now);
  const tasks = Object.fromEntries(out.phases.flatMap((p) => p.tasks).map((t) => [t.id, t]));
  assert.equal(out.typical_task_ms, 3 * h);
  assert.equal(tasks["17a"].status, "running");
  assert.deepEqual(tasks["17a"].running, ["grok"]);
  assert.equal(tasks["17a"].remaining_ms, 2 * h);
  assert.equal(tasks["3"].status, "blocked");
  assert.deepEqual(out.queue, ["17a", "17c", "3"]);
  assert.equal(out.totals.remaining_ms, 5 * h);
  assert.equal(out.totals.done, 2);
});

test("buildPlan reports a missing file instead of throwing", () => {
  const out = plan.buildPlan(
    { id: "x", name: "X", file: "/nope/x.md" },
    { tasks: {}, order: {} },
    []
  );
  assert.match(out.error, /okunamadı/);
});
