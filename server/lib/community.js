/**
 * @file AI Cockpit community work: a shared task queue that contributors claim, code locally with their own AI agent on a `task/<n>-…` branch in its own git worktree under the cockpit home, and hand back for review. Three backends: GitHub (Issues + PRs via `gh`), GitLab (Issues + MRs via `glab api`) and a plain local git repo (tasks from a plan Markdown file in the repo, claims kept on this machine, review = local merge). Nothing but the platform's own API calls, made with the user's own credentials, leaves the machine.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { parsePlan } = require("./plan");
const { parseTaskFields, areasOverlap } = require("./task-fields");
const { gitSafeEnv } = require("./git-env");

const REPO_RE = /^[A-Za-z0-9_.-]+(\/[A-Za-z0-9_.-]+)+$/;
const LABEL_RE = /^[\w .:/-]{1,50}$/;
const HOST_RE = /^[A-Za-z0-9.-]+(:\d+)?$/;
const PROVIDERS = new Set(["github", "gitlab", "local"]);

const cockpitHome = () => process.env.AI_COCKPIT_HOME || path.join(os.homedir(), ".ai-cockpit");

function stateFile() {
  return path.join(cockpitHome(), "community.json");
}

function readConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return { provider: "github", ...cfg };
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(cfg, null, 2));
}

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Argument-array exec (no shell). Rejects with stderr text on failure. */
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          const e = new Error(
            err.code === "ENOENT"
              ? `${bin} bulunamadı; kurulu ve PATH'te olmalı`
              : (stderr || err.message).trim()
          );
          e.code = "ECMD";
          return reject(e);
        }
        resolve(stdout);
      }
    );
  });
}

// Repo-scoped git: argument array plus a scrubbed environment, so a leaked
// GIT_DIR (git exports one to every hook) can never outrank the `-C` target.
const git = (cwd, args) => run("git", ["-C", cwd, ...args], { env: gitSafeEnv() });

function validateConfig(cfg) {
  if (!PROVIDERS.has(cfg.provider)) throw fail(400, "Sağlayıcı github, gitlab ya da local olmalı");
  const staleHours = cfg.staleHours ?? 4;
  if (!Number.isInteger(staleHours) || staleHours < 1 || staleHours > 168)
    throw fail(400, "Sahipsiz görev eşiği (staleHours) 1-168 arasında bir tam saat olmalı");
  if (!path.isAbsolute(cfg.localPath || "") || !fs.existsSync(path.join(cfg.localPath, ".git"))) {
    throw fail(400, "Yerel klasör bir git deposu olmalı (tam yol)");
  }
  if (cfg.provider === "local") {
    const plan = path.resolve(cfg.localPath, cfg.planFile || "");
    if (
      !plan.startsWith(cfg.localPath + path.sep) ||
      !plan.endsWith(".md") ||
      !fs.existsSync(plan)
    ) {
      throw fail(400, "Plan dosyası depo içinde bir .md dosyası olmalı");
    }
    return;
  }
  if (!REPO_RE.test(cfg.repo || ""))
    throw fail(400, "Depo owner/name (GitLab'da group/subgroup/name) biçiminde olmalı");
  if (!LABEL_RE.test(cfg.label || "")) throw fail(400, "Geçersiz etiket");
  if (cfg.host && !HOST_RE.test(cfg.host)) throw fail(400, "Geçersiz GitLab sunucusu");
}

/** Estimate in ms from an `est:3h` / `est:45m` / `est:1.5h` label or title token; null when absent. */
function estimateFromLabels(labels) {
  for (const l of labels || []) {
    const m = /(?:^|\s|\()est:\s*(\d+(?:\.\d+)?)\s*([hm])\b/i.exec(` ${l.name || l}`);
    if (m) return Number(m[1]) * (m[2].toLowerCase() === "h" ? 3_600_000 : 60_000);
  }
  return null;
}

/** Issue numbers a PR/MR closes, from link data or a "Closes #12" style body. */
function closedIssues(pr) {
  const out = new Set((pr.closingIssuesReferences || []).map((r) => r.number));
  const re = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  let m;
  while ((m = re.exec(pr.body || ""))) out.add(Number(m[1]));
  return [...out];
}

function slug(title) {
  return (
    String(title)
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

/**
 * Pure: merge normalized issues + review requests into the board the UI shows. Exported for tests.
 * issues: [{ number, title, url, body, assignees: [{login}], labels: [{name}] }]
 * prs:    [{ number, url, body, author: {login}, closingIssuesReferences? }]
 * activity: { [number]: { last_commit_at: string|null, live: boolean } } from boardActivity.
 * The issue body's Alan/Bağlı/est/Kabul lines feed each task's area/deps/acceptance
 * fields and its readiness: a dep blocks only while it is on the open list (closed
 * or unknown numbers count as done), an area clashes with any task already being
 * worked on (mine/taken/review). A claimed task goes stale (sahipsiz kalmış) when
 * no agent session is live in its worktree and its last activity (branch tip
 * commit, else claimed_at) is older than staleMs.
 */
function buildBoard(
  issues,
  prs,
  me,
  done = { total: 0, recent: [] },
  activity = {},
  now = Date.now(),
  staleMs = 4 * 3_600_000
) {
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
      const fields = parseTaskFields(i.body || "");
      return {
        number: i.number,
        title: i.title,
        url: i.url || null,
        body: i.body || "",
        assignees,
        area: fields.area,
        deps: fields.deps,
        acceptance: fields.acceptance,
        estimate_ms: estimateFromLabels(i.labels) ?? fields.estimate_ms,
        branch: branchFor(i),
        state,
        claimed_at: i.claimed_at || null,
        updated_at: i.updated_at || null,
        pr: pr
          ? {
              number: pr.number,
              url: pr.url || null,
              author: pr.author?.login || null,
              created_at: pr.created_at || null,
              draft: !!pr.draft,
              review: pr.review || null,
            }
          : null,
      };
    })
    .sort((a, b) => a.number - b.number);
  const openNumbers = new Set(tasks.map((t) => t.number));
  const busyNumbers = new Set(tasks.filter((t) => t.state !== "open").map((t) => t.number));
  for (const t of tasks) {
    t.blocked_by = t.deps.filter((d) => d !== t.number && openNumbers.has(d));
    t.conflicts_with = tasks
      .filter(
        (o) => o.number !== t.number && busyNumbers.has(o.number) && areasOverlap(t.area, o.area)
      )
      .map((o) => o.number);
    t.ready = t.state === "open" && t.blocked_by.length === 0 && t.conflicts_with.length === 0;
    const act = activity[t.number] || {};
    t.last_activity_at = act.last_commit_at || t.claimed_at || null;
    t.stale =
      (t.state === "mine" || t.state === "taken") &&
      !act.live &&
      t.last_activity_at != null &&
      now - Date.parse(t.last_activity_at) > staleMs;
  }
  const openTasks = tasks.filter((t) => t.state === "open");
  const all = tasks.length + done.total;
  return {
    me,
    tasks,
    done: done.recent,
    progress: { done: done.total, total: all, ratio: all ? done.total / all : null },
    totals: {
      open: openTasks.length,
      mine: tasks.filter((t) => t.state === "mine").length,
      taken: tasks.filter((t) => t.state === "taken").length,
      review: tasks.filter((t) => t.state === "review").length,
      ready: tasks.filter((t) => t.ready).length,
      open_estimate_ms: openTasks.reduce((s, t) => s + (t.estimate_ms || 0), 0),
      open_unestimated: openTasks.filter((t) => t.estimate_ms == null).length,
    },
  };
}

// ── GitHub (gh) ─────────────────────────────────────────────────────────────

const gh = (args) => run(process.env.GH_BIN || "gh", args);

const github = {
  reviewName: "PR",
  async me() {
    return (await gh(["api", "user", "--jq", ".login"])).trim();
  },
  async snapshot(cfg) {
    const [owner, name] = cfg.repo.split("/");
    const query = `query($owner:String!,$name:String!,$label:String!){repository(owner:$owner,name:$name){
      open:issues(first:100,states:OPEN,labels:[$label],orderBy:{field:CREATED_AT,direction:ASC}){nodes{
        number title url body updatedAt assignees(first:5){nodes{login}} labels(first:20){nodes{name}}
        timelineItems(itemTypes:[ASSIGNED_EVENT],last:1){nodes{...on AssignedEvent{createdAt}}}}}
      done:issues(first:20,states:CLOSED,labels:[$label],orderBy:{field:UPDATED_AT,direction:DESC}){totalCount nodes{
        number title url closedAt assignees(first:5){nodes{login}}}}
      pullRequests(first:100,states:OPEN){nodes{number url body createdAt isDraft reviewDecision author{login}
        closingIssuesReferences(first:10){nodes{number}}}}}}`;
    const r = JSON.parse(
      await gh([
        "api",
        "graphql",
        "-f",
        `query=${query}`,
        "-f",
        `owner=${owner}`,
        "-f",
        `name=${name}`,
        "-f",
        `label=${cfg.label}`,
      ])
    ).data.repository;
    return {
      issues: r.open.nodes.map((i) => ({
        number: i.number,
        title: i.title,
        url: i.url,
        body: i.body,
        updated_at: i.updatedAt,
        assignees: i.assignees.nodes,
        labels: i.labels.nodes,
        claimed_at: i.assignees.nodes.length ? i.timelineItems.nodes[0]?.createdAt || null : null,
      })),
      reviews: r.pullRequests.nodes.map((p) => ({
        number: p.number,
        url: p.url,
        body: p.body,
        author: p.author,
        created_at: p.createdAt,
        draft: p.isDraft,
        review: p.reviewDecision, // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
        closingIssuesReferences: p.closingIssuesReferences.nodes,
      })),
      done: {
        total: r.done.totalCount,
        recent: r.done.nodes.map((i) => ({
          number: i.number,
          title: i.title,
          url: i.url,
          at: i.closedAt,
          by: i.assignees.nodes.map((a) => a.login),
        })),
      },
    };
  },
  async issues(cfg) {
    return JSON.parse(
      await gh([
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
      ])
    );
  },
  async reviews(cfg) {
    return JSON.parse(
      await gh([
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
      ])
    );
  },
  async issue(cfg, n) {
    const i = JSON.parse(
      await gh([
        "issue",
        "view",
        String(n),
        "-R",
        cfg.repo,
        "--json",
        "number,title,body,assignees,url,state",
      ])
    );
    return { ...i, open: i.state === "OPEN" };
  },
  async members(cfg) {
    try {
      const list = JSON.parse(
        await gh(["api", `repos/${cfg.repo}/collaborators?affiliation=all&per_page=100`])
      );
      return list.map((m) => ({ login: m.login, role: m.role_name || null, url: m.html_url }));
    } catch {
      // Listing collaborators needs push access; contributors are public to every reader.
      const list = JSON.parse(await gh(["api", `repos/${cfg.repo}/contributors?per_page=100`]));
      return list.map((m) => ({
        login: m.login,
        role: "contributor",
        url: m.html_url,
        commits: m.contributions,
      }));
    }
  },
  assign: (cfg, n) => gh(["issue", "edit", String(n), "-R", cfg.repo, "--add-assignee", "@me"]),
  unassign: (cfg, n) =>
    gh(["issue", "edit", String(n), "-R", cfg.repo, "--remove-assignee", "@me"]),
  comment: (cfg, n, text) => gh(["issue", "comment", String(n), "-R", cfg.repo, "--body", text]),
  async defaultBranch(cfg) {
    return JSON.parse(await gh(["repo", "view", cfg.repo, "--json", "defaultBranchRef"]))
      .defaultBranchRef.name;
  },
  reviewCommand(cfg, { branch, base, title, body }) {
    return [
      "gh",
      "pr",
      "create",
      "-R",
      cfg.repo,
      "--head",
      branch,
      "--base",
      base,
      "--title",
      title,
      "--body",
      body,
    ];
  },
  async openReview(cfg, req) {
    const [, ...args] = this.reviewCommand(cfg, req);
    return (await gh(args)).trim();
  },
};

// ── GitLab (glab api, REST v4) ──────────────────────────────────────────────

function glab(cfg, endpoint, args = []) {
  const host = cfg.host ? ["--hostname", cfg.host] : [];
  // :proj is a custom placeholder; glab encodes it as one path segment (group%2Fproject).
  return run(process.env.GLAB_BIN || "glab", [
    "api",
    endpoint,
    "--placeholder",
    `proj=${cfg.repo}`,
    ...host,
    ...args,
  ]).then((out) => JSON.parse(out || "null"));
}

let gitlabMe = null;
const gitlab = {
  reviewName: "MR",
  async me(cfg) {
    gitlabMe = gitlabMe || (await glab(cfg, "user"));
    return gitlabMe.username;
  },
  async issues(cfg) {
    const label = encodeURIComponent(cfg.label);
    const list = await glab(cfg, `projects/:proj/issues?state=opened&labels=${label}&per_page=100`);
    return list.map((i) => ({
      number: i.iid,
      title: i.title,
      url: i.web_url,
      body: i.description || "",
      assignees: (i.assignees || []).map((a) => ({ login: a.username, id: a.id })),
      labels: (i.labels || []).map((name) => ({ name })),
      // GitLab has no cheap assignment timestamp; last activity is the closest signal.
      updated_at: i.updated_at,
    }));
  },
  async snapshot(cfg) {
    const label = encodeURIComponent(cfg.label);
    const [issues, reviews, closed, stats] = await Promise.all([
      this.issues(cfg),
      this.reviews(cfg),
      glab(
        cfg,
        `projects/:proj/issues?state=closed&labels=${label}&order_by=updated_at&per_page=20`
      ),
      glab(cfg, `projects/:proj/issues_statistics?labels=${label}`),
    ]);
    return {
      issues,
      reviews,
      done: {
        total: stats?.statistics?.counts?.closed ?? closed.length,
        recent: closed.map((i) => ({
          number: i.iid,
          title: i.title,
          url: i.web_url,
          at: i.closed_at,
          by: (i.assignees || []).map((a) => a.username),
        })),
      },
    };
  },
  async reviews(cfg) {
    const list = await glab(cfg, "projects/:proj/merge_requests?state=opened&per_page=100");
    return list.map((m) => ({
      number: m.iid,
      url: m.web_url,
      body: m.description || "",
      author: { login: m.author?.username },
      created_at: m.created_at,
      draft: !!m.draft,
      review: m.detailed_merge_status === "mergeable" ? "APPROVED" : null,
    }));
  },
  async issue(cfg, n) {
    const i = await glab(cfg, `projects/:proj/issues/${n}`);
    return {
      number: i.iid,
      title: i.title,
      body: i.description || "",
      url: i.web_url,
      open: i.state === "opened",
      assignees: (i.assignees || []).map((a) => ({ login: a.username, id: a.id })),
    };
  },
  async members(cfg) {
    const ROLE = {
      5: "minimal",
      10: "guest",
      15: "planner",
      20: "reporter",
      30: "developer",
      40: "maintainer",
      50: "owner",
    };
    const list = await glab(cfg, "projects/:proj/members/all?per_page=100");
    return list.map((m) => ({
      login: m.username,
      name: m.name,
      role: ROLE[m.access_level] || String(m.access_level),
      url: m.web_url,
    }));
  },
  async assign(cfg, n) {
    await this.me(cfg);
    const issue = await this.issue(cfg, n);
    const ids = [...new Set([...issue.assignees.map((a) => a.id), gitlabMe.id])];
    await glab(cfg, `projects/:proj/issues/${n}`, [
      "-X",
      "PUT",
      "-F",
      `assignee_ids=${JSON.stringify(ids)}`,
    ]);
  },
  async unassign(cfg, n) {
    await this.me(cfg);
    const issue = await this.issue(cfg, n);
    const ids = issue.assignees.map((a) => a.id).filter((id) => id !== gitlabMe.id);
    await glab(cfg, `projects/:proj/issues/${n}`, [
      "-X",
      "PUT",
      "-F",
      `assignee_ids=${JSON.stringify(ids)}`,
    ]);
  },
  comment(cfg, n, text) {
    return glab(cfg, `projects/:proj/issues/${n}/notes`, ["-X", "POST", "-f", `body=${text}`]);
  },
  async defaultBranch(cfg) {
    return (await glab(cfg, "projects/:proj")).default_branch;
  },
  reviewCommand(cfg, { branch, base, title, body }) {
    return [
      "glab",
      "api",
      `projects/${cfg.repo}/merge_requests`,
      "-X",
      "POST",
      "-f",
      `source_branch=${branch}`,
      "-f",
      `target_branch=${base}`,
      "-f",
      `title=${title}`,
      "-f",
      `description=${body}`,
    ];
  },
  async openReview(cfg, { branch, base, title, body }) {
    const mr = await glab(cfg, "projects/:proj/merge_requests", [
      "-X",
      "POST",
      "-f",
      `source_branch=${branch}`,
      "-f",
      `target_branch=${base}`,
      "-f",
      `title=${title}`,
      "-f",
      `description=${body}`,
    ]);
    return mr.web_url;
  },
};

// ── Local git (plan file in the repo, claims on this machine) ───────────────
// shortcut: claims live in community.json on this machine only; a team sharing one repo
// over a network should use GitHub/GitLab so claims are visible to everyone.

async function localMe(cfg) {
  const name = (await git(cfg.localPath, ["config", "user.name"]).catch(() => "")).trim();
  return name || os.userInfo().username;
}

function localTasks(cfg) {
  const md = fs.readFileSync(path.resolve(cfg.localPath, cfg.planFile), "utf8");
  // Plan ids may be "17a"; the board needs numbers, so keep the plan order as the number.
  return parsePlan(md)
    .flatMap((p) => p.tasks)
    .map((t, i) => ({
      ...t,
      number: i + 1,
      est: t.title,
      title: t.title.replace(/\s*\(?est:\s*\d+(?:\.\d+)?\s*[hm]\)?/i, "").trim(),
    }));
}

const local = {
  reviewName: "merge",
  me: (cfg) => localMe(cfg),
  async issues(cfg) {
    const claims = readConfig()?.claims || {};
    return localTasks(cfg)
      .filter((t) => claims[t.number]?.status !== "done")
      .map((t) => ({
        number: t.number,
        title: `${t.id}: ${t.title}`,
        url: null,
        body: "",
        assignees: claims[t.number]?.by ? [{ login: claims[t.number].by }] : [],
        labels: [{ name: t.est }],
      }));
  },
  async reviews() {
    return [];
  },
  async members(cfg) {
    const out = await git(cfg.localPath, ["shortlog", "-sne", "--all"]).catch(() => "");
    return out
      .split("\n")
      .map((l) => /^\s*(\d+)\s+(.+?)\s+<([^>]*)>$/.exec(l))
      .filter(Boolean)
      .map(([, n, name]) => ({ login: name, role: "committer", url: null, commits: Number(n) }));
  },
  async snapshot(cfg) {
    const claims = readConfig()?.claims || {};
    const tasks = localTasks(cfg);
    const finished = tasks.filter((t) => claims[t.number]?.status === "done");
    return {
      issues: (await this.issues(cfg)).map((i) => ({
        ...i,
        claimed_at: claims[i.number]?.at || null,
      })),
      reviews: [],
      done: {
        total: finished.length,
        recent: finished
          .map((t) => ({
            number: t.number,
            title: `${t.id}: ${t.title}`,
            url: null,
            at: claims[t.number].at,
            by: [claims[t.number].by].filter(Boolean),
          }))
          .sort((a, b) => String(b.at).localeCompare(String(a.at)))
          .slice(0, 20),
      },
    };
  },
  async issue(cfg, n) {
    const t = localTasks(cfg).find((x) => x.number === n);
    if (!t) throw fail(404, "Görev planda yok");
    const claim = readConfig()?.claims?.[n];
    return {
      number: n,
      title: `${t.id}: ${t.title}`,
      body: "",
      url: null,
      open: claim?.status !== "done",
      assignees: claim?.by ? [{ login: claim.by }] : [],
    };
  },
  async assign(cfg, n) {
    const c = readConfig();
    c.claims = {
      ...(c.claims || {}),
      // keep earlier fields (a release note, a done mark) while re-claiming
      [n]: { ...(c.claims?.[n] || {}), by: await localMe(cfg), at: new Date().toISOString() },
    };
    writeConfig(c);
  },
  async unassign(cfg, n) {
    const c = readConfig();
    if (c.claims) delete c.claims[n];
    writeConfig(c);
  },
  async comment(cfg, n, text) {
    // The local stand-in for an issue comment: append to the claim's notes so
    // the next claimer (and the board) can read the handover.
    const c = readConfig() || {};
    const prev = c.claims?.[n] || {};
    c.claims = { ...(c.claims || {}), [n]: { ...prev, notes: [...(prev.notes || []), text] } };
    writeConfig(c);
  },
  async defaultBranch(cfg) {
    const head = await git(cfg.localPath, [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]).catch(() => "");
    if (head.trim()) return head.trim().replace(/^origin\//, "");
    for (const b of ["main", "master"]) {
      if (
        await git(cfg.localPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]).then(
          () => true,
          () => false
        )
      )
        return b;
    }
    return (await git(cfg.localPath, ["branch", "--show-current"])).trim();
  },
  reviewCommand(cfg, { branch, base, title }) {
    return [
      "git",
      "-C",
      cfg.localPath,
      "merge",
      "--no-ff",
      branch,
      "-m",
      title,
      "(",
      base,
      "dalında",
      ")",
    ];
  },
  async openReview(cfg, { branch, base, title }, number) {
    // The merge runs in the main repo, so its tree must be clean first; claiming
    // no longer checks this (the task lives in its own worktree).
    if ((await git(cfg.localPath, ["status", "--porcelain"])).trim())
      throw fail(409, "Yerel depoda kaydedilmemiş değişiklik var; önce commit'le ya da kenara al");
    await git(cfg.localPath, ["checkout", base]);
    await git(cfg.localPath, ["merge", "--no-ff", branch, "-m", title]);
    const c = readConfig();
    c.claims = {
      ...(c.claims || {}),
      [number]: { ...(c.claims?.[number] || {}), status: "done", at: new Date().toISOString() },
    };
    writeConfig(c);
    return null;
  },
};

const ADAPTERS = { github, gitlab, local };
const adapter = (cfg) => ADAPTERS[cfg.provider] || github;
const hasRemote = (cfg) => cfg.provider !== "local";

// ── Operations ──────────────────────────────────────────────────────────────

const meCache = new Map();
async function whoami(cfg) {
  const key = `${cfg.provider}|${cfg.host || ""}|${cfg.localPath}`;
  if (!meCache.has(key)) meCache.set(key, await adapter(cfg).me(cfg));
  return meCache.get(key);
}

async function board(cfg, liveCwds = []) {
  const a = adapter(cfg);
  const [snap, me] = await Promise.all([a.snapshot(cfg), whoami(cfg)]);
  const plain = buildBoard(snap.issues, snap.reviews, me, snap.done);
  const activity = await boardActivity(cfg, plain.tasks, liveCwds);
  const staleHours = Number.isInteger(cfg.staleHours) ? cfg.staleHours : 4;
  return {
    provider: cfg.provider,
    review_name: a.reviewName,
    ...buildBoard(
      snap.issues,
      snap.reviews,
      me,
      snap.done,
      activity,
      Date.now(),
      staleHours * 3_600_000
    ),
  };
}

/**
 * Per-task activity for the stale flag. My tasks report their branch tip's
 * commit time from the task's own worktree (someone else's machine is
 * invisible; their tasks go by claimed_at alone), and `live` says an active
 * agent session works in that worktree right now (liveCwds = the working
 * directories of active sessions). Exported for tests and the Worktrunk path.
 */
async function boardActivity(cfg, tasks, liveCwds = []) {
  const out = {};
  for (const t of tasks || []) {
    const mine = t.state === "mine" || t.mine === true;
    const wt = worktreePath(cfg, t.branch);
    let last_commit_at = null;
    if (mine && fs.existsSync(wt)) {
      last_commit_at =
        (await git(wt, ["log", "-1", "--format=%cI", t.branch]).catch(() => "")).trim() || null;
    }
    const live = (liveCwds || []).some((p) => p && (p === wt || p.startsWith(wt + path.sep)));
    out[t.number] = { last_commit_at, live };
  }
  return out;
}

/** Fresh claims only: read the same board the UI shows and refuse while an open dependency or an area clash stands. */
async function refuseIfNotReady(cfg, number, me) {
  const snap = await adapter(cfg).snapshot(cfg);
  const task = buildBoard(snap.issues, snap.reviews, me, snap.done).tasks.find(
    (t) => t.number === number
  );
  if (!task) return;
  if (task.blocked_by.length)
    throw fail(
      409,
      `Önce bitmesi gereken görevler: ${task.blocked_by.map((n) => `#${n}`).join(", ")}`
    );
  if (task.conflicts_with.length)
    throw fail(
      409,
      `Aynı alanda çalışan görev var: ${task.conflicts_with.map((n) => `#${n}`).join(", ")}`
    );
}

/**
 * Worktree folder for one task branch under the cockpit home: worktrees/<repo>/<branch>.
 * Both segments are slugged, so a crafted branch name can never climb out of the folder.
 */
function worktreePath(cfg, branch) {
  return path.join(
    cockpitHome(),
    "worktrees",
    slug(path.basename(cfg.localPath)),
    slug(String(branch).replace(/^task\//, ""))
  );
}

// git resolves symlinks in `worktree list` output (/var -> /private/var on macOS),
// so paths are compared through their real path.
const realPath = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * The task's worktree path, opening the worktree when missing: an existing branch is
 * attached as-is, a new one starts at `startPoint`, an already-open worktree is reused.
 * Refuses with 409 while the branch is checked out in the main repo: git cannot hold
 * one branch in two worktrees, and the main checkout is never touched to fix it.
 */
async function ensureWorktree(cfg, branch, startPoint) {
  const cwd = worktreePath(cfg, branch);
  const current = (await git(cfg.localPath, ["branch", "--show-current"])).trim();
  if (current === branch)
    throw fail(409, "Görev dalı ana depoda açık; ana depoyu başka bir dala geçir, sonra tekrar al");
  // A worktree folder deleted by hand stays registered and would block "worktree add".
  await git(cfg.localPath, ["worktree", "prune"]);
  const open = (await git(cfg.localPath, ["worktree", "list", "--porcelain"]))
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => realPath(l.slice("worktree ".length)));
  if (open.includes(realPath(cwd))) return cwd;
  fs.mkdirSync(path.dirname(cwd), { recursive: true });
  const exists = await git(cfg.localPath, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]).then(
    () => true,
    () => false
  );
  await git(
    cfg.localPath,
    exists ? ["worktree", "add", cwd, branch] : ["worktree", "add", "-b", branch, cwd, startPoint]
  );
  return cwd;
}

/** Claim: refuse when someone else holds it, a dependency is open or another task works the same area (continuing my own task skips those checks), assign to me, then open the task's worktree. The main checkout stays on its branch. */
async function claim(cfg, number) {
  const a = adapter(cfg);
  const me = await whoami(cfg);
  const issue = await a.issue(cfg, number);
  const holders = issue.assignees.map((x) => x.login);
  if (!issue.open) throw fail(409, "Görev kapalı");
  if (holders.length && !holders.includes(me))
    throw fail(409, `Görev zaten alınmış: ${holders.join(", ")}`);
  if (!holders.includes(me)) {
    await refuseIfNotReady(cfg, number, me);
    await a.assign(cfg, number);
  }
  // Re-read: two people can click at the same moment; the earliest assignee keeps it.
  const after = (await a.issue(cfg, number)).assignees.map((x) => x.login);
  if (after[0] !== me) {
    await a.unassign(cfg, number).catch(() => {});
    throw fail(409, `Aynı anda başkası aldı: ${after[0]}`);
  }
  const branch = branchFor(issue);
  const base = await a.defaultBranch(cfg);
  if (hasRemote(cfg)) await git(cfg.localPath, ["fetch", "origin", base]);
  const cwd = await ensureWorktree(cfg, branch, hasRemote(cfg) ? `origin/${base}` : base);
  const where = cfg.repo ? `${cfg.repo} #${issue.number}` : `Görev ${issue.number}`;
  const prompt =
    `${where}: ${issue.title}\n\n${issue.body || ""}\n\n` +
    `Bu görevi "${branch}" dalında uygula, testlerini yaz ve çalıştır, anlamlı commit'ler at. ` +
    `Push etme ve ${a.reviewName} açma; bunu kokpitten ben yapacağım.`;
  return { number: issue.number, branch, cwd, prompt };
}

async function members(cfg) {
  return { provider: cfg.provider, members: await adapter(cfg).members(cfg) };
}

/** Folder picker: subdirectories of `dir` (default: home), confined to the home directory. */
function listDirs(dir) {
  const home = fs.realpathSync(os.homedir());
  let target;
  try {
    target = fs.realpathSync(path.resolve(dir || home));
  } catch {
    throw fail(404, "Klasör bulunamadı");
  }
  if (target !== home && !target.startsWith(home + path.sep))
    throw fail(403, "Yalnız ev dizininin altı gezilebilir");
  const entries = fs
    .readdirSync(target, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      const full = path.join(target, e.name);
      return { name: e.name, path: full, git: fs.existsSync(path.join(full, ".git")) };
    })
    .sort((a, b) => Number(b.git) - Number(a.git) || a.name.localeCompare(b.name));
  return {
    path: target,
    parent: target === home ? null : path.dirname(target),
    git: fs.existsSync(path.join(target, ".git")),
    dirs: entries.slice(0, 500),
  };
}

/**
 * Pure: the handover comment release leaves on the issue, exported so the UI
 * can preview it before the user confirms (nothing is written unpreviewed).
 * The note is capped at 500 characters; an empty note becomes "-", a missing
 * last commit "yok".
 */
function releaseComment({ branch, lastSubject, note }) {
  const text = String(note || "")
    .trim()
    .slice(0, 500);
  return `Yarıda kaldı. Dal: ${branch}. Son commit: ${lastSubject || "yok"}. Not: ${text || "-"}`;
}

/**
 * Release a task: drop the assignment, then leave the handover comment on the
 * issue (previewed first by the caller). The branch and its worktree are kept
 * so whoever picks the task up starts from the work done so far.
 */
/** The exact comment release would write, for the UI to show before the user confirms. */
async function releasePreview(cfg, number, note = "") {
  const branch = branchFor(await adapter(cfg).issue(cfg, number));
  const subject =
    (await git(cfg.localPath, ["log", "-1", "--format=%s", branch]).catch(() => "")).trim() || null;
  return { comment: releaseComment({ branch, lastSubject: subject, note }) };
}

async function release(cfg, number, note = "") {
  const a = adapter(cfg);
  const { comment } = await releasePreview(cfg, number, note);
  await a.unassign(cfg, number);
  await a.comment(cfg, number, comment);
  return { ok: true, comment };
}

async function reviewRequest(cfg, number) {
  const issue = await adapter(cfg).issue(cfg, number);
  const base = await adapter(cfg).defaultBranch(cfg);
  return {
    branch: branchFor(issue),
    base,
    title: hasRemote(cfg) ? `#${issue.number}: ${issue.title}` : `Görev ${issue.title}`,
    body: `Closes #${issue.number}\n\nAI Cockpit ile hazırlandı.`,
  };
}

async function prPreview(cfg, number) {
  const a = adapter(cfg);
  const req = await reviewRequest(cfg, number);
  const from = hasRemote(cfg) ? `origin/${req.base}` : req.base;
  const ahead = (await git(cfg.localPath, ["log", "--oneline", `${from}..${req.branch}`])).trim();
  const commands = hasRemote(cfg)
    ? [["git", "-C", cfg.localPath, "push", "-u", "origin", req.branch], a.reviewCommand(cfg, req)]
    : [
        ["git", "-C", cfg.localPath, "checkout", req.base],
        ["git", "-C", cfg.localPath, "merge", "--no-ff", req.branch, "-m", req.title],
      ];
  return { ...req, review_name: a.reviewName, commands, commits: ahead ? ahead.split("\n") : [] };
}

/** Push the task branch and open the PR/MR (or merge locally). Only called after the user confirmed the preview. */
async function openPr(cfg, number) {
  const a = adapter(cfg);
  const req = await reviewRequest(cfg, number);
  if (hasRemote(cfg)) await git(cfg.localPath, ["push", "-u", "origin", req.branch]);
  return { url: await a.openReview(cfg, req, number) };
}

module.exports = {
  readConfig,
  writeConfig,
  validateConfig,
  board,
  boardActivity,
  claim,
  release,
  releasePreview,
  releaseComment,
  prPreview,
  openPr,
  members,
  listDirs,
  buildBoard,
  worktreePath,
  ensureWorktree,
  estimateFromLabels,
  closedIssues,
  slug,
  _adapters: ADAPTERS,
  _git: git,
};
