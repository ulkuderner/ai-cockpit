/**
 * @file Tests for AI Cockpit community task worktrees: claim opens one worktree per task under the cockpit home, leaves the main checkout untouched, attaches an existing branch instead of recreating it, keeps GitHub/GitLab claims working, and the local provider's merge refuses a dirty main repo.
 * @author Caglar Ulkuderner
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const c = require("../lib/community");

// Every git call goes through the module's own runner (`_git`) inside throwaway
// mkdtemp sandboxes: this file spawns no subprocess itself (see
// no-mutating-git-in-tests.test.js), and AI_COCKPIT_HOME points at the sandbox,
// never at the real home.
const git = (cwd, args) => c._git(cwd, args);
const sandbox = [];
let prevHome;
let prevUserHome;

before(() => {
  prevHome = process.env.AI_COCKPIT_HOME;
  prevUserHome = process.env.HOME;
});

after(() => {
  if (prevHome === undefined) delete process.env.AI_COCKPIT_HOME;
  else process.env.AI_COCKPIT_HOME = prevHome;
  process.env.HOME = prevUserHome;
  for (const dir of sandbox) fs.rmSync(dir, { recursive: true, force: true });
});

/** Fresh temp home + git repo on `main` with a two-task plan file; a bare origin when `remote`. */
async function freshRepo({ remote = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-worktree-"));
  sandbox.push(root);
  process.env.AI_COCKPIT_HOME = path.join(root, "home");
  // claim reads claude-mem settings from HOME: point it at a closed port, never the real home.
  process.env.HOME = path.join(root, "userhome");
  fs.mkdirSync(path.join(process.env.HOME, ".claude-mem"), { recursive: true });
  fs.writeFileSync(
    path.join(process.env.HOME, ".claude-mem", "settings.json"),
    '{"CLAUDE_MEM_WORKER_PORT":"1"}'
  );
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.name", "Kokpit Test"]);
  await git(repo, ["config", "user.email", "test@ai-cockpit.example"]);
  fs.writeFileSync(
    path.join(repo, "plan.md"),
    "# Plan\n\n### Task 1: İlk\nGövde 1\n\n### Task 2: İkinci\nGövde 2\n"
  );
  fs.writeFileSync(path.join(repo, "f.txt"), "one\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-qm", "c1"]);
  if (remote) {
    const bare = path.join(root, "origin.git");
    await git(repo, ["init", "-q", "--bare", "-b", "main", bare]);
    await git(repo, ["remote", "add", "origin", bare]);
    await git(repo, ["push", "-q", "-u", "origin", "main"]);
  }
  // Production always has community.json on disk before a claim (PUT /config
  // wrote it); the local adapter keeps claims there.
  const cfg = { provider: "local", localPath: repo, planFile: "plan.md" };
  c.writeConfig(cfg);
  return { root, home: process.env.AI_COCKPIT_HOME, repo, cfg };
}

test("claim opens a worktree and leaves the main checkout alone", async () => {
  const { repo, cfg } = await freshRepo();
  const r = await c.claim(cfg, 1);
  assert.equal(r.branch, "task/1-1-ilk"); // local titles carry the plan id: "1: İlk"
  assert.equal(r.cwd, c.worktreePath(cfg, r.branch));
  assert.ok(fs.existsSync(path.join(r.cwd, ".git")));
  assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "main");
  const again = await c.claim(cfg, 1); // continue: same worktree, no error
  assert.equal(again.cwd, r.cwd);
});

test("claim refuses when the task branch is checked out in the main repo", async () => {
  const { repo, cfg } = await freshRepo();
  await git(repo, ["checkout", "-q", "-b", "task/2-2-ikinci"]);
  await assert.rejects(c.claim(cfg, 2), {
    status: 409,
    message: "Görev dalı ana depoda açık; ana depoyu başka bir dala geçir, sonra tekrar al",
  });
  assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "task/2-2-ikinci");
});

test("claim ignores a dirty main repo: the worktree is a separate checkout", async () => {
  const { repo, cfg } = await freshRepo();
  fs.writeFileSync(path.join(repo, "uncommitted.txt"), "dirt");
  const r = await c.claim(cfg, 1);
  assert.ok(fs.existsSync(path.join(r.cwd, ".git")));
  assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "main");
});

test("local openReview refuses a dirty main repo with the plan message", async () => {
  const { repo, cfg } = await freshRepo();
  const r = await c.claim(cfg, 1);
  fs.writeFileSync(path.join(r.cwd, "f.txt"), "one\ntwo\n");
  await git(r.cwd, ["commit", "-qam", "c2"]);
  fs.writeFileSync(path.join(repo, "uncommitted.txt"), "dirt");
  await assert.rejects(
    c._adapters.local.openReview(cfg, { branch: r.branch, base: "main", title: "Görev 1: İlk" }, 1),
    {
      status: 409,
      message: "Yerel depoda kaydedilmemiş değişiklik var; önce commit'le ya da kenara al",
    }
  );
  assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "main");
});

test("an existing branch without a worktree is attached, not recreated with -b", async () => {
  const { repo, cfg } = await freshRepo();
  await git(repo, ["branch", "task/1-ilk"]); // at c1; `worktree add -b` on it would fail outright
  fs.writeFileSync(path.join(repo, "f.txt"), "one\nmore\n");
  await git(repo, ["commit", "-qam", "c2-on-main"]);
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  assert.equal(p, c.worktreePath(cfg, "task/1-ilk"));
  assert.equal((await git(p, ["branch", "--show-current"])).trim(), "task/1-ilk");
  assert.equal((await git(p, ["log", "-1", "--format=%s"])).trim(), "c1"); // branch tip, not startPoint
});

test("worktreePath slugs the branch so it cannot escape the worktrees folder", async () => {
  const { home, cfg } = await freshRepo();
  const p = c.worktreePath(cfg, "task/../../x");
  assert.match(
    p,
    new RegExp(`^${path.join(home, "worktrees").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
  assert.equal(path.basename(p), "x");
  assert.match(path.basename(path.dirname(p)), /^repo-[0-9a-f]{8}$/);
  assert.ok(p.startsWith(path.join(home, "worktrees")));
});

test("claim opens a worktree for the github and gitlab providers too", async () => {
  for (const provider of ["github", "gitlab"]) {
    const { repo } = await freshRepo({ remote: true });
    const cfg = { provider, repo: "a/b", localPath: repo, label: "t" };
    let assigned = false;
    const fake = {
      reviewName: provider === "gitlab" ? "MR" : "PR",
      me: async () => "me",
      snapshot: async () => ({
        issues: [{ number: 7, title: "Tahta", assignees: [], labels: [], body: "" }],
        reviews: [],
        done: { total: 0, recent: [] },
      }),
      issue: async (_cfg, n) => ({
        number: n,
        title: "Tahta",
        body: "",
        url: null,
        open: true,
        assignees: assigned ? [{ login: "me" }] : [],
      }),
      assign: async () => {
        assigned = true;
      },
      defaultBranch: async () => "main",
    };
    const real = c._adapters[provider];
    c._adapters[provider] = fake;
    try {
      const r = await c.claim(cfg, 7);
      assert.equal(r.branch, "task/7-tahta");
      assert.equal(r.cwd, c.worktreePath(cfg, r.branch));
      assert.ok(fs.existsSync(path.join(r.cwd, ".git")));
      assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "main");
    } finally {
      c._adapters[provider] = real;
    }
  }
});

test("claim reopens a task whose worktree folder was deleted by hand", async () => {
  const { cfg } = await freshRepo();
  const r = await c.claim(cfg, 1);
  fs.rmSync(r.cwd, { recursive: true, force: true });
  const again = await c.claim(cfg, 1);
  assert.equal(again.cwd, r.cwd);
  assert.ok(fs.existsSync(path.join(again.cwd, ".git")));
});

test("a title edited after the claim keeps the task on its first branch and worktree", async () => {
  const { repo, cfg } = await freshRepo();
  const r = await c.claim(cfg, 1);
  const plan = path.join(repo, "plan.md");
  fs.writeFileSync(
    plan,
    fs.readFileSync(plan, "utf8").replace("### Task 1: İlk", "### Task 1: İlk ve yeni ad")
  );
  const again = await c.claim(cfg, 1);
  assert.equal(again.branch, r.branch);
  assert.equal(again.cwd, r.cwd);
  assert.equal((await c.prPreview(cfg, 1)).branch, r.branch);
});

test("local release twice keeps both handover notes", async () => {
  const { cfg } = await freshRepo();
  await c.claim(cfg, 1);
  await c.release(cfg, 1, "A");
  await c.claim(cfg, 1);
  await c.release(cfg, 1, "B");
  const notes = c.readConfig().claims[1].notes;
  assert.equal(notes.length, 2);
  assert.match(notes[0], /Not: A$/);
  assert.match(notes[1], /Not: B$/);
  assert.equal(c.readConfig().claims[1].by, undefined);
});

test("a claim that fails after the assignment leaves the task unassigned", async () => {
  const { repo, cfg } = await freshRepo();
  await git(repo, ["checkout", "-q", "-b", "task/2-2-ikinci"]);
  await assert.rejects(c.claim(cfg, 2), { status: 409 });
  assert.equal(c.readConfig().claims?.[2]?.by, undefined);
});

test("release and its preview refuse a task that is not mine", async () => {
  const { cfg } = await freshRepo();
  await assert.rejects(c.releasePreview(cfg, 1, "x"), { status: 409 });
  await assert.rejects(c.release(cfg, 1, "x"), { status: 409 });
  assert.equal(c.readConfig().claims?.[1], undefined);
});

test("the agent prompt opens with the data warning, not the issue title", async () => {
  const { cfg } = await freshRepo();
  const r = await c.claim(cfg, 1);
  assert.match(r.prompt, /^Önce \.ai-cockpit\/brief\.md dosyasını oku\./);
  assert.ok(!r.prompt.includes("İlk"));
});

test("two repos with the same folder name get separate task folders", async () => {
  const a = { provider: "local", localPath: path.join(os.tmpdir(), "x1", "app") };
  const b = { provider: "local", localPath: path.join(os.tmpdir(), "x2", "app") };
  assert.notEqual(c.worktreePath(a, "task/1-a"), c.worktreePath(b, "task/1-a"));
});

test("a plan file that is a symlink out of the repo is refused", async () => {
  const { root, repo, cfg } = await freshRepo();
  const outside = path.join(root, "baska.md");
  fs.writeFileSync(outside, "# x\n");
  fs.symlinkSync(outside, path.join(repo, "link.md"));
  assert.throws(() => c.validateConfig({ ...cfg, planFile: "link.md" }), { status: 400 });
  assert.doesNotThrow(() => c.validateConfig(cfg));
});
