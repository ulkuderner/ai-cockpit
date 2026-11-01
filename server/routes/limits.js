/**
 * @file limits.js
 * @description GET /api/limits: local-only Claude and Codex usage-limit windows
 * (five_hour / seven_day) read from disk by lib/usage-limits.js.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { getLimits } = require("../lib/usage-limits");

const router = Router();

router.get("/", (_req, res) => {
  try {
    res.json(getLimits());
  } catch {
    res.json({ claude: null, codex: null });
  }
});

// AI Cockpit: every AI subscription set up on this machine, with plan, windows and today's activity.
router.get("/subscriptions", (_req, res) => {
  try {
    res.json(require("../lib/subscriptions").list());
  } catch {
    res.json({ items: [] });
  }
});

module.exports = router;
