/**
 * @file gemini-sync.js
 * @description Periodic Gemini CLI chat import. Polls every
 * DASHBOARD_GEMINI_SYNC_MS (default 10s, 0 disables); overlapping ticks queue
 * one follow-up. Unref'd so it never blocks shutdown.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { syncGeminiSessions } = require("./gemini-ingest");

function startGeminiSessionSync(broadcast, options = {}) {
  const POLL_MS = process.env.DASHBOARD_GEMINI_SYNC_MS
    ? Number(process.env.DASHBOARD_GEMINI_SYNC_MS)
    : 10_000;
  if (!Number.isFinite(POLL_MS) || POLL_MS <= 0) return () => {};
  const dbModule = options.dbModule || require("../db");
  let running = false;
  let queued = false;
  const tick = () => {
    if (running) {
      queued = true;
      return;
    }
    running = true;
    syncGeminiSessions(dbModule, {
      onSession(result) {
        broadcast(result.created ? "session_created" : "session_updated", result.session);
        for (const agent of dbModule.stmts.listAgentsBySession.all(result.session.id)) {
          broadcast(result.created ? "agent_created" : "agent_updated", agent);
        }
        for (const event of result.events || []) broadcast("new_event", event);
      },
    })
      .catch((err) => console.warn("Gemini session sync tick failed:", err?.message || err))
      .finally(() => {
        running = false;
        if (queued) {
          queued = false;
          tick();
        }
      });
  };
  const boot = setTimeout(tick, 3_000);
  const timer = setInterval(tick, POLL_MS);
  boot.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(boot);
    clearInterval(timer);
  };
}

module.exports = { startGeminiSessionSync };
