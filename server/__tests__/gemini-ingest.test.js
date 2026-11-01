/**
 * @file gemini-ingest.test.js
 * @description Verifies the read-only Gemini CLI chat import: session, agent,
 * events, token usage, idempotent re-sync, appended messages, and that the
 * provider/source filters accept "gemini".
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-ingest-"));
process.env.DASHBOARD_DB_PATH = path.join(TMP, "dashboard.db");
const HOME = path.join(TMP, "gemini");

const dbModule = require("../db");
const { syncGeminiSessions } = require("../lib/gemini-ingest");
const { parseProviders } = require("../lib/provider-filter");
const { parseSources } = require("../lib/source-filter");

const file = path.join(HOME, "tmp/hash1/chats/session-2025-11-28T07-56-22ba1a29.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
const chat = {
  sessionId: "22ba1a29-9fd1-4203-9b0b-b2e46a68807e",
  projectHash: "hash1",
  startTime: "2025-11-28T07:56:00.000Z",
  lastUpdated: "2025-11-28T08:00:00.000Z",
  messages: [
    {
      id: "1",
      timestamp: "2025-11-28T07:56:00.000Z",
      type: "user",
      content: "Analyze the RPC code",
    },
    {
      id: "2",
      timestamp: "2025-11-28T07:57:00.000Z",
      type: "gemini",
      content: "Starting.",
      model: "gemini-2.5-pro",
      tokens: { input: 100, output: 20, cached: 40, thoughts: 5, tool: 0, total: 125 },
      toolCalls: [{ id: "t1", name: "read_file", status: "success" }],
    },
  ],
};

describe("gemini ingest", () => {
  it("imports session, events and tokens, then is idempotent", async () => {
    fs.writeFileSync(file, JSON.stringify(chat));
    const seen = [];
    const r1 = await syncGeminiSessions(dbModule, { home: HOME, onSession: (r) => seen.push(r) });
    assert.equal(r1.imported, 1);
    const s = dbModule.db.prepare("SELECT * FROM sessions WHERE provider = 'gemini'").get();
    assert.equal(s.model, "gemini-2.5-pro");
    assert.equal(s.status, "completed");
    assert.equal(s.name, "Analyze the RPC code");
    assert.equal(s.started_at, chat.startTime);
    assert.equal(s.ended_at, chat.lastUpdated);
    const ev = dbModule.db
      .prepare("SELECT event_type, tool_name FROM events WHERE session_id = ? ORDER BY id")
      .all(s.id);
    assert.deepEqual(
      ev.map((e) => e.event_type),
      ["gemini_user_message", "gemini_response_message", "gemini_tool_call"]
    );
    assert.equal(ev[2].tool_name, "read_file");
    const tu = dbModule.db.prepare("SELECT * FROM token_usage WHERE session_id = ?").get(s.id);
    assert.equal(tu.input_tokens, 100);
    assert.equal(tu.output_tokens, 25);
    assert.equal(tu.cache_read_tokens, 40);

    const r2 = await syncGeminiSessions(dbModule, { home: HOME });
    assert.equal(r2.skipped, 1);
    assert.equal(
      dbModule.db.prepare("SELECT COUNT(*) c FROM events WHERE session_id = ?").get(s.id).c,
      3
    );
  });

  it("appends only new messages when the file grows", async () => {
    chat.messages.push({
      id: "3",
      timestamp: "2025-11-28T08:00:00.000Z",
      type: "user",
      content: "More",
    });
    fs.writeFileSync(file, JSON.stringify(chat));
    const r = await syncGeminiSessions(dbModule, { home: HOME });
    assert.equal(r.updated, 1);
    assert.equal(
      dbModule.db.prepare("SELECT COUNT(*) c FROM events WHERE session_id LIKE 'gemini-%'").get().c,
      4
    );
  });

  it("filters accept gemini", () => {
    assert.deepEqual(parseProviders({ query: { providers: "gemini" } }), ["gemini"]);
    assert.deepEqual(parseSources({ query: { sources: "gemini,local" } }), ["gemini", "local"]);
  });
});
