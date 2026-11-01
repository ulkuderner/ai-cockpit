/**
 * @file Express router for AI Cockpit price sync: status (last sync/check, pending differences), on-demand sync from the LiteLLM price list, and a dry-run check (see server/lib/price-sync.js).
 * @author Caglar Ulkuderner
 */

const { Router } = require("express");
const prices = require("../lib/price-sync");

const router = Router();

const wrap = (fn) => async (_req, res) => {
  try {
    res.json(await fn());
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
};

router.get("/status", (_req, res) => res.json(prices.status()));
router.post(
  "/sync",
  wrap(() => prices.sync())
);
router.post(
  "/check",
  wrap(async () => ({ pending: await prices.check() }))
);

module.exports = router;
