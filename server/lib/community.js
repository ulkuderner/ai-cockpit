/**
 * @file AI Cockpit community work: a shared task queue on GitHub Issues (label `cockpit-task` by default). Contributors claim the next task with their own `gh` login, code it locally with their own AI agent on a `task/<n>-…` branch, and open a PR that closes the issue. Nothing but GitHub API calls made with the user's own credentials leaves the machine.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const LABEL_RE = /^[\w .:/-]{1,50}$/;

function stateFile() {
  return path.join(
    process.env.AI_COCKPIT_HOME || path.join(os.homedir(), ".ai-cockpit"),
    "community.json"
  );
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(cfg, null, 2));
}

/** Argument-array exec (no shell). Rejects with stderr text on failure. */
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error((stderr || err.message).trim());
          e.code = "ECMD";
          return reject(e);
        }
        resolve(stdout);
      }
    );
  });
}

const gh = (args, opts) => run(process.env.GH_BIN || "gh", args, opts);
const git = (cwd, args) => run("git", ["-C", cwd, ...args]);

function validateConfig({ repo, localPath, label }) {
  if (!REPO_RE.test(repo || ""))
    throw Object.assign(new Error("Depo owner/name biçiminde olmalı"), { status: 400 });
  if (!path.isAbsolute(localPath || "") || !fs.existsSync(path.join(localPath, ".git"))) {
    throw Object.assign(new Error("Yerel klasör bir git klonu olmalı (tam yol)"), { status: 400 });
  }
  if (!LABEL_RE.test(label || ""))
    throw Object.assign(new Error("Geçersiz etiket"), { status: 400 });
}

/** Estimate in ms from an `est:3h` / `est:45m` / `est:1.5h` label; null when absent. */
function estimateFromLabels(labels) {
  for (const l of labels || []) {
    const m = /^est:\s*(\d+(?:\.\d+)?)\s*([hm])$/i.exec(l.name || l);
    if (m) return Number(m[1]) * (m[2].toLowerCase() === "h" ? 3_600_000 : 60_000);
  }
  return null;
}

/** Issue numbers a PR closes, from GitHub's link data or a "Closes #12" style body. */
function closedIssues(pr) {
  const out = new Set((pr.closingIssuesReferences || []).map((r) => r.number));
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  let m;
  while ((m = re.exec(pr.body || ""))) out.add(Number(m[1]));
  return [...out];
}

function slug(title) {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "gorev"
  );
}

const branchFor = (issue) => `task/${issue.number}-${slug(issue.title)}`;

/** Pure: merge issues + PRs into the board the UI shows. Exported for tests. */
function buildBoard(issues, prs, me) {
  const prByIssue = new Map();
  for (const pr of prs) for (const n of closedIssues(pr)) prByIssue.set(n, pr);
  const tasks = issues
    .map((i) => {
      const assignees = (i.assignees || []).map((a) => a.login);
      const pr = prByIssue.get(i.number);
      const state = pr
        ? "review"
        : assignees.length === 0
          ? "open"
          : assignees.includes(me)
            ? "mine"
            : "taken";
      return {
        number: i.number,
        title: i.title,
        url: i.url,
        body: i.body || "",
        assignees,
        estimate_ms: estimateFromLabels(i.labels),
        branch: branchFor(i),
        state,
        pr: pr ? { number: pr.number, url: pr.url, author: pr.author?.login || null } : null,
      };
    })
    .sort((a, b) => a.number - b.number);
  const openTasks = tasks.filter((t) => t.state === "open");
  return {
    me,
    tasks,
    totals: {
      open: openTasks.length,
      mine: tasks.filter((t) => t.state === "mine").length,
      taken: tasks.filter((t) => t.state === "taken").length,
      review: tasks.filter((t) => t.state === "review").length,
      open_estimate_ms: openTasks.reduce((s, t) => s + (t.estimate_ms || 0), 0),
      open_unestimated: openTasks.filter((t) => t.estimate_ms == null).length,
    },
  };
}

let meCache = null;
async function whoami() {
  if (!meCache) meCache = (await gh(["api", "user", "--jq", ".login"])).trim();
  return meCache;
}

async function board(cfg) {
  const [issuesJson, prsJson, me] = await Promise.all([
    gh([
      "issue",
      "list",
      "-R",
      cfg.repo,
      "--label",
      cfg.label,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,url,body,assignees,labels",
    ]),
    gh([
      "pr",
      "list",
      "-R",
      cfg.repo,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,url,body,author,closingIssuesReferences",
    ]),
    whoami(),
  ]);
  return buildBoard(JSON.parse(issuesJson), JSON.parse(prsJson), me);
}

async function getIssue(cfg, number) {
  return JSON.parse(
    await gh([
      "issue",
      "view",
      String(number),
      "-R",
      cfg.repo,
      "--json",
      "number,title,body,assignees,url,state",
    ])
  );
}

async function defaultBranch(cfg) {
  return JSON.parse(await gh(["repo", "view", cfg.repo, "--json", "defaultBranchRef"]))
    .defaultBranchRef.name;
}

/** Claim: refuse if someone else holds it, assign to me, then check out the task branch from the default branch. */
async function claim(cfg, number) {
  const me = await whoami();
  const issue = await getIssue(cfg, number);
  const holders = issue.assignees.map((a) => a.login);
  if (issue.state !== "OPEN") throw Object.assign(new Error("Görev kapalı"), { status: 409 });
  if (holders.length && !holders.includes(me)) {
    throw Object.assign(new Error(`Görev zaten alınmış: ${holders.join(", ")}`), { status: 409 });
  }
  if (!holders.includes(me))
    await gh(["issue", "edit", String(number), "-R", cfg.repo, "--add-assignee", "@me"]);
  // Re-read: two people can click at the same moment; the earliest assignee keeps it.
  const after = (await getIssue(cfg, number)).assignees.map((a) => a.login);
  if (after[0] !== me) {
    await gh(["issue", "edit", String(number), "-R", cfg.repo, "--remove-assignee", "@me"]).catch(
      () => {}
    );
    throw Object.assign(new Error(`Aynı anda başkası aldı: ${after[0]}`), { status: 409 });
  }
  const branch = branchFor(issue);
  const current = (await git(cfg.localPath, ["branch", "--show-current"])).trim();
  if (current !== branch && (await git(cfg.localPath, ["status", "--porcelain"])).trim()) {
    throw Object.assign(
      new Error("Yerel klonda kaydedilmemiş değişiklik var; önce commit'le ya da kenara al"),
      {
        status: 409,
      }
    );
  }
  const base = await defaultBranch(cfg);
  await git(cfg.localPath, ["fetch", "origin", base]);
  const exists = await git(cfg.localPath, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]).then(
    () => true,
    () => false
  );
  if (exists) await git(cfg.localPath, ["checkout", branch]);
  else await git(cfg.localPath, ["checkout", "-b", branch, `origin/${base}`]);
  const prompt =
    `${cfg.repo} #${issue.number}: ${issue.title}\n\n${issue.body || ""}\n\n` +
    `Bu görevi "${branch}" dalında uygula, testlerini yaz ve çalıştır, anlamlı commit'ler at. ` +
    `Push etme ve PR açma; bunu kokpitten ben yapacağım.`;
  return { number: issue.number, branch, cwd: cfg.localPath, prompt };
}

async function release(cfg, number) {
  await gh(["issue", "edit", String(number), "-R", cfg.repo, "--remove-assignee", "@me"]);
  return { ok: true };
}

function prCommands(cfg, issue) {
  const branch = branchFor(issue);
  const title = `#${issue.number}: ${issue.title}`;
  const body = `Closes #${issue.number}\n\nAI Cockpit ile hazırlandı.`;
  return {
    branch,
    title,
    body,
    commands: [
      ["git", "-C", cfg.localPath, "push", "-u", "origin", branch],
      ["gh", "pr", "create", "-R", cfg.repo, "--head", branch, "--title", title, "--body", body],
    ],
  };
}

async function prPreview(cfg, number) {
  const issue = await getIssue(cfg, number);
  const cmd = prCommands(cfg, issue);
  const base = await defaultBranch(cfg);
  const ahead = (
    await git(cfg.localPath, ["log", "--oneline", `origin/${base}..${cmd.branch}`])
  ).trim();
  return { ...cmd, commits: ahead ? ahead.split("\n") : [] };
}

/** Push the task branch and open the PR. Only called after the user confirmed the previewed commands. */
async function openPr(cfg, number) {
  const issue = await getIssue(cfg, number);
  const cmd = prCommands(cfg, issue);
  await git(cfg.localPath, ["push", "-u", "origin", cmd.branch]);
  const url = (
    await gh([
      "pr",
      "create",
      "-R",
      cfg.repo,
      "--head",
      cmd.branch,
      "--title",
      cmd.title,
      "--body",
      cmd.body,
    ])
  ).trim();
  return { url };
}

module.exports = {
  readConfig,
  writeConfig,
  validateConfig,
  board,
  claim,
  release,
  prPreview,
  openPr,
  buildBoard,
  estimateFromLabels,
  closedIssues,
  slug,
};
