/**
 * @file AI Cockpit "outgoing prompts": what an orchestrating agent sent to other agents. Reads PreToolUse hook events and extracts (a) Claude Code subagent calls (Agent/Task tool: type, description, prompt, model) and (b) other agent CLIs launched through Bash (cursor-agent, codex, gemini, claude -p) with the prompt recovered from the command line or heredoc.
 * @author Caglar Ulkuderner
 */

const { db } = require("../db");

// The CLI must sit in command position (line start, after ; && || | ( $( or env assignments),
// checked on the command with quoted text and heredoc bodies removed so mentions don't count.
const CLI_RE =
  /(?:^|[;&|(\n]|\$\()\s*(?:(?:sudo|env|exec|nohup|time)\s+)*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:\S*\/)?(cursor-agent|codex|gemini|claude)(?=\s|$)/m;

function shellSkeleton(cmd) {
  return cmd
    .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, "<<HEREDOC")
    .replace(/'(?:[^']|'\\'')*'|"(?:[^"\\]|\\.)*"/g, "''");
}

/** Prompt kept in a file (`"$(cat brief.md)"`, `< brief.md`): show its text when it is on this machine. */
function fromFile(file) {
  try {
    const fs = require("fs");
    if (fs.statSync(file).size <= 20_000) return fs.readFileSync(file, "utf8").trim();
  } catch {
    /* not here (remote agent) or unreadable */
  }
  return `(${file} dosyasından)`;
}

/** Heredoc body wins, else a prompt file, else the longest quoted string. */
function extractPrompt(cmd) {
  const here = /<<-?\s*['"]?(\w+)['"]?[^\n]*\n([\s\S]*?)\n\s*\1\b/.exec(cmd);
  if (here) return here[2].trim();
  const file = /\$\(\s*cat\s+['"]?([^)'"\s]+)['"]?\s*\)|\s<\s*['"]?([^\s|;&'"]+)/.exec(cmd);
  if (file) return fromFile(file[1] || file[2]);
  const quoted = [];
  const re = /'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(cmd))) {
    const v = m[1] != null ? m[1].replace(/'\\''/g, "'") : m[2].replace(/\\(.)/g, "$1");
    quoted.push(v);
  }
  const best = quoted.sort((a, b) => b.length - a.length)[0];
  return best && best.length >= 12 ? best.trim() : null;
}

function flag(cmd, names) {
  for (const n of names) {
    const m = new RegExp(`${n}[=\\s]+['"]?([^'"\\s]+)`).exec(cmd);
    if (m) return m[1];
  }
  return null;
}

/** Pure: one PreToolUse event → a dispatch record, or null when it is not an agent call. */
function toDispatch(ev) {
  let data;
  try {
    data = JSON.parse(ev.data || "{}");
  } catch {
    return null;
  }
  const input = data.tool_input || {};
  const base = { id: ev.id, session_id: ev.session_id, at: ev.created_at };
  if (ev.tool_name === "Agent" || ev.tool_name === "Task") {
    if (!input.prompt) return null;
    return {
      ...base,
      kind: "subagent",
      target: input.subagent_type || "general-purpose",
      description: input.description || null,
      model: input.model || null,
      background: !!input.run_in_background,
      prompt: String(input.prompt),
    };
  }
  if (ev.tool_name === "Bash" && typeof input.command === "string") {
    const m = CLI_RE.exec(shellSkeleton(input.command));
    if (!m) return null;
    const target = m[1];
    // `claude` only counts in non-interactive print mode; `codex` only for exec/one-shot runs.
    if (target === "claude" && !/\s(-p|--print)\b/.test(input.command)) return null;
    if (target === "codex" && !/codex\s+(exec|e)\b|codex\s+-q\b/.test(input.command)) return null;
    // The prompt is an argument of the CLI: only look at the text after its (last) invocation.
    const at = input.command.lastIndexOf(target);
    const prompt = extractPrompt(input.command.slice(at));
    if (!prompt) return null;
    // Where the CLI actually works: --workspace, else the last `cd` before it, else the session's cwd.
    const before = input.command.slice(0, at);
    const cds = [...before.matchAll(/(?:^|[;&|\n(])\s*cd\s+(['"]?)([^'";&|\n]+)\1/g)];
    const workdir =
      flag(input.command, ["--workspace"]) || (cds.length ? cds[cds.length - 1][2].trim() : null);
    return {
      ...base,
      kind: "cli",
      target,
      description: input.description || null,
      model: flag(input.command, ["--model", "-m"]),
      background: !!input.run_in_background,
      prompt,
      workdir,
    };
  }
  return null;
}

function list({ session, limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const rows = db
    .prepare(
      `SELECT e.id, e.session_id, e.tool_name, e.data, e.created_at, s.name AS session_name, s.cwd
       FROM events e JOIN sessions s ON s.id = e.session_id
       WHERE e.event_type = 'PreToolUse'
         AND (e.tool_name IN ('Agent','Task')
              OR (e.tool_name = 'Bash' AND (e.data LIKE '%cursor-agent%' OR e.data LIKE '%codex %'
                  OR e.data LIKE '%gemini %' OR e.data LIKE '%claude %')))
         ${session ? "AND e.session_id = ?" : ""}
       ORDER BY e.id DESC LIMIT ?`
    )
    .all(...(session ? [session, lim * 3] : [lim * 3]));
  const out = [];
  for (const r of rows) {
    const d = toDispatch(r);
    if (d) out.push({ ...d, session_name: r.session_name, cwd: d.workdir || r.cwd });
    if (out.length >= lim) break;
  }
  return { items: out };
}

module.exports = { list, toDispatch, extractPrompt };
