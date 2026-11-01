/**
 * @file Express router for AI Cockpit live telemetry: token throughput, cache hit rate and caching savings (see server/lib/telemetry.js).
 * @author Caglar Ulkuderner
 */

const { Router } = require("express");
const telemetry = require("../lib/telemetry");

const router = Router();

router.get("/", (_req, res) => res.json(telemetry.report()));

module.exports = router;
