/**
 * @file quips.ts
 * @description Tabby's personality: pools of short phrases keyed by pulse/mood,
 *   plus a deterministic-by-injection picker. Pure data + a pure function so it
 *   can be unit-tested without randomness leaking in.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
/* =============================================================================
 * MODULE_GUIDE — extended in-file reference (comments only; safe to read, never executed)
 * =============================================================================
 * **Path:** `/Users/davidnguyen/WebstormProjects/Claude-Code-Agent-Monitor/client/src/components/Tabby/quips.ts`
 * **Purpose:** Tabby (shown to users as Samba, an English Setter) is the optional on-screen dog assistant — quips, intents, and lightweight event reactions layered above the dashboard chrome.
 *
 * ## Design constraints
 * - Local-first: no telemetry leaves the machine unless the user configures webhooks.
 * - Fail-safe hooks path on the server must never block Claude Code; UI mirrors that
 *   philosophy by degrading gracefully (empty states, stale badges, reconnect loops).
 * - Destructive flows stay behind explicit confirmation modals and server-side gates.
 * - Internationalization: user-visible strings belong in i18n JSON, not literals here.
 *
 * ## Remote data & SSH
 * Remote Data Sources let operators aggregate multiple machines. SSH entries describe
 * how to reach a peer dashboard; the global data scope (`dataScope.ts`) narrows every
 * scoped GET via `?sources=`. Health checks and import history surface in Settings.
 *
 * ## Observability
 * Prometheus scrapes `GET /api/metrics` (see `monitoring/`). Grafana ships four
 * provisioned boards (overview, sessions, tools, alerts). Native npm scripts and
 * Docker Compose profiles are documented in `monitoring/README.md`.
 *
 * ## Internal dependencies
 * - `./brain`
 *
 * ## Public surface
 * - `QuipKey` — exported API; see TSDoc on the symbol for behavior.
 * - `pickQuip` — exported API; see TSDoc on the symbol for behavior.
 * - `ALL_QUIP_KEYS` — exported API; see TSDoc on the symbol for behavior.
 *
 * ## Testing pointers
 * - Prefer colocated `__tests__` with Vitest + Testing Library for UI.
 * - Server contract changes require `npm run test:server` and OpenAPI sync.
 * - MCP edits: `npm run mcp:typecheck` and `npm run mcp:build`.
 *
 * ## Related docs
 * - `ARCHITECTURE.md` — hooks → API → SQLite → WebSocket → UI pipeline.
 * - `docs/API.md` — REST reference.
 * - `.claude/skills/file-headers/` — mandatory `@author` header policy.
 * ============================================================================= */
/* -----------------------------------------------------------------------------
 * EXPORT CATALOG — quick index of symbols defined below (documentation only).
 * -----------------------------------------------------------------------------
 * **QuipKey**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **pickQuip**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * **ALL_QUIP_KEYS**
 *   Part of this module's public contract. Downstream imports should treat
 *   the signature and return type as stable unless release notes say otherwise.
 *   When behavior changes, update the `@file` overview and relevant tests.
 *
 * ----------------------------------------------------------------------------- */

import i18n from "i18next";
import type { Mood, TabbyPulse } from "./brain";

/** What a quip responds to: an event pulse or a mood. */
export type QuipKey = NonNullable<TabbyPulse> | Mood;

/** Every key with lines under `samba:quips.*` in the locale files. */
const QUIP_KEYS: QuipKey[] = [
  "session_done",
  "session_start",
  "subagent_spawn",
  "waiting",
  "error",
  "run_done",
  "disconnected",
  "worried",
  "stuck",
  "happy",
  "thinking",
  "watching",
  "sleeping",
  "idle",
];

/**
 * Pick a quip for a key. `rand` is injectable for deterministic tests; defaults
 * to Math.random. Returns "" only for an unknown key (never throws).
 *
 * @param key - Pulse or mood to respond to.
 * @param rand - Random source in [0, 1); injectable for tests.
 * @returns One of the lines for that key.
 */
export function pickQuip(key: QuipKey, rand: () => number = Math.random): string {
  const pool = i18n.t(`samba:quips.${key}`, { returnObjects: true }) as unknown;
  if (!Array.isArray(pool) || pool.length === 0) return "";
  const i = Math.min(pool.length - 1, Math.max(0, Math.floor(rand() * pool.length)));
  return String(pool[i] ?? "");
}

/** Every quip key, used by tests to check each one has lines. */
export const ALL_QUIP_KEYS = QUIP_KEYS;
