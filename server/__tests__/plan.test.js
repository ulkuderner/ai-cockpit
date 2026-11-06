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
      cwd: dir,
    },
    {
      text: "Task 2",
      started_at: "2026-11-01T00:00:00Z",
      ended_at: "2026-11-01T04:00:00Z",
      live: false,
      label: "b",
      cwd: dir,
    },
    {
      text: "Görev 17a başla",
      started_at: "2026-11-01T11:00:00Z",
      ended_at: null,
      live: true,
      label: "grok",
      cwd: dir,
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
  assert.equal(out.totals.done_spent_ms, 6 * h);
  assert.equal(out.totals.started_at, "2026-11-01T00:00:00.000Z");
  assert.equal(tasks["17a"].started_at, "2026-11-01T11:00:00.000Z");
});

test("buildPlan reports a missing file instead of throwing", () => {
  const out = plan.buildPlan(
    { id: "x", name: "X", file: "/nope/x.md" },
    { tasks: {}, order: {} },
    []
  );
  assert.match(out.error, /okunamadı/);
});

test("buildPlan ignores sessions from other repos", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-repo-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, "docs"));
  const file = path.join(dir, "docs", "p.md");
  fs.writeFileSync(file, "## A\n### Task 1: X\n");
  const cfg = { id: "p", name: "P", file };
  const work = [
    {
      text: "Task 1",
      started_at: "2026-07-04T00:00:00Z",
      ended_at: "2026-07-04T05:00:00Z",
      live: false,
      label: "other",
      cwd: "/elsewhere",
    },
    {
      text: "Task 1",
      started_at: "2026-11-01T00:00:00Z",
      ended_at: "2026-11-01T01:00:00Z",
      live: false,
      label: "mine",
      cwd: dir,
    },
  ];
  const out = plan.buildPlan(cfg, { tasks: {}, order: {} }, work);
  const t = out.phases[0].tasks[0];
  assert.equal(t.spent_ms, 3600_000);
  assert.equal(t.started_at, "2026-11-01T00:00:00.000Z");
});

test("calendar pace fallback: days since start / done x pending", () => {
  const day = 86_400_000;
  const now = Date.parse("2026-11-01T00:00:00Z");
  const r = plan.calendarPace("2026-10-22T00:00:00Z", 20, 30, now);
  assert.equal(r.pace_ms, Math.round((10 * day) / 20));
  assert.equal(r.remaining_ms, Math.round((10 * day) / 20) * 30);
  assert.equal(plan.calendarPace(null, 5, 5, now).remaining_ms, null);
  assert.equal(plan.calendarPace("2026-10-22T00:00:00Z", 0, 5, now).remaining_ms, null);
});

test("buildPlan uses calendar pace and git start when nothing was measured", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-pace-"));
  const file = path.join(dir, "p.md");
  fs.writeFileSync(file, "## A\n### Task 1: X\n### Task 2: Y\n### Task 3: Z\n");
  const now = Date.parse("2026-11-01T00:00:00Z");
  const out = plan.buildPlan(
    { id: "p", name: "P", file },
    { tasks: { p: { 1: { status: "done" } } }, order: {} },
    [],
    now,
    () => "2026-10-30T00:00:00.000Z"
  );
  assert.equal(out.totals.estimate_basis, "calendar");
  assert.equal(out.totals.started_basis, "git");
  assert.equal(out.totals.started_at, "2026-10-30T00:00:00.000Z");
  assert.equal(out.totals.remaining_ms, 2 * 2 * 86_400_000);
  assert.equal(out.phases[0].tasks[1].remaining_ms, 2 * 86_400_000);
});

test("buildPlan starts the calendar at the plan's first commit when sessions begin later", () => {
  const { dir, cfg } = sddRepo("Task 1: complete\n");
  const s = {
    text: "Task 2",
    started_at: "2026-11-01T00:00:00Z",
    ended_at: "2026-11-01T01:00:00Z",
    live: false,
    label: "s",
    cwd: dir,
  };
  const out = plan.buildPlan(
    cfg,
    { tasks: {}, order: {} },
    [s],
    Date.now(),
    () => "2026-10-22T00:00:00.000Z"
  );
  assert.equal(out.totals.started_at, "2026-10-22T00:00:00.000Z");
  assert.equal(out.totals.started_basis, "git");
});

test("(est:Nh) in headings: stripped from title, used when nothing was measured", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-est-"));
  const file = path.join(dir, "p.md");
  fs.writeFileSync(file, "## A\n### Task 1: Giriş (est:2h)\n### Task 2: Ayarlar (est:30m)\n");
  const out = plan.buildPlan(
    { id: "p", name: "P", file },
    { tasks: {}, order: {} },
    [],
    Date.now(),
    () => null
  );
  const [t1, t2] = out.phases[0].tasks;
  assert.equal(t1.title, "Giriş");
  assert.equal(t1.estimate_ms, 2 * 3_600_000);
  assert.equal(out.totals.estimate_basis, "plan");
  assert.equal(out.totals.remaining_ms, 2 * 3_600_000 + 30 * 60_000);
  assert.equal(t2.remaining_ms, 30 * 60_000);
});

function sddRepo(progress) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-sdd-"));
  fs.mkdirSync(path.join(dir, ".git"));
  fs.mkdirSync(path.join(dir, "docs"));
  const file = path.join(dir, "docs", "p.md");
  fs.writeFileSync(file, "## A\n### Task 1: X\n### Task 2: Y\n### Task 3: Z\n");
  const sdd = path.join(dir, ".superpowers", "sdd", "run-1");
  fs.mkdirSync(sdd, { recursive: true });
  fs.writeFileSync(path.join(sdd, "plan-path"), "docs/p.md\n");
  fs.writeFileSync(path.join(sdd, "progress.md"), progress);
  return { dir, cfg: { id: "p", name: "P", file } };
}

test("buildPlan takes done and in-progress tasks from the SDD ledger", () => {
  const { dir, cfg } = sddRepo(
    "Task 1: dispatched\nTask 1: complete (a..b)\nTask 2: dispatched (BASE b)\nTask 1-fidelity: complete.\n"
  );
  const live = [
    {
      text: "",
      started_at: "2026-11-03T00:00:00Z",
      ended_at: null,
      live: true,
      label: "Acurovet",
      cwd: dir,
    },
  ];
  const out = plan.buildPlan(cfg, { tasks: {}, order: {} }, live);
  const t = Object.fromEntries(out.phases[0].tasks.map((x) => [x.id, x]));
  assert.equal(t["1"].status, "done");
  assert.equal(t["2"].status, "running");
  assert.deepEqual(t["2"].running, ["Acurovet"]);
  assert.equal(t["3"].status, "todo");
  assert.equal(out.active, true);
  assert.deepEqual(out.active_sessions, ["Acurovet"]);
  assert.equal(out.last_step, "Task 1-fidelity: complete.");
});

test("buildPlan: a ledger completion beats a manual blocked mark", () => {
  const { cfg } = sddRepo("Task 2: complete (a..b)\n");
  const state = { tasks: { p: { 2: { status: "blocked" }, 3: { status: "blocked" } } }, order: {} };
  const t = plan.buildPlan(cfg, state, []).phases[0].tasks;
  assert.equal(t[1].status, "done");
  assert.equal(t[2].status, "blocked");
});

test("buildPlan reads ledger entries written as timestamped bullets", () => {
  const { cfg } = sddRepo(
    "- 5 Nov 02:31: Task 1: complete (a..b). Opus APPROVED.\n" +
      "- 5 Nov 10:58: Task 2 bölüm 1: complete (b..c).\n" +
      "- 5 Nov 11:00: Task 3: dispatched (BASE c)\n"
  );
  const t = Object.fromEntries(
    plan.buildPlan(cfg, { tasks: {}, order: {} }, []).phases[0].tasks.map((x) => [x.id, x])
  );
  assert.equal(t["1"].status, "done");
  assert.equal(t["2"].status, "todo", "a finished part is not the whole task");
  assert.equal(t["3"].status, "todo");
});

test("buildPlan shows parallel ledger tasks, each with the sessions in its own worktree", () => {
  const { dir, cfg } = sddRepo("Task 1: dispatched\nTask 2: dispatched\nTask 3: dispatched\n");
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), "plan-wt-"));
  const meta = path.join(dir, ".git", "worktrees", "wt1");
  fs.mkdirSync(meta, { recursive: true });
  fs.writeFileSync(path.join(meta, "gitdir"), path.join(wt, ".git") + "\n");
  fs.writeFileSync(path.join(meta, "HEAD"), "ref: refs/heads/codex/2\n");
  const s = (label, cwd) => ({
    text: "",
    started_at: "2026-11-05T00:00:00Z",
    ended_at: null,
    live: true,
    label,
    cwd,
  });
  const out = plan.buildPlan(cfg, { tasks: {}, order: {} }, [
    s("main", dir),
    s("codex", path.join(wt, "app")),
  ]);
  const t = Object.fromEntries(out.phases[0].tasks.map((x) => [x.id, x]));
  assert.deepEqual(t["2"].running, ["codex"]);
  assert.deepEqual(t["1"].running, ["main"]);
  assert.deepEqual(t["3"].running, ["main"]);
  assert.deepEqual(out.active_sessions.sort(), ["codex", "main"]);
});

test("buildPlan leaves a session that mentions many tasks out of task time", () => {
  const { dir, cfg } = sddRepo("Task 1: complete\n");
  fs.writeFileSync(
    cfg.file,
    "## A\n" + [1, 2, 3, 4, 5].map((n) => `### Task ${n}: T${n}\n`).join("")
  );
  const s = (text, h) => ({
    text,
    started_at: "2026-11-01T00:00:00Z",
    ended_at: `2026-11-01T0${h}:00:00Z`,
    live: false,
    label: "s",
    cwd: dir,
  });
  const out = plan.buildPlan(cfg, { tasks: {}, order: {} }, [
    s("Task 1 Task 2 Task 3 Task 4", 9),
    s("Task 1 only", 2),
  ]);
  const t = out.phases[0].tasks;
  assert.equal(t[0].spent_ms, 2 * 3_600_000, "the orchestrating session does not count");
  assert.equal(t[1].spent_ms, 0);
});

test("buildPlan with a ledger ignores task mentions in live sessions", () => {
  const { dir, cfg } = sddRepo("Task 1: complete\n");
  const live = [
    {
      text: "Task 3 later",
      started_at: "2026-11-03T00:00:00Z",
      ended_at: null,
      live: true,
      label: "s",
      cwd: dir,
    },
  ];
  const t3 = plan.buildPlan(cfg, { tasks: {}, order: {} }, live).phases[0].tasks[2];
  assert.equal(t3.status, "todo");
  assert.ok(t3.spent_ms > 0, "mentions still count toward time");
});

test("buildPlan: ledger's open task is not running and the plan not active without a live session", () => {
  const { cfg } = sddRepo("Task 1: complete\nTask 2: dispatched\n");
  const out = plan.buildPlan(cfg, { tasks: {}, order: {} }, []);
  const t = Object.fromEntries(out.phases[0].tasks.map((x) => [x.id, x]));
  assert.equal(t["1"].status, "done");
  assert.equal(t["2"].status, "todo");
  assert.equal(out.active, false);
});

test("buildPlan counts a session launched in the repo even after it cd'd away", () => {
  const { dir, cfg } = sddRepo("");
  const work = [
    {
      text: "",
      started_at: "2026-11-03T00:00:00Z",
      ended_at: null,
      live: true,
      label: "s",
      cwd: "/tmp/scratch",
      project: dir.replace(/[^a-zA-Z0-9]/g, "-"),
    },
  ];
  assert.equal(plan.buildPlan(cfg, { tasks: {}, order: {} }, work).active, true);
});
