/**
 * @file gemini-ingest.js
 * @description Read-only import of Gemini CLI chats
 * (~/.gemini/tmp/<projectHash>/chats/session-*.json) into the dashboard as
 * provider "gemini" sessions with a main agent, one event per message (plus one
 * per tool call), and per-model token usage. Nothing is written to ~/.gemini.
 * Each file is one session (the same sessionId can span several files, so the
 * dashboard id derives from the file name). Files are re-read only when their
 * size/mtime changes; events are appended by message index.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const RECENT_MS = 2 * 60 * 1000;
const fingerprints = new Map();

function getGeminiHome() {
  return path.resolve(process.env.DASHBOARD_GEMINI_HOME || path.join(os.homedir(), ".gemini"));
}

function discoverGeminiChats(home = getGeminiHome()) {
  const tmp = path.join(home, "tmp");
  const out = [];
  let projects = [];
  try {
    projects = fs.readdirSync(tmp);
  } catch {
    return out;
  }
  for (const p of projects) {
    const dir = path.join(tmp, p, "chats");
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) if (/^session-.*\.json$/.test(n)) out.push(path.join(dir, n));
  }
  return out;
}

const sessionIdFor = (file) => `gemini-${path.basename(file, ".json").replace(/^session-/, "")}`;

function text(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (c && c.text) || "").join("");
  return content && typeof content.text === "string" ? content.text : "";
}
const clip = (s, n = 300) =>
  String(s || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

/** Sum Gemini token counts per model. thoughts are billed as output. */
function tokensByModel(messages) {
  const by = new Map();
  for (const m of messages) {
    if (!m.tokens || m.type !== "gemini") continue;
    const model = m.model || "unknown";
    const t = by.get(model) || { input: 0, output: 0, cached: 0 };
    t.input += Number(m.tokens.input) || 0;
    t.output += (Number(m.tokens.output) || 0) + (Number(m.tokens.thoughts) || 0);
    t.cached += Number(m.tokens.cached) || 0;
    by.set(model, t);
  }
  return by;
}

function importGeminiFile(dbModule, file) {
  const { db, stmts } = dbModule;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { changed: false, created: false, session: null };
  }
  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (!data.sessionId || messages.length === 0)
    return { changed: false, created: false, session: null };

  const id = sessionIdFor(file);
  const mainId = `${id}-main`;
  const firstUser = messages.find((m) => m.type === "user");
  const name =
    clip(text(firstUser?.content), 80) || `Gemini session ${String(data.sessionId).slice(0, 8)}`;
  const model = [...messages].reverse().find((m) => m.model)?.model || null;
  const startedAt = data.startTime || messages[0].timestamp;
  const updatedAt = data.lastUpdated || messages[messages.length - 1].timestamp || startedAt;
  const recent = Date.now() - Date.parse(updatedAt) < RECENT_MS;
  const existing = stmts.getSession.get(id);
  const done = existing ? Number(JSON.parse(existing.metadata || "{}").gemini_msgs) || 0 : 0;

  const metadata = JSON.stringify({
    imported: true,
    gemini: true,
    project_hash: data.projectHash || null,
    gemini_session_id: data.sessionId,
    gemini_msgs: messages.length,
    turn_count: messages.filter((m) => m.type === "user").length,
  });
  let created = false;
  if (!existing) {
    stmts.insertSession.run(id, name, recent ? "active" : "completed", null, model, metadata);
    stmts.insertAgent.run(
      mainId,
      id,
      `Gemini · ${name}`,
      "main",
      null,
      recent ? "waiting" : "completed",
      clip(text(firstUser?.content)),
      null,
      JSON.stringify({ gemini: true })
    );
    created = true;
  }
  db.prepare(
    `UPDATE sessions SET provider = 'gemini', name = ?, model = ?, status = ?, metadata = ?,
       transcript_path = ?, started_at = ?, updated_at = ?, ended_at = ? WHERE id = ?`
  ).run(
    name,
    model,
    recent ? "active" : "completed",
    metadata,
    file,
    startedAt,
    updatedAt,
    recent ? null : updatedAt,
    id
  );
  db.prepare("UPDATE agents SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?").run(
    recent ? "waiting" : "completed",
    recent ? null : updatedAt,
    updatedAt,
    mainId
  );

  const events = [];
  const add = (type, tool, summary, extra, at) => {
    const info = stmts.insertEventAt.run(
      id,
      mainId,
      type,
      tool,
      clip(summary),
      JSON.stringify({ provider: "gemini", ...extra }),
      at
    );
    events.push(db.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid));
  };
  messages.slice(done).forEach((m, i) => {
    const at = m.timestamp || updatedAt;
    const index = done + i;
    add(
      `gemini_${m.type === "gemini" ? "response" : m.type}_message`,
      null,
      text(m.content) || m.type,
      { message_index: index, model: m.model || null, tokens: m.tokens || null },
      at
    );
    for (const tc of Array.isArray(m.toolCalls) ? m.toolCalls : []) {
      add(
        "gemini_tool_call",
        tc.name || null,
        `${tc.name || "tool"} ${tc.status || ""}`,
        { message_index: index },
        at
      );
    }
  });

  for (const [mdl, t] of tokensByModel(messages)) {
    stmts.replaceTokenUsage.run(
      id,
      mdl,
      "standard",
      "global",
      "standard",
      t.input,
      t.output,
      t.cached,
      0,
      0,
      0,
      0,
      0
    );
  }
  return { changed: true, created, session: stmts.getSession.get(id), events };
}

async function syncGeminiSessions(dbModule, options = {}) {
  const files = discoverGeminiChats(options.home);
  const counters = { filesScanned: files.length, imported: 0, updated: 0, skipped: 0 };
  for (const file of files) {
    let fp;
    try {
      const st = fs.statSync(file);
      fp = `${st.size}:${Math.floor(st.mtimeMs)}`;
    } catch {
      continue;
    }
    const id = sessionIdFor(file);
    const row = dbModule.stmts.getSession.get(id);
    // Active rows re-run so they can age into "completed" without a file change.
    if (fingerprints.get(id) === fp && row && row.status !== "active") {
      counters.skipped++;
      continue;
    }
    const result = importGeminiFile(dbModule, file);
    if (result.session) fingerprints.set(id, fp);
    if (result.created) counters.imported++;
    else if (result.changed) counters.updated++;
    if (result.changed && typeof options.onSession === "function") options.onSession(result);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return counters;
}

module.exports = { discoverGeminiChats, getGeminiHome, importGeminiFile, syncGeminiSessions };
