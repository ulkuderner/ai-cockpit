/**
 * @file Tests for AI Cockpit re-read measurement.
 * @author Caglar Ulkuderner
 */

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { aggregate } = require("../lib/rereads");

const read = (session, file, extra = {}) => ({
  session_id: session,
  created_at: "2026-11-01T10:00:00Z",
  data: JSON.stringify({ tool_input: { file_path: file, ...extra } }),
});

test("only repeated files, cost = extra full reads x file tokens", () => {
  const rows = aggregate(
    [
      read("a", "/big.md"),
      read("b", "/big.md"),
      read("c", "/big.md"),
      read("a", "/once.md"),
      read("a", "/gone.md"),
      read("a", "/gone.md"),
    ],
    (f) => ({ "/big.md": 4000, "/once.md": 400 })[f] ?? null
  );
  assert.deepEqual(
    rows.map((r) => r.file),
    ["/big.md", "/gone.md"]
  );
  assert.equal(rows[0].sessions, 3);
  assert.equal(rows[0].repeat_tokens, 2 * 1000);
  assert.equal(rows[1].repeat_tokens, null);
});

test("partial reads count at a quarter", () => {
  const rows = aggregate([read("a", "/f"), read("a", "/f", { offset: 10, limit: 50 })], () => 4000);
  assert.equal(rows[0].repeat_tokens, 250);
});
