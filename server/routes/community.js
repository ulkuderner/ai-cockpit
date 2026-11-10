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

// Body: { provider: "github"|"gitlab"|"local", localPath, repo?, label?, host? (GitLab), planFile? (local: required; hosted: optional, for plan sync), staleHours? (1-168, default 4) }
router.put(
  "/config",
  wrap(async (req) => {
    const b = req.body || {};
    const provider = String(b.provider || "github");
    const staleHours = b.staleHours == null || b.staleHours === "" ? 4 : Number(b.staleHours);
    const cfg = {
      ...(provider === "local"
        ? {
            provider,
            localPath: String(b.localPath || "").trim(),
            planFile: String(b.planFile || "").trim(),
          }
        : {
            provider,
            repo: String(b.repo || "").trim(),
            localPath: String(b.localPath || "").trim(),
            label: String(b.label || "cockpit-task").trim(),
            ...(provider === "gitlab" && b.host ? { host: String(b.host).trim() } : {}),
            ...(b.planFile ? { planFile: String(b.planFile).trim() } : {}),
          }),
      staleHours,
      ...(b.worktrunk !== undefined ? { worktrunk: b.worktrunk } : {}),
      ...(b.worktrunkHooks !== undefined ? { worktrunkHooks: b.worktrunkHooks } : {}),
    };
    community.validateConfig(cfg);
    // Saving settings must not drop local claims and their handover notes.
    const prev = community.readConfig();
    if (prev?.claims && prev.localPath === cfg.localPath) cfg.claims = prev.claims;
    community.writeConfig(cfg);
    return cfg;
  })
);

router.get(
  "/members",
  wrap(() => community.members(config()))
);
router.get(
  "/dirs",
  wrap(async (req) => community.listDirs(typeof req.query.path === "string" ? req.query.path : ""))
);
router.get(
  "/board",
  wrap(async () => {
    const cfg = config();
    let liveCwds = [];
    try {
      // Lazy require keeps this router importable without opening the dashboard
      // DB, and the board still loads when the center is closed or unreachable.
      const { db } = require("../db");
      liveCwds = db
        .prepare("SELECT cwd FROM sessions WHERE status = 'active'")
        .all()
        .map((r) => r.cwd)
        .filter(Boolean);
    } catch {
      liveCwds = [];
    }
    return community.board(cfg, liveCwds);
  })
);
// Plan sync: GET only previews what would be created/updated; POST is the one
// route besides claim/release/PR that writes outside the machine.
router.get(
  "/plan-sync",
  wrap(() => community.planSyncPreview(config()))
);
router.post(
  "/plan-sync",
  wrap(() => community.planSync(config()))
);
router.post(
  "/tasks/:number/claim",
  wrap((req) => community.claim(config(), issueNumber(req)))
);
router.post(
  "/tasks/:number/release/preview",
  wrap((req) =>
    community.releasePreview(config(), issueNumber(req), String((req.body || {}).note || ""))
  )
);
router.post(
  "/tasks/:number/release",
  wrap((req) => community.release(config(), issueNumber(req), String((req.body || {}).note || "")))
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
