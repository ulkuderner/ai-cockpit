/**
 * @file Express router for AI Cockpit community work: shared GitHub Issues task board, claim/release, PR preview and PR creation (see server/lib/community.js).
 * @author Caglar Ulkuderner
 */

const { Router } = require("express");
const community = require("../lib/community");

const router = Router();

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(err.status || 502).json({ error: err.message });
  }
};

function config() {
  const cfg = community.readConfig();
  if (!cfg) throw Object.assign(new Error("Topluluk deposu ayarlanmadı"), { status: 404 });
  return cfg;
}

function issueNumber(req) {
  const n = Number.parseInt(req.params.number, 10);
  if (!Number.isInteger(n) || n <= 0)
    throw Object.assign(new Error("Geçersiz issue numarası"), { status: 400 });
  return n;
}

router.get("/config", (_req, res) => res.json(community.readConfig() || null));

// Body: { repo: "owner/name", localPath: "/abs/clone", label?: "cockpit-task" }
router.put(
  "/config",
  wrap(async (req) => {
    const cfg = {
      repo: String(req.body?.repo || "").trim(),
      localPath: String(req.body?.localPath || "").trim(),
      label: String(req.body?.label || "cockpit-task").trim(),
    };
    community.validateConfig(cfg);
    community.writeConfig(cfg);
    return cfg;
  })
);

router.get(
  "/board",
  wrap(() => community.board(config()))
);
router.post(
  "/tasks/:number/claim",
  wrap((req) => community.claim(config(), issueNumber(req)))
);
router.post(
  "/tasks/:number/release",
  wrap((req) => community.release(config(), issueNumber(req)))
);
router.get(
  "/tasks/:number/pr",
  wrap((req) => community.prPreview(config(), issueNumber(req)))
);
router.post(
  "/tasks/:number/pr",
  wrap((req) => community.openPr(config(), issueNumber(req)))
);

module.exports = router;
