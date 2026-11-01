/**
 * @file Express router for AI Cockpit token saving: files read repeatedly by agents and their token cost (see server/lib/rereads.js).
 * @author Caglar Ulkuderner
 */

const { Router } = require("express");
const rereads = require("../lib/rereads");

const router = Router();

router.get("/", (req, res) =>
  res.json(rereads.report({ days: req.query.days, limit: req.query.limit }))
);

module.exports = router;
