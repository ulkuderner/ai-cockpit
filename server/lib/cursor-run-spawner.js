/**
 * @file cursor-run-spawner.js
 * @description Spawns and supervises headless `cursor-agent -p --output-format
 * stream-json` runs for the dashboard's Run Agent page, mirroring
 * run-spawner.js: argument arrays only (no shell), stream-json lines are
 * broadcast as `run_stream`, status changes as `run_status`, stop is SIGTERM
 * then SIGKILL after 5s. The binary resolves from PATH; CURSOR_AGENT_BIN
 * overrides it. `previewCommand` returns the exact command line before start.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const spawn = require("cross-spawn");
const { randomUUID } = require("node:crypto");
const { broadcast } = require("../websocket");
const { createLineParser } = require("./stream-json-parser");

let dashboardRuns = null;
try {
  dashboardRuns = require("./dashboard-runs");
} catch {
  /* db-less environment, skip persistence */
}

const REAP_AFTER_MS = 5 * 60 * 1000;
const TAIL_BYTES = 4 * 1024;
const MAX_ENVELOPES = 500;
const handles = new Map();
const reapers = new Map();

const makeErr = (code, message) => Object.assign(new Error(message), { code });
const tail = (s, n) => (s.length <= n ? s : s.slice(s.length - n));
const bin = () => process.env.CURSOR_AGENT_BIN || "cursor-agent";

/** POSIX-quote one word for DISPLAY only; the spawn itself never uses a shell. */
function quote(word) {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

function buildArgv({ prompt, model, trust }) {
  const argv = ["-p", "--output-format", "stream-json"];
  // Headless cursor-agent exits on an untrusted workspace; --trust is an explicit user opt-in.
  if (trust) argv.push("--trust");
  if (model) argv.push("--model", model);
  // `--` keeps a prompt that starts with "-" from being parsed as a flag.
  argv.push("--", prompt);
  return argv;
}

function validate({ prompt, model }) {
  if (typeof prompt !== "string" || !prompt.trim())
    throw makeErr("EBADPROMPT", "prompt is required");
  if (model != null && (typeof model !== "string" || !/^[A-Za-z0-9._:\-[\]=,]+$/.test(model))) {
    throw makeErr("EBADMODEL", "model contains unsupported characters");
  }
}

/** Exact command that spawnRun would execute, for a UI preview. */
function previewCommand({ prompt, model, cwd, trust }) {
  validate({ prompt, model });
  const argv = buildArgv({ prompt, model, trust });
  return {
    provider: "cursor",
    bin: bin(),
    argv,
    cwd: cwd || process.cwd(),
    commandLine: [bin(), ...argv].map(quote).join(" "),
  };
}

function liveCount() {
  let n = 0;
  for (const h of handles.values()) if (h.status === "spawning" || h.status === "running") n++;
  return n;
}

function scheduleReap(id) {
  clearTimeout(reapers.get(id));
  const t = setTimeout(() => {
    handles.delete(id);
    reapers.delete(id);
  }, REAP_AFTER_MS);
  t.unref?.();
  reapers.set(id, t);
}

function finish(handle, status, extra = {}) {
  handle.endedAt = Date.now();
  handle.status = status;
  broadcast("run_status", { id: handle.id, status, at: handle.endedAt, ...extra });
  dashboardRuns?.patchRun({ id: handle.id, status, endedAt: handle.endedAt, ...extra });
  scheduleReap(handle.id);
}

function attach(handle) {
  const parser = createLineParser(
    (envelope) => {
      if (handle.status === "spawning") {
        handle.status = "running";
        broadcast("run_status", { id: handle.id, status: "running", at: Date.now() });
        dashboardRuns?.patchRun({ id: handle.id, status: "running" });
      }
      if (
        envelope?.type === "system" &&
        envelope.subtype === "init" &&
        typeof envelope.session_id === "string" &&
        !handle.sessionId
      ) {
        handle.sessionId = envelope.session_id;
        dashboardRuns?.patchRun({ id: handle.id, sessionId: handle.sessionId });
      }
      handle.envelopeCount += 1;
      handle.envelopes.push(envelope);
      if (handle.envelopes.length > MAX_ENVELOPES)
        handle.envelopes.splice(0, handle.envelopes.length - MAX_ENVELOPES);
      broadcast("run_stream", { id: handle.id, envelope });
    },
    (err, raw) => {
      handle.stderrBuffer += `[parse-error] ${err.message}: ${raw}\n`;
    }
  );
  handle.child.stdout.on("data", (c) => {
    const s = c.toString("utf8");
    handle.stdoutBuffer = tail(handle.stdoutBuffer + s, TAIL_BYTES);
    parser.push(s);
  });
  handle.child.stderr.on("data", (c) => {
    handle.stderrBuffer = tail(handle.stderrBuffer + c.toString("utf8"), TAIL_BYTES);
  });
  handle.child.on("error", (err) => {
    handle.error = err.message;
    finish(handle, "error", { error: err.message });
  });
  handle.child.on("exit", (code, signal) => {
    parser.flush();
    if (handle.status !== "killed") {
      handle.exitCode = code;
      handle.signal = signal;
      finish(handle, code === 0 ? "completed" : "error", {
        exitCode: code,
        sessionId: handle.sessionId,
      });
    } else {
      scheduleReap(handle.id);
    }
  });
}

function spawnRun({ prompt, cwd, model, trust } = {}) {
  validate({ prompt, model });
  const id = randomUUID();
  const argv = buildArgv({ prompt, model, trust });
  const child = spawn(bin(), argv, {
    env: { ...process.env },
    cwd: cwd || process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const handle = {
    id,
    provider: "cursor",
    pid: child.pid || null,
    mode: "headless",
    cwd: cwd || process.cwd(),
    model: model || null,
    permissionMode: null,
    effort: null,
    prompt,
    bin: bin(),
    argv,
    resumeSessionId: null,
    status: "spawning",
    startedAt: Date.now(),
    endedAt: null,
    exitCode: null,
    signal: null,
    error: null,
    sessionId: null,
    envelopeCount: 0,
    envelopes: [],
    stdoutBuffer: "",
    stderrBuffer: "",
    child,
  };
  handles.set(id, handle);
  dashboardRuns?.recordRun(handle);
  attach(handle);
  broadcast("run_status", { id, status: "spawning", at: handle.startedAt });
  return handle;
}

function sendInput() {
  throw makeErr("EWRONGMODE", "cursor runs are headless and accept no follow-up input");
}

function killRun(id) {
  const handle = handles.get(id);
  if (!handle) return false;
  if (["completed", "error", "killed"].includes(handle.status)) return true;
  const child = handle.child;
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  const t = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 5000);
  t.unref?.();
  finish(handle, "killed");
  return true;
}

function publicHandle(h, opts = {}) {
  if (!h) return null;
  const { child, envelopes, stdoutBuffer, stderrBuffer, ...rest } = h;
  const out = { ...rest, stdoutTail: stdoutBuffer, stderrTail: stderrBuffer };
  if (opts.includeEnvelopes) out.envelopes = envelopes.slice();
  return out;
}

const getRun = (id, opts) => publicHandle(handles.get(id), opts);
const listRuns = () =>
  [...handles.values()].sort((a, b) => b.startedAt - a.startedAt).map((h) => publicHandle(h));

function __reset() {
  for (const t of reapers.values()) clearTimeout(t);
  reapers.clear();
  handles.clear();
}

module.exports = {
  spawnRun,
  sendInput,
  killRun,
  getRun,
  listRuns,
  liveCount,
  previewCommand,
  __reset,
};
