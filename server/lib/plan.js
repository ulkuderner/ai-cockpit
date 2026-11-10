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

// "### Task 3a: Title", "### Görev 17c - Title" or a card id "#### T07b · Title — 2 gün".
const TASK_HEADING =
  /^(#{3,4})\s+(?:(?:Task|Görev|Gorev)\s+([0-9]+[a-z]?)\s*[:.\-–]?|(T[0-9]+[a-z]?)\s*[·:.\-–])\s*(.*)$/i;

/** The task a heading line names: id, cleaned title and its own estimate. Shared by parsePlan and parsePlanSections so both plan styles stay in sync. */
function taskFromHeading(t) {
  let title = t[4];
  // "(est:3h)" / "(est:45m)" or a trailing "— 1,5 gün" is the task's own estimate; keep it out of the title.
  const est = /\(?\s*est:\s*(\d+(?:\.\d+)?)\s*([hm])\s*\)?/i.exec(title);
  // A plan "gün" is counted as a calendar day so the remaining time reads in the plan's own numbers.
  const days = est ? null : /\s*[—–-]\s*(\d+(?:[.,]\d+)?)\s*gün\s*$/i.exec(title);
  const estimate_ms = est
    ? Number(est[1]) * (est[2].toLowerCase() === "h" ? 3_600_000 : 60_000)
    : days
      ? Math.round(Number(days[1].replace(",", ".")) * 86_400_000)
      : null;
  const cut = est || days;
  title = (cut ? title.replace(cut[0], "") : title).replace(/\s*[—–-]\s*sürekli\s*$/i, "");
  return { id: (t[2] || t[3]).toLowerCase(), title: title.trim(), estimate_ms };
}

/** Headings above the task level start a phase (`## Phase`, or `### M0 — ...` over `####` cards). */
function parsePlan(markdown) {
  const lines = markdown.split(/\r?\n/);
  const first = lines.map((l) => TASK_HEADING.exec(l)).find(Boolean);
  const taskLevel = first ? first[1].length : 3;
  const phases = [];
  let phase = null;
  for (const line of lines) {
    const t = TASK_HEADING.exec(line);
    if (t && t[1].length === taskLevel) {
      if (!phase) {
        phase = { title: "", tasks: [] };
        phases.push(phase);
      }
      phase.tasks.push(taskFromHeading(t));
      continue;
    }
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h && h[1].length < taskLevel) {
      phase = { title: h[2], tasks: [] };
      phases.push(phase);
    }
  }
  return phases.filter((p) => p.tasks.length > 0);
}

const ISSUE_MARKER_RE = /^<!--\s*issue:#([0-9]+)\s*-->$/;
const FILE_LINE_RE = /^-\s+(?:Create|Modify|Test)\s*:\s*`([^`]+)`/;

/**
 * One section per plan task, in both plan styles, through parsePlan's own
 * heading rule (the first task heading fixes the task level): `body` runs from
 * the heading to the next heading at the task's level or above, `files`
 * collects the Create/Modify/Test paths (any ":line range" tail dropped, no
 * duplicates), `issue` reads the `<!-- issue:#n -->` marker line right under
 * the heading and `line` is the heading's 0-based line number. Plan sync and
 * the task brief both read sections here, so they can never drift apart.
 */
function parsePlanSections(markdown) {
  const lines = String(markdown).split(/\r?\n/);
  const first = lines.map((l) => TASK_HEADING.exec(l)).find(Boolean);
  if (!first) return [];
  const taskLevel = first[1].length;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const t = TASK_HEADING.exec(lines[i]);
    if (!t || t[1].length !== taskLevel) continue;
    const { id, title, estimate_ms } = taskFromHeading(t);
    const marker = ISSUE_MARKER_RE.exec((lines[i + 1] || "").trim());
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const h = /^(#{1,6})\s/.exec(lines[j]);
      if (h && h[1].length <= taskLevel) {
        end = j;
        break;
      }
    }
    const bodyLines = lines.slice(i + 1, end);
    const files = [];
    for (const line of bodyLines) {
      const m = FILE_LINE_RE.exec(line.trim());
      // ":12-30" after a path is a line range; keep the path only.
      const file = m && m[1].split(":")[0];
      if (file && !files.includes(file)) files.push(file);
    }
    out.push({
      id,
      title,
      estimate_ms,
      body: bodyLines.join("\n"),
      files,
      issue: marker ? Number(marker[1]) : null,
      line: i,
    });
  }
  return out;
}

/** Repo a working directory belongs to; a linked worktree resolves to its main checkout. Null outside git. */
function workRepo(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    const git = path.join(dir, ".git");
    let st;
    try {
      st = fs.statSync(git);
    } catch {
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
      continue;
    }
    if (st.isDirectory()) return dir;
    // worktree: ".git" file says "gitdir: <main>/.git/worktrees/<name>"
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(git, "utf8"));
    const g = m && path.resolve(dir, m[1].trim());
    return g && path.basename(path.dirname(g)) === "worktrees"
      ? path.dirname(path.dirname(path.dirname(g)))
      : dir;
  }
}

const PLAN_DIRS = ["docs/superpowers/plans", "docs/plans", "docs", "plans", "."];

/**
 * The plan a repo is working from: the plan its newest SDD ledger names, else the newest Markdown file
 * in a plans folder, or named like a plan elsewhere in PLAN_DIRS, that parses to at least 3 tasks. Null when there is none.
 */
function findRepoPlan(root) {
  const ledgerBase = path.join(root, ".superpowers", "sdd");
  let best = null;
  try {
    for (const run of fs.readdirSync(ledgerBase)) {
      try {
        const file = path.resolve(
          root,
          fs.readFileSync(path.join(ledgerBase, run, "plan-path"), "utf8").trim()
        );
        const at = fs.statSync(path.join(ledgerBase, run, "progress.md")).mtimeMs;
        if (fs.existsSync(file) && (!best || at > best.at)) best = { file, at };
      } catch {
        // run without a plan-path or progress.md
      }
    }
  } catch {
    // no ledger
  }
  if (best) return best.file;
  for (const sub of PLAN_DIRS) {
    const dir = path.join(root, sub);
    let names = [];
    try {
      // In a folder of plans any Markdown file counts; elsewhere the name must say "plan".
      const plansDir = /plans$/.test(sub);
      names = fs.readdirSync(dir).filter((n) => /\.md$/i.test(n) && (plansDir || /plan/i.test(n)));
    } catch {
      continue;
    }
    for (const n of names) {
      const file = path.join(dir, n);
      try {
        const at = fs.statSync(file).mtimeMs;
        if (best && at <= best.at) continue;
        const tasks = parsePlan(fs.readFileSync(file, "utf8")).reduce(
          (k, p) => k + p.tasks.length,
          0
        );
        if (tasks >= 3) best = { file, at };
      } catch {
        // unreadable file
      }
    }
  }
  return best ? best.file : null;
}

/**
 * Plans of the repos agents worked in during the last `days`, beside the configured ones.
 * Returns { plans: [{id, name, file, discovered: true}], unplanned: [{root, name}] }:
 * `unplanned` lists repos with a live session where no plan was found, so the page can ask for one.
 */
function discoverPlans(work, configured, now = Date.now(), days = 14) {
  const since = now - days * 86_400_000;
  const known = new Set(configured.map((p) => workRepo(p.file) || repoRoot(p.file)));
  const roots = new Map(); // root -> has a live session
  for (const w of work) {
    if (!w.cwd) continue;
    const at = Date.parse(w.ended_at || w.started_at || "");
    if (!w.live && !(at >= since)) continue;
    const root = workRepo(w.cwd);
    if (!root || root === os.homedir() || known.has(root)) continue;
    roots.set(root, roots.get(root) || !!w.live);
  }
  const plans = [];
  const unplanned = [];
  for (const [root, live] of roots) {
    const file = findRepoPlan(root);
    const name = path.basename(root);
    if (file) {
      const id = `auto-${name}-${path.basename(file, ".md")}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-");
      plans.push({ id, name, file, discovered: true });
    } else if (live) unplanned.push({ root, name });
  }
  return { plans, unplanned };
}

/** "Görev 17a", "Task 17a", "G17a" mention the task; a bare "17a" does not (too many false hits). */
function mentionRegex(id) {
  // A card id like "t05" carries its own letter, so it stands alone.
  if (/^[a-z]/.test(id)) return new RegExp(`\\b${id}(?![0-9a-z])`, "i");
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

/** Plan task id a branch like `codex/17e`, `task/12-x` or `feat/T07b` ends in, or null. */
function branchTask(branch) {
  const m = branch.match(/^(?:.*\/)?(?:task-?)?(t?[0-9]+[a-z]?)(?:-[^/]*)?$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Tasks the repo's checked-out branch has finished, read from git: a merged task branch
 * ("Merge pull request #3 from me/feat/T05", "Merge branch 'feat/T05'") or a commit tagged "(T01)".
 * Returns Map id -> commit time (ISO); empty outside git. Cached for a minute per repo.
 */
const mergedCache = new Map();
function planMergedTasks(root) {
  const hit = mergedCache.get(root);
  if (hit && Date.now() - hit.at < 60_000) return hit.value;
  const value = new Map();
  try {
    const out = require("child_process").execFileSync(
      "git",
      ["-C", root, "log", "--format=%cI%x09%s", "HEAD"],
      { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 }
    );
    // git log is newest first; keep the earliest finish of each task.
    for (const line of out.split("\n").reverse()) {
      const [at, subject = ""] = line.split("\t");
      const merge = subject.match(/^Merge (?:pull request #\d+ from |branch ')([^'\s]+)/);
      const tag = subject.match(/\((T[0-9]+[a-z]?)\)\s*$/i);
      const id = merge ? branchTask(merge[1]) : tag ? tag[1].toLowerCase() : null;
      if (id && !value.has(id)) value.set(id, new Date(at).toISOString());
    }
  } catch {
    // not a git repo, or git missing
  }
  mergedCache.set(root, { at: Date.now(), value });
  return value;
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
      const m = head.match(/^ref: refs\/heads\/(.+)$/);
      out.push({ dir, task: m ? branchTask(m[1]) : null });
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

function buildPlan(
  planCfg,
  state,
  work,
  now = Date.now(),
  firstCommit = planFirstCommit,
  mergedTasks = planMergedTasks
) {
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
  // Without a ledger, merged task branches mark finished work.
  const merged = ledger.found ? new Map() : mergedTasks(root);
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

  // A session naming more than a few tasks is orchestrating; counting its whole length for each task
  // inflated every estimate and made the remaining time grow while it stayed open.
  const regexes = new Map(all.map((t) => [t.id, mentionRegex(t.id)]));
  const orchestrating = new Set(
    work.filter((w) => w.text && all.filter((t) => regexes.get(t.id).test(w.text)).length > 3)
  );
  for (const task of all) {
    const re = regexes.get(task.id);
    const hits = work.filter((w) => w.text && re.test(w.text));
    task.spent_ms = hits
      .filter((w) => !orchestrating.has(w))
      .reduce((sum, w) => {
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
    const starts = hits
      .filter((w) => !orchestrating.has(w))
      .map((w) => Date.parse(w.started_at))
      .filter(Number.isFinite);
    task.started_at = starts.length ? new Date(Math.min(...starts)).toISOString() : null;
    const m = manual[task.id]?.status;
    // A ledger "complete" outranks an older manual "blocked" (a blocker the task got past).
    task.status =
      m === "done" || ledger.done.has(task.id) || merged.has(task.id)
        ? "done"
        : m === "blocked"
          ? m
          : task.running.length
            ? "running"
            : "todo";
    task.done_at = (m === "done" ? manual[task.id].at : null) || merged.get(task.id) || null;
  }

  const typical = median(
    all.filter((t) => t.status === "done" && t.spent_ms > 0).map((t) => t.spent_ms)
  );
  for (const task of all) {
    // The plan's own estimate beats a median that a few short mentions can drag to minutes.
    if (task.status === "done") task.remaining_ms = 0;
    else if (task.estimate_ms != null)
      task.remaining_ms = Math.max(task.estimate_ms - task.spent_ms, 0);
    else if (typical != null) task.remaining_ms = Math.max(typical - task.spent_ms, 0);
    else task.remaining_ms = null;
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
  const doneCount = all.filter((t) => t.status === "done").length;
  const measuredStart =
    all
      .map((t) => t.started_at)
      .filter(Boolean)
      .sort()[0] || null;
  // Session history is kept for days, the plan's git history for good: start from whichever is earlier.
  const gitStart = firstCommit(planCfg.file);
  const fromGit = gitStart != null && (measuredStart == null || gitStart < measuredStart);
  const started_at = fromGit ? gitStart : measuredStart;
  // Plan day estimates assume one person; scale them by how fast the finished estimated tasks really went.
  const doneEst = all
    .filter((t) => t.status === "done" && t.estimate_ms != null)
    .reduce((sum, t) => sum + t.estimate_ms, 0);
  const startMs = Date.parse(started_at || "");
  if (doneEst > 0 && Number.isFinite(startMs) && now > startMs) {
    const k = (now - startMs) / doneEst;
    for (const t of pending)
      if (t.estimate_ms != null) t.remaining_ms = Math.round(t.remaining_ms * k);
  }
  const known = pending.every((t) => t.remaining_ms != null);
  const measured = known && pending.length ? pending.reduce((s, t) => s + t.remaining_ms, 0) : null;
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
          ? pending.some((t) => t.estimate_ms == null)
            ? "agent"
            : "plan"
          : remaining_ms != null
            ? "calendar"
            : null,
      pace_ms: pace?.pace_ms ?? null,
      started_basis: fromGit ? "git" : measuredStart ? "sessions" : null,
      done_spent_ms: all.filter((t) => t.status === "done").reduce((s, t) => s + t.spent_ms, 0),
      started_at,
    },
  };
}

module.exports = {
  STATUSES,
  readState,
  writeState,
  TASK_HEADING,
  parsePlan,
  parsePlanSections,
  mentionRegex,
  branchTask,
  workRepo,
  findRepoPlan,
  discoverPlans,
  buildPlan,
  calendarPace,
  stateFile,
};
