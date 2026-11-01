/**
 * @file Tests for AI Cockpit outgoing prompt extraction: subagent calls and agent CLIs run through Bash.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const d = require("../lib/dispatches");

const ev = (tool, input) => ({
  id: 1,
  session_id: "s",
  created_at: "t",
  tool_name: tool,
  data: JSON.stringify({ tool_input: input }),
});

test("subagent call", () => {
  const r = d.toDispatch(
    ev("Agent", {
      subagent_type: "Explore",
      description: "Find X",
      prompt: "Look for X in src",
      model: "sonnet",
    })
  );
  assert.deepEqual(
    [r.kind, r.target, r.description, r.model, r.prompt],
    ["subagent", "Explore", "Find X", "sonnet", "Look for X in src"]
  );
});

test("cursor-agent with quoted prompt and model", () => {
  const r = d.toDispatch(
    ev("Bash", {
      command: `cd /x && cursor-agent -p --model grok-4.7 --output-format stream-json "Görev 17a: laboratuvar ekranını uygula"`,
    })
  );
  assert.equal(r.target, "cursor-agent");
  assert.equal(r.model, "grok-4.7");
  assert.equal(r.prompt, "Görev 17a: laboratuvar ekranını uygula");
  assert.equal(r.workdir, "/x");
});

test("prompt comes from the CLI's own arguments, not earlier commands", () => {
  const r = d.toDispatch(
    ev("Bash", {
      command:
        'echo "Task 17a: progress note that is long" >> log.md && cd /repo && cursor-agent -p "the real prompt for cursor"',
    })
  );
  assert.equal(r.prompt, "the real prompt for cursor");
  assert.equal(r.workdir, "/repo");
});

test("heredoc prompt wins", () => {
  const cmd = "codex exec - <<'EOF'\nUzun görev metni\nikinci satır\nEOF";
  assert.equal(d.toDispatch(ev("Bash", { command: cmd })).prompt, "Uzun görev metni\nikinci satır");
});

test("prompt from a file: content when local, name otherwise", () => {
  const fs = require("fs");
  const path = require("path");
  const f = path.join(require("os").tmpdir(), `brief-${process.pid}.md`);
  fs.writeFileSync(f, "Dosyadaki görev\n");
  assert.equal(d.extractPrompt(`cursor-agent -p "$(cat ${f})"`), "Dosyadaki görev");
  assert.equal(d.extractPrompt("cursor-agent -p < /nope/brief.md"), "(/nope/brief.md dosyasından)");
});

test("ordinary commands are ignored", () => {
  assert.equal(d.toDispatch(ev("Bash", { command: "git log --oneline" })), null);
  assert.equal(
    d.toDispatch(ev("Bash", { command: 'claude --version && echo "hello world, long enough"' })),
    null
  );
  assert.equal(d.toDispatch(ev("Bash", { command: "which codex gemini" })), null);
  // mentions inside heredocs/quotes/scripts are not calls
  assert.equal(
    d.toDispatch(
      ev("Bash", { command: "cat > a.js <<'EOF'\ncursor-agent -p \"long prompt text here\"\nEOF" })
    ),
    null
  );
  assert.equal(
    d.toDispatch(ev("Bash", { command: 'echo "run cursor-agent -p for details please"' })),
    null
  );
  // real calls in command position still count
  assert.ok(
    d.toDispatch(
      ev("Bash", {
        command: 'cd /x && FOO=1 /usr/local/bin/cursor-agent -p "a real task prompt here"',
      })
    )
  );
});
