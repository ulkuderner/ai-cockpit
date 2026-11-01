/**
 * @file Express router for AI Cockpit outgoing prompts: subagent and agent-CLI calls with their prompts (see server/lib/dispatches.js).
 * @author Caglar Ulkuderner
 */

const { Router } = require("express");
const dispatches = require("../lib/dispatches");

const router = Router();

router.get("/", (req, res) =>
  res.json(
    dispatches.list({
      session: typeof req.query.session === "string" ? req.query.session : null,
      limit: req.query.limit,
    })
  )
);

module.exports = router;
