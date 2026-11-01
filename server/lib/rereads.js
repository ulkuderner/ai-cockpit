/**
 * @file AI Cockpit token saving v1: measures the same files being read again and again (by one agent or by many). Every repeated Read sends the file into a model context once more; the report ranks files by the tokens those repeats cost so they can be summarised, cached in CLAUDE.md, or handed over in a brief instead of re-read.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const { db } = require("../db");

// Rough but standard: ~4 characters per token for code and prose.
const CHARS_PER_TOKEN = 4;

/** Pure: Read events → per-file repeat stats. `sizeOf(path)` returns bytes or null. Exported for tests. */
function aggregate(events, sizeOf) {
  const byFile = new Map();
  for (const e of events) {
    let input;
    try {
      input = JSON.parse(e.data || "{}").tool_input || {};
    } catch {
      continue;
    }
    const file = input.file_path;
    if (typeof file !== "string" || !file) continue;
    const f = byFile.get(file) || {
      file,
      reads: 0,
      sessions: new Set(),
      partial: 0,
      last_at: null,
    };
    f.reads++;
    f.sessions.add(e.session_id);
    if (input.offset != null || input.limit != null) f.partial++;
    if (!f.last_at || e.created_at > f.last_at) f.last_at = e.created_at;
    byFile.set(file, f);
  }
  const rows = [];
  for (const f of byFile.values()) {
    if (f.reads < 2) continue;
    const bytes = sizeOf(f.file);
    const tokens = bytes == null ? null : Math.round(bytes / CHARS_PER_TOKEN);
    // Partial reads (offset/limit) cost less; count them at a quarter of the file.
    const full = f.reads - f.partial;
    const repeatTokens =
      tokens == null
        ? null
        : Math.round(
            Math.max(full - 1, 0) * tokens + Math.max(f.partial - (full ? 0 : 1), 0) * tokens * 0.25
          );
    rows.push({
      file: f.file,
      reads: f.reads,
      sessions: f.sessions.size,
      partial: f.partial,
      file_tokens: tokens,
      repeat_tokens: repeatTokens,
      last_at: f.last_at,
    });
  }
  rows.sort((a, b) => (b.repeat_tokens ?? 0) - (a.repeat_tokens ?? 0) || b.reads - a.reads);
  return rows;
}

function sizeOf(file) {
  try {
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

function report({ days = 7, limit = 15 } = {}) {
  const d = Math.min(Math.max(Number(days) || 7, 1), 90);
  const events = db
    .prepare(
      `SELECT session_id, data, created_at FROM events
       WHERE event_type = 'PreToolUse' AND tool_name = 'Read' AND created_at > datetime('now', ?)
       ORDER BY id DESC LIMIT 50000`
    )
    .all(`-${d} days`);
  const rows = aggregate(events, sizeOf);
  return {
    days: d,
    total_reads: events.length,
    repeated_files: rows.length,
    repeat_tokens: rows.reduce((s, r) => s + (r.repeat_tokens || 0), 0),
    files: rows.slice(0, Math.min(Math.max(Number(limit) || 15, 1), 100)),
  };
}

module.exports = { aggregate, report };
