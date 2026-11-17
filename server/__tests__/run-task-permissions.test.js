/**
 * @file Task runs started from the board get a fixed permission list (browser runs cannot answer prompts); other runs do not.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-home-"));
process.env.AI_COCKPIT_HOME = home;
const runs = require("../lib/run-spawner");

const task = path.join(home, "worktrees", "demo-1234abcd", "5-readme-lisans");
fs.mkdirSync(task, { recursive: true });
const other = fs.mkdtempSync(path.join(os.tmpdir(), "plain-"));

const settingsOf = (argv) => {
  const i = argv.indexOf("--settings");
  return i === -1 ? null : JSON.parse(argv[i + 1]);
};

test("a run inside a task worktree gets the allow list and the push deny", () => {
  const argv = runs._buildArgv({ prompt: "x", mode: "conversation", cwd: task });
  const s = settingsOf(argv);
  assert.ok(s, "--settings missing");
  assert.ok(s.permissions.allow.includes("Bash(git commit:*)"));
  assert.ok(s.permissions.allow.includes("Bash(pytest:*)"));
  assert.deepEqual(s.permissions.deny, ["Bash(git push:*)"]);
  assert.ok(!s.permissions.allow.some((r) => r.includes("push")));
});

test("a run elsewhere gets no extra permissions", () => {
  assert.equal(
    settingsOf(runs._buildArgv({ prompt: "x", mode: "conversation", cwd: other })),
    null
  );
  assert.equal(settingsOf(runs._buildArgv({ prompt: "x", mode: "conversation" })), null);
});

test("a symlink pointing into the worktrees folder from outside is judged by its real path", () => {
  const link = path.join(other, "looks-like-task");
  fs.symlinkSync(task, link);
  assert.ok(settingsOf(runs._buildArgv({ prompt: "x", mode: "headless", cwd: link })));
  const fake = path.join(home, "worktrees-not");
  fs.mkdirSync(fake, { recursive: true });
  assert.equal(settingsOf(runs._buildArgv({ prompt: "x", mode: "headless", cwd: fake })), null);
});

test("AI_COCKPIT_TASK_RUN_ALLOW=0 turns the list off", () => {
  process.env.AI_COCKPIT_TASK_RUN_ALLOW = "0";
  try {
    assert.equal(
      settingsOf(runs._buildArgv({ prompt: "x", mode: "conversation", cwd: task })),
      null
    );
  } finally {
    delete process.env.AI_COCKPIT_TASK_RUN_ALLOW;
  }
});

test("headless keeps -p and the prompt right after it", () => {
  const argv = runs._buildArgv({ prompt: "merhaba", mode: "headless", cwd: task });
  assert.equal(argv[argv.indexOf("-p") + 1], "merhaba");
});
