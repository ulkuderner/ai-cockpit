/**
 * @file Tests for the optional Worktrunk (wt) path in AI Cockpit community work: ensureWorktree hands worktree opening to a wt on PATH with --no-hooks unless the user opted into hooks, boardActivity reads committed_at and changes from one wt list call, every wt failure (broken CLI, bad JSON, wrong schema) silently falls back to the plain-git path, and the worktrunk/worktrunkHooks config values are validated.
 * @author Caglar Ulkuderner
 */

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const c = require("../lib/community");

// Same hermetic pattern as community-worktree.test.js: git runs through the
// module's own runner (`_git`) inside throwaway mkdtemp sandboxes and
// AI_COCKPIT_HOME never points at the real home. The fake wt below is a small
// sh script written into a temp bin dir prepended to PATH; it scrubs git's
// repo-scoped variables itself so its inner git call can never be redirected
// at the outer repository by a leaked GIT_DIR.
const git = (cwd, args) => c._git(cwd, args);
const sandbox = [];
let prevHome;
let prevPath;

before(() => {
  prevHome = process.env.AI_COCKPIT_HOME;
  prevPath = process.env.PATH;
});

after(() => {
  if (prevHome === undefined) delete process.env.AI_COCKPIT_HOME;
  else process.env.AI_COCKPIT_HOME = prevHome;
  process.env.PATH = prevPath;
  c._resetWtBin();
  for (const dir of sandbox) fs.rmSync(dir, { recursive: true, force: true });
});

/** Fresh temp home + git repo on `main` with a one-task plan file (Task 3's setup). */
async function freshRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "community-worktrunk-"));
  sandbox.push(root);
  process.env.AI_COCKPIT_HOME = path.join(root, "home");
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo);
  await git(repo, ["init", "-q", "-b", "main"]);
  await git(repo, ["config", "user.name", "Kokpit Test"]);
  await git(repo, ["config", "user.email", "test@ai-cockpit.example"]);
  fs.writeFileSync(path.join(repo, "plan.md"), "# Plan\n\n### Task 1: İlk\nGövde 1\n");
  fs.writeFileSync(path.join(repo, "f.txt"), "one\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "-qm", "c1"]);
  const cfg = { provider: "local", localPath: repo, planFile: "plan.md" };
  c.writeConfig(cfg);
  return { root, home: process.env.AI_COCKPIT_HOME, repo, cfg };
}

/**
 * Fake wt CLI in a temp bin dir prepended to PATH. Logs every invocation's
 * args to `log`, answers `--version` with versionExit, prints listOut for
 * `list`, and for `switch` really opens the worktree with git worktree add
 * (failSwitch instead exits 1 so the fallback can be observed).
 */
function fakeWt(
  root,
  { versionExit = 0, failSwitch = false, listOut = '{"schema":2,"items":[]}' } = {}
) {
  const dir = path.join(root, "bin", String(sandbox.indexOf(root)));
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, "args.log");
  const lines = [
    "#!/bin/sh",
    `printf '%s\\n' "$*" >> '${log}'`,
    // A leaked GIT_DIR outranks -C: scrub what git-env.js scrubs before any git call here.
    "unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_COMMON_DIR GIT_PREFIX GIT_OBJECT_DIRECTORY",
    "unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE GIT_CEILING_DIRECTORIES",
    "unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_COMMITTER_DATE",
    'if [ "$1" = "--version" ]; then exit VERSION_EXIT; fi',
    "repo=",
    'if [ "$1" = "-C" ]; then repo=$2; shift 2; fi',
    "cmd=$1; shift",
    "if [ \"$cmd\" = \"list\" ]; then printf '%s' 'LIST_OUT'; exit 0; fi",
  ];
  if (failSwitch) lines.push('echo "switch bozuk" >&2; exit 1');
  lines.push(
    ...[
      "create=0; branch=; start=; wtpath=",
      "while [ $# -gt 0 ]; do",
      "  case $1 in",
      "    -c) create=1; branch=$2; shift 2 ;;",
      "    -b) start=$2; shift 2 ;;",
      "    --path) wtpath=$2; shift 2 ;;",
      '    *) if [ -z "$branch" ]; then branch=$1; fi; shift ;;',
      "  esac",
      "done",
      'if [ "$create" = "1" ]; then',
      '  git -C "$repo" worktree add -b "$branch" "$wtpath" "$start"',
      "else",
      '  git -C "$repo" worktree add "$wtpath" "$branch"',
      "fi",
      "printf '{\"schema\":2}'",
    ]
  );
  const script = lines
    .join("\n")
    .replace("VERSION_EXIT", String(versionExit))
    .replace("LIST_OUT", listOut);
  const bin = path.join(dir, "wt");
  fs.writeFileSync(bin, script);
  fs.chmodSync(bin, 0o755);
  process.env.PATH = dir + path.delimiter + process.env.PATH;
  c._resetWtBin();
  return { binDir: dir, log };
}

/** Fresh repo plus a fake wt answering on PATH. */
async function scene(opts = {}) {
  const s = await freshRepo();
  const wt = fakeWt(s.root, opts);
  return { ...s, ...wt };
}

test("ensureWorktree goes through wt with --no-hooks by default", async () => {
  const { cfg, log } = await scene();
  assert.equal(await c.wtBin(cfg), "wt");
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  const args = fs.readFileSync(log, "utf8");
  assert.match(args, /switch -c task\/1-ilk -b main --path /);
  assert.match(args, /--no-hooks/);
  assert.doesNotMatch(args, /--yes/);
  assert.equal(p, c.worktreePath(cfg, "task/1-ilk"));
});

test("worktrunkHooks passes --yes instead of --no-hooks", async () => {
  const { cfg, log } = await scene();
  cfg.worktrunkHooks = true;
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  const args = fs.readFileSync(log, "utf8");
  assert.match(args, /--yes/);
  assert.doesNotMatch(args, /--no-hooks/);
  assert.ok(fs.existsSync(path.join(p, ".git")));
});

test("failing wt falls back to git worktree", async () => {
  const { cfg, repo, log } = await scene({ failSwitch: true });
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  assert.match(fs.readFileSync(log, "utf8"), /switch/); // wt was tried…
  assert.equal(p, c.worktreePath(cfg, "task/1-ilk")); // …but git opened it
  assert.ok(fs.existsSync(path.join(p, ".git")));
  assert.equal((await git(repo, ["branch", "--show-current"])).trim(), "main");
});

test("worktrunk off never calls wt", async () => {
  const { cfg, log } = await scene();
  cfg.worktrunk = "off";
  assert.equal(await c.wtBin(cfg), null);
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  assert.equal(fs.existsSync(log), false); // fake sat on PATH, untouched
  assert.ok(fs.existsSync(path.join(p, ".git")));
});

test("boardActivity reads committed_at and changes from wt list", async () => {
  const listOut = JSON.stringify({
    schema: 2,
    items: [
      {
        branch: "task/1-ilk",
        head: { committed_at: "2026-11-04T11:00:00Z" },
        worktree: { changes: [{ path: "f.txt" }] },
      },
    ],
  });
  const { cfg, log } = await scene({ listOut });
  const a = await c.boardActivity(cfg, [{ number: 1, branch: "task/1-ilk", mine: true }], []);
  assert.match(fs.readFileSync(log, "utf8"), /list --format=json/);
  assert.equal(a[1].last_commit_at, "2026-11-04T11:00:00Z");
  assert.equal(a[1].dirty, true);
});

test("wt list commit time in Unix seconds becomes ISO", async () => {
  const listOut = JSON.stringify({
    schema: 2,
    items: [
      { branch: "task/1-ilk", head: { committed_at: 1762254000 }, worktree: { changes: [] } },
    ],
  });
  const { cfg } = await scene({ listOut });
  const a = await c.boardActivity(cfg, [{ number: 1, branch: "task/1-ilk", mine: true }], []);
  assert.equal(a[1].last_commit_at, new Date(1762254000 * 1000).toISOString());
  assert.equal(a[1].dirty, false);
});

test("bad wt list JSON falls back to git log", async () => {
  const { cfg } = await scene({ listOut: "x" });
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  fs.writeFileSync(path.join(p, "f.txt"), "one\ntwo\n");
  await git(p, ["commit", "-qam", "c2"]);
  const expect = (await git(p, ["log", "-1", "--format=%cI", "task/1-ilk"])).trim();
  const a = await c.boardActivity(cfg, [{ number: 1, branch: "task/1-ilk", mine: true }], []);
  assert.equal(a[1].last_commit_at, expect); // from git, not from wt
  assert.equal("dirty" in a[1], false); // wt's shape unknown: no dirty claim
});

test("wt list with a foreign schema falls back to git log", async () => {
  const { cfg } = await scene({ listOut: '{"schema":3,"items":[]}' });
  const p = await c.ensureWorktree(cfg, "task/1-ilk", "main");
  const expect = (await git(p, ["log", "-1", "--format=%cI", "task/1-ilk"])).trim();
  const a = await c.boardActivity(cfg, [{ number: 1, branch: "task/1-ilk", mine: true }], []);
  assert.equal(a[1].last_commit_at, expect);
});

test("wtBin falls back to the git-wt name when wt is broken", async () => {
  const s = await freshRepo();
  const dir = path.join(s.root, "bin-both");
  fs.mkdirSync(dir, { recursive: true });
  const broken = "#!/bin/sh\nexit 1\n";
  fs.writeFileSync(path.join(dir, "wt"), broken);
  fs.chmodSync(path.join(dir, "wt"), 0o755);
  fs.writeFileSync(path.join(dir, "git-wt"), broken);
  fs.chmodSync(path.join(dir, "git-wt"), 0o755);
  // Only git-wt answers --version:
  fs.writeFileSync(path.join(dir, "git-wt"), "#!/bin/sh\nexit 0\n");
  fs.chmodSync(path.join(dir, "git-wt"), 0o755);
  process.env.PATH = dir + path.delimiter + process.env.PATH;
  c._resetWtBin();
  assert.equal(await c.wtBin(s.cfg), "git-wt");
});

test("config validation: worktrunk and worktrunkHooks values", async () => {
  const { cfg } = await scene();
  const bad = (over, re) =>
    assert.throws(
      () => c.validateConfig({ ...cfg, ...over }),
      (e) => e.status === 400 && re.test(e.message)
    );
  bad({ worktrunk: "maybe" }, /worktrunk/);
  bad({ worktrunk: "off", worktrunkHooks: "yes" }, /worktrunkHooks/); // off is fine, hooks is not boolean
  bad({ worktrunkHooks: 1 }, /worktrunkHooks/);
  c.validateConfig({ ...cfg, worktrunk: "off", worktrunkHooks: true });
  c.validateConfig({ ...cfg, worktrunk: "auto" }); // defaults stay valid
  c.validateConfig(cfg);
});
