/**
 * @file AI Cockpit task fields: parses the Alan/Bağlı/est/Kabul field lines from an issue body, decides whether two tasks' area patterns overlap, and writes a plan task back into issue-body form.
 * @author Caglar Ulkuderner
 */

const AREA_RE = /^alan[ \t]*:[ \t]*(.*)$/i;
const DEPS_RE = /^ba[ğg]l[ıiİI][ \t]*:[ \t]*(.*)$/i;
const EST_RE = /^est[ \t]*:[ \t]*(.*)$/i;
const ACCEPT_RE = /^kabul[ \t]*:[ \t]*(.*)$/i;
const EST_VALUE_RE = /^(\d+(?:\.\d+)?)\s*(h|m)$/i;

function parseArea(value) {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDeps(value) {
  const out = [];
  for (const part of value.split(",")) {
    const n = part.trim().replace(/^#/, "");
    if (/^\d+$/.test(n)) out.push(parseInt(n, 10));
  }
  return out;
}

function parseEstimate(value) {
  const m = value.trim().match(EST_VALUE_RE);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === "h" ? n * 3_600_000 : n * 60_000;
}

/** Reads the task field lines from an issue body. Field names are matched at line start, case-insensitively (Bagli: also accepted for Bağlı:). */
function parseTaskFields(body) {
  const fields = { area: [], deps: [], estimate_ms: null, acceptance: [] };
  let inAcceptance = false;
  for (const line of String(body).split(/\r?\n/)) {
    if (inAcceptance) {
      const t = line.trim();
      if (!t) {
        inAcceptance = false;
        continue;
      }
      if (t.startsWith("- ")) {
        fields.acceptance.push(t.slice(2).trim());
        continue;
      }
      inAcceptance = false;
    }
    let m = line.match(AREA_RE);
    if (m) {
      fields.area.push(...parseArea(m[1]));
      continue;
    }
    m = line.match(DEPS_RE);
    if (m) {
      fields.deps.push(...parseDeps(m[1]));
      continue;
    }
    m = line.match(EST_RE);
    if (m) {
      const ms = parseEstimate(m[1]);
      if (ms != null) fields.estimate_ms = ms;
      continue;
    }
    m = line.match(ACCEPT_RE);
    if (m) {
      if (m[1].trim()) fields.acceptance.push(m[1].trim());
      inAcceptance = true;
    }
  }
  return fields;
}

/** Root of an area pattern: everything before the first wildcard, with the trailing slash dropped. */
function areaRoot(pattern) {
  const cut = pattern.search(/[*?\[]/);
  return (cut === -1 ? pattern : pattern.slice(0, cut)).replace(/\/+$/, "");
}

/** True when a pattern's root is equal to the other's or the other pattern lies under it. */
function areasOverlap(a, b) {
  if (!a.length || !b.length) return false;
  for (const x of a) {
    const rx = areaRoot(x);
    for (const y of b) {
      const ry = areaRoot(y);
      // An empty root ("**") covers the whole repo.
      if (!rx || !ry || rx === ry || y.startsWith(rx + "/") || x.startsWith(ry + "/")) return true;
    }
  }
  return false;
}

function formatEstimate(ms) {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  return `${ms / 60_000}m`;
}

/** Writes a plan task as an issue body: field lines first, blank line, then the plan task text. */
function taskIssueBody({ body, files, estimate_ms, deps }) {
  const lines = [];
  if (files && files.length) lines.push(`Alan: ${files.join(", ")}`);
  if (deps && deps.length) lines.push(`Bağlı: ${deps.map((n) => `#${n}`).join(", ")}`);
  if (estimate_ms != null) lines.push(`est: ${formatEstimate(estimate_ms)}`);
  if (lines.length) lines.push("");
  lines.push(body);
  return lines.join("\n");
}

module.exports = { parseTaskFields, areasOverlap, taskIssueBody };
