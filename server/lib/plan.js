/**
 * @file AI Cockpit plan view: parses a plan Markdown file into phases and tasks, merges manual status/order kept in ~/.ai-cockpit/plans.json, detects running tasks from live sessions/agents that mention the task id, and estimates durations from the time sessions spent on finished tasks.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const STATUSES = new Set(["todo", "done", "blocked"]);

function stateFile() {
  return path.join(
    process.env.AI_COCKPIT_HOME || path.join(os.homedir(), ".ai-cockpit"),
    "plans.json"
  );
}

function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return {
      plans: Array.isArray(s.plans) ? s.plans : [],
      tasks: s.tasks || {},
      order: s.order || {},
    };
  } catch {
    return { plans: [], tasks: {}, order: {} };
  }
}

function writeState(state) {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

/** `## Phase` starts a phase; `### Task 3a: Title` / `### Görev 17c - Title` is a task. */
function parsePlan(markdown) {
  const phases = [];
  let phase = null;
  for (const line of markdown.split(/\r?\n/)) {
    const h2 = /^#{1,2}\s+(.+?)\s*$/.exec(line);
    if (h2) {
      phase = { title: h2[1], tasks: [] };
      phases.push(phase);
      continue;
    }
    const h3 = /^###\s+(?:Task|Görev|Gorev)\s+([0-9]+[a-z]?)\s*[:.\-–]?\s*(.*)$/i.exec(line);
    if (h3) {
      if (!phase) {
        phase = { title: "", tasks: [] };
        phases.push(phase);
      }
      // "(est:3h)" / "(est:45m)" in the heading is the task's own estimate; keep it out of the title.
      const est = /\(?\s*est:\s*(\d+(?:\.\d+)?)\s*([hm])\s*\)?/i.exec(h3[2]);
      phase.tasks.push({
        id: h3[1].toLowerCase(),
        title: h3[2].replace(est ? est[0] : "", "").trim(),
        estimate_ms: est
          ? Number(est[1]) * (est[2].toLowerCase() === "h" ? 3_600_000 : 60_000)
          : null,
      });
    }
  }
  return phases.filter((p) => p.tasks.length > 0);
}

/** "Görev 17a", "Task 17a", "G17a" mention the task; a bare "17a" does not (too many false hits). */
function mentionRegex(id) {
  return new RegExp(`(?:task|g(?:ö|o)rev|\\bg)\\s*${id}(?![0-9a-z])`, "i");
}

/** Nearest ancestor of `file` holding a .git entry; the file's folder when there is none. */
function repoRoot(file) {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.dirname(path.resolve(file));
    dir = up;
  }
}

/**
 * Superpowers SDD ledger for this plan: `<repo>/.superpowers/sdd/<run>/plan-path` names the plan,
 * `progress.md` beside it logs "Task 3a: dispatched" / "Task 3a: complete", at line start or after a bullet/timestamp.
 * Returns finished ids, dispatched-but-unfinished ids (several when agents work in parallel) and the ledger's last
 * line; `found` is false when no ledger points at this plan.
 */
function readLedger(root, planFile) {
  const done = new Set();
  const open = new Set();
  let found = false;
  let last = null;
  const base = path.join(root, ".superpowers", "sdd");
  let runs = [];
  try {
    runs = fs.readdirSync(base);
  } catch {
    return { done, open, found, last };
  }
  for (const run of runs) {
    let text;
    try {
      const target = fs.readFileSync(path.join(base, run, "plan-path"), "utf8").trim();
      if (path.resolve(root, target) !== path.resolve(planFile)) continue;
      text = fs.readFileSync(path.join(base, run, "progress.md"), "utf8");
    } catch {
      continue;
    }
    found = true;
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length) last = lines[lines.length - 1].replace(/^[-*]\s*/, "").slice(0, 200);
    // Entries may sit after a "- 5 Nov 02:31: " bullet; "Task 14a bölüm 1: complete" (a part) does not match.
    for (const m of text.matchAll(/(?<![\w-])Task ([0-9]+[a-z]?): (complete|dispatched)\b/gi)) {
      const id = m[1].toLowerCase();
      if (m[2].toLowerCase() === "complete") {
        done.add(id);
        open.delete(id);
      } else if (!done.has(id)) open.add(id);
    }
  }
  return { done, open, found, last };
}

/**
 * Linked worktrees of the repo (`git worktree add`), read from `.git/worktrees/*` without running git.
 * `task` is the plan task id a branch like `codex/17e` or `task/12-x` ends in, or null.
 */
function worktrees(root) {
  const base = path.join(root, ".git", "worktrees");
  let names = [];
  try {
    names = fs.readdirSync(base);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const dir = path.dirname(fs.readFileSync(path.join(base, name, "gitdir"), "utf8").trim());
      const head = fs.readFileSync(path.join(base, name, "HEAD"), "utf8").trim();
      const m = head.match(/^ref: refs\/heads\/(?:.*\/)?(?:task-?)?([0-9]+[a-z]?)(?:-[^/]*)?$/i);
      out.push({ dir, task: m ? m[1].toLowerCase() : null });
    } catch {
      // half-removed worktree: skip
    }
  }
  return out;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * @param {object} planCfg {id, name, file}
 * @param {Array<{text:string, started_at:string, ended_at:string|null, live:boolean, label:string}>} work
 *   sessions and agents with the text that may mention a task id
 */
/** When the plan file first entered git, as ISO; null outside git. Cached for 10 minutes per file. */
const firstCommitCache = new Map();
function planFirstCommit(file) {
  const hit = firstCommitCache.get(file);
  if (hit && Date.now() - hit.at < 600_000) return hit.value;
  let value = null;
  try {
    const out = require("child_process").execFileSync(
      "git",
      [
        "-C",
        path.dirname(file),
        "log",
        "--diff-filter=A",
        "--format=%cI",
        "--",
        path.basename(file),
      ],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }
    );
    const lines = out.trim().split("\n").filter(Boolean);
    value = lines.length ? new Date(lines[lines.length - 1]).toISOString() : null;
  } catch {
    value = null;
  }
  firstCommitCache.set(file, { at: Date.now(), value });
  return value;
}

/**
 * Calendar pace fallback when no agent time was measured: days since the plan started / tasks done.
 * Exported for tests. Returns { remaining_ms, pace_ms } or nulls.
 */
function calendarPace(startedAt, done, pending, now = Date.now()) {
  const start = Date.parse(startedAt || "");
  if (!Number.isFinite(start) || done <= 0 || now <= start)
    return { remaining_ms: null, pace_ms: null };
  const pace = (now - start) / done;
  return { remaining_ms: Math.round(pace * pending), pace_ms: Math.round(pace) };
}

function buildPlan(planCfg, state, work, now = Date.now(), firstCommit = planFirstCommit) {
  let markdown;
  try {
    markdown = fs.readFileSync(planCfg.file, "utf8");
  } catch (err) {
    return { ...planCfg, error: `Plan dosyası okunamadı: ${err.code || err.message}`, phases: [] };
  }
  const manual = state.tasks[planCfg.id] || {};
  // Only sessions run inside the plan's own repo count; "Task 1" appears in many unrelated projects.
  const root = repoRoot(planCfg.file);
  // `project` is the Claude transcript dir: the launch cwd, kept even after the session cd's away.
  const rootProject = root.replace(/[^a-zA-Z0-9]/g, "-");
  const under = (cwd, dir) => cwd === dir || cwd.startsWith(dir + path.sep);
  const trees = worktrees(root);
  const treeOf = (w) => (w.cwd ? trees.find((t) => under(w.cwd, t.dir)) : undefined);
  work = work.filter(
    (w) => (w.cwd && under(w.cwd, root)) || w.project === rootProject || treeOf(w)
  );
  const phases = parsePlan(markdown);
  const all = phases.flatMap((p) => p.tasks);
  const ledger = readLedger(root, planCfg.file);
  const activeSessions = [...new Set(work.filter((w) => w.live).map((w) => w.label))];
  // Parallel agents: an open task with its own worktree gets that worktree's sessions; the rest share the main checkout's.
  const treeTasks = new Set(trees.map((t) => t.task).filter(Boolean));
  const liveIn = (task) => [
    ...new Set(
      work
        .filter((w) => w.live && (treeTasks.has(task) ? treeOf(w)?.task === task : !treeOf(w)))
        .map((w) => w.label)
    ),
  ];

  for (const task of all) {
    const re = mentionRegex(task.id);
    const hits = work.filter((w) => w.text && re.test(w.text));
    task.spent_ms = hits.reduce((sum, w) => {
      const start = Date.parse(w.started_at);
      const end = w.ended_at ? Date.parse(w.ended_at) : now;
      return Number.isFinite(start) && end > start ? sum + (end - start) : sum;
    }, 0);
    // A ledger names the open tasks; mentions in a long orchestrating session would flag many.
    task.running = ledger.found
      ? ledger.open.has(task.id)
        ? liveIn(task.id)
        : []
      : hits.filter((w) => w.live).map((w) => w.label);
    const starts = hits.map((w) => Date.parse(w.started_at)).filter(Number.isFinite);
    task.started_at = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
    const m = manual[task.id]?.status;
    task.status =
      m === "done" || m === "blocked"
        ? m
        : ledger.done.has(task.id)
          ? "done"
          : task.running.length
            ? "running"
            : "todo";
    task.done_at = m === "done" ? manual[task.id].at || null : null;
  }

  const typical = median(
    all.filter((t) => t.status === "done" && t.spent_ms > 0).map((t) => t.spent_ms)
  );
  for (const task of all) {
    if (task.status === "done") task.remaining_ms = 0;
    else if (typical != null) task.remaining_ms = Math.max(typical - task.spent_ms, 0);
    else
      task.remaining_ms =
        task.estimate_ms == null ? null : Math.max(task.estimate_ms - task.spent_ms, 0);
  }

  const order = state.order[planCfg.id] || [];
  const rank = (t) => {
    const i = order.indexOf(t.id);
    return i === -1 ? order.length + all.indexOf(t) : i;
  };
  const queue = all
    .filter((t) => t.status !== "done")
    .sort((a, b) => (b.status === "running") - (a.status === "running") || rank(a) - rank(b))
    .map((t) => t.id);

  const pending = all.filter((t) => t.status !== "done" && t.status !== "blocked");
  const known = pending.every((t) => t.remaining_ms != null);
  const measured = known && pending.length ? pending.reduce((s, t) => s + t.remaining_ms, 0) : null;
  const doneCount = all.filter((t) => t.status === "done").length;
  const measuredStart =
    all
      .map((t) => t.started_at)
      .filter(Boolean)
      .sort()[0] || null;
  const started_at = measuredStart || firstCommit(planCfg.file);
  const pace = measured == null ? calendarPace(started_at, doneCount, pending.length, now) : null;
  const remaining_ms = measured ?? pace?.remaining_ms ?? null;
  // Calendar pace applies per task too, so the queue can show a running "+N days" for each item.
  if (measured == null && pace?.pace_ms) for (const t of pending) t.remaining_ms = pace.pace_ms;

  return {
    ...planCfg,
    active: activeSessions.length > 0,
    active_sessions: activeSessions,
    last_step: ledger.last,
    phases,
    queue,
    typical_task_ms: typical,
    totals: {
      tasks: all.length,
      done: all.filter((t) => t.status === "done").length,
      running: all.filter((t) => t.status === "running").length,
      blocked: all.filter((t) => t.status === "blocked").length,
      remaining_ms,
      // "agent": measured agent time per task; "calendar": wall-clock pace since the plan started.
      estimate_basis:
        measured != null
          ? typical != null
            ? "agent"
            : "plan"
          : remaining_ms != null
            ? "calendar"
            : null,
      pace_ms: pace?.pace_ms ?? null,
      started_basis: measuredStart ? "sessions" : started_at ? "git" : null,
      done_spent_ms: all.filter((t) => t.status === "done").reduce((s, t) => s + t.spent_ms, 0),
      started_at,
    },
  };
}

module.exports = {
  STATUSES,
  readState,
  writeState,
  parsePlan,
  mentionRegex,
  buildPlan,
  calendarPace,
  stateFile,
};
