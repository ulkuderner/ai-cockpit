/**
 * @file Express router for the AI Cockpit plan view: list configured plans with parsed phases, task status, queue and duration estimates; edit plan list, manual task status and queue order.
 * @author Caglar Ulkuderner
 */

const fs = require("fs");
const path = require("path");
const { Router } = require("express");
const { db } = require("../db");
const plan = require("../lib/plan");

const router = Router();

// shortcut: scans every session/agent row each request; add an index or cache if plans get slow with 10k+ sessions.
function loadWork() {
  const sessions = db
    .prepare("SELECT name, card_prompt_preview, status, started_at, ended_at FROM sessions")
    .all()
    .map((s) => ({
      text: `${s.name || ""}\n${s.card_prompt_preview || ""}`,
      started_at: s.started_at,
      ended_at: s.ended_at,
      live: s.status === "active",
      label: s.name || "Oturum",
    }));
  const agents = db
    .prepare("SELECT name, task, status, started_at, ended_at FROM agents WHERE type = 'subagent'")
    .all()
    .map((a) => ({
      text: `${a.name || ""}\n${a.task || ""}`,
      started_at: a.started_at,
      ended_at: a.ended_at,
      live: a.status === "working" || a.status === "waiting",
      label: a.name || "Alt ajan",
    }));
  return [...sessions, ...agents];
}

router.get("/", (_req, res) => {
  const state = plan.readState();
  const work = loadWork();
  res.json({ plans: state.plans.map((p) => plan.buildPlan(p, state, work)) });
});

// Body: { plans: [{ id?, name, file }] } — file must be an existing absolute .md path.
router.put("/config", (req, res) => {
  const input = Array.isArray(req.body?.plans) ? req.body.plans : null;
  if (!input) return res.status(400).json({ error: "plans dizisi gerekli" });
  const plans = [];
  for (const p of input) {
    const file = typeof p.file === "string" ? p.file.trim() : "";
    if (!path.isAbsolute(file) || !file.endsWith(".md") || !fs.existsSync(file)) {
      return res.status(400).json({ error: `Geçersiz plan dosyası: ${file || "(boş)"}` });
    }
    const name = (typeof p.name === "string" && p.name.trim()) || path.basename(file, ".md");
    const id = (typeof p.id === "string" && p.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    plans.push({ id, name, file });
  }
  const state = plan.readState();
  state.plans = plans;
  plan.writeState(state);
  res.json({ plans });
});

router.patch("/:planId/tasks/:taskId", (req, res) => {
  const { planId, taskId } = req.params;
  const status = req.body?.status;
  if (!plan.STATUSES.has(status))
    return res.status(400).json({ error: "status: todo | done | blocked" });
  const state = plan.readState();
  if (!state.plans.some((p) => p.id === planId)) return res.status(404).json({ error: "plan yok" });
  state.tasks[planId] = state.tasks[planId] || {};
  if (status === "todo") delete state.tasks[planId][taskId];
  else state.tasks[planId][taskId] = { status, at: new Date().toISOString() };
  plan.writeState(state);
  res.json({ ok: true });
});

// Body: { order: ["17a", "15c", ...] }
router.put("/:planId/order", (req, res) => {
  const order = req.body?.order;
  if (!Array.isArray(order) || !order.every((x) => typeof x === "string")) {
    return res.status(400).json({ error: "order dizisi gerekli" });
  }
  const state = plan.readState();
  if (!state.plans.some((p) => p.id === req.params.planId))
    return res.status(404).json({ error: "plan yok" });
  state.order[req.params.planId] = order.map((x) => x.toLowerCase());
  plan.writeState(state);
  res.json({ ok: true });
});

module.exports = router;
