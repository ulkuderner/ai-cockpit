/**
 * @file PriceSync.tsx
 * @description AI Cockpit price sync UI: a Settings card with the "Sync from LiteLLM" button and last sync/check times, and a Dashboard notice when the weekly check found price differences for models in use.
 * @author Caglar Ulkuderner
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { RefreshCw, Tag } from "lucide-react";
import { request } from "../lib/api";

interface Change {
  table: "claude" | "gpt";
  model: string;
  kind: "add" | "change";
  old: { input: number; output: number; cache_read: number; cache_write: number } | null;
  new: { input: number; output: number; cache_read: number; cache_write: number };
}

interface Status {
  last_sync: string | null;
  last_check: string | null;
  pending: Change[];
  source: string;
}

const fmt = (c: Change["new"] | null) =>
  c ? `${c.input} / ${c.output} · ${c.cache_read} / ${c.cache_write}` : "—";

function ChangeList({ changes }: { changes: Change[] }) {
  const { t } = useTranslation("cockpit");
  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {changes.map((c) => (
        <li
          key={`${c.table}|${c.model}`}
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-xs"
        >
          <span className="font-mono text-gray-200">{c.model}</span>
          <span className={c.kind === "add" ? "text-emerald-300" : "text-amber-300"}>
            {t(`prices.kind.${c.kind}`)}
          </span>
          <span className="ml-auto font-mono text-gray-500 tabular-nums">
            {c.old && <span className="line-through mr-2">{fmt(c.old)}</span>}
            <span className="text-gray-300">{fmt(c.new)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PriceSyncCard() {
  const { t, i18n } = useTranslation("cockpit");
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<Change[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(
    () =>
      request<Status>("/prices/status")
        .then(setStatus)
        .catch(() => {}),
    []
  );
  useEffect(() => {
    load();
  }, [load]);
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language, { dateStyle: "medium", timeStyle: "short" })
      : t("prices.never");
  return (
    <section className="card p-5 space-y-4" aria-labelledby="price-sync-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h3
            id="price-sync-title"
            className="flex items-center gap-2 text-sm font-semibold text-gray-200"
          >
            <Tag className="w-4 h-4 text-accent" aria-hidden />
            {t("prices.title")}
          </h3>
          <p className="mt-1 text-xs text-gray-500">{t("prices.hint")}</p>
          <p className="mt-2 text-xs text-gray-400">
            {t("prices.lastSync", { when: when(status?.last_sync ?? null) })} ·{" "}
            {t("prices.lastCheck", { when: when(status?.last_check ?? null) })}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const r = await request<{ applied: Change[] }>("/prices/sync", { method: "POST" });
              setApplied(r.applied);
              await load();
            } catch (x) {
              setErr((x as Error).message);
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
        >
          <RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} aria-hidden />
          {busy ? t("prices.syncing") : t("prices.sync")}
        </button>
      </div>
      {err && (
        <p className="text-xs text-red-400" role="alert">
          {err}
        </p>
      )}
      {status && status.pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-amber-300">
            {t("prices.pending", { count: status.pending.length })}
          </p>
          <ChangeList changes={status.pending} />
        </div>
      )}
      {applied && (
        <div className="space-y-2">
          <p className="text-xs text-emerald-300">
            {applied.length ? t("prices.applied", { count: applied.length }) : t("prices.upToDate")}
          </p>
          {applied.length > 0 && <ChangeList changes={applied} />}
        </div>
      )}
      <p className="text-[11px] text-gray-500">
        {t("prices.legend")} ·{" "}
        <a
          href={status?.source}
          target="_blank"
          rel="noreferrer"
          className="underline-offset-2 hover:underline"
        >
          LiteLLM
        </a>
      </p>
    </section>
  );
}

/** Dashboard notice after the weekly check finds differences. */
export function PriceChangeNotice() {
  const { t } = useTranslation("cockpit");
  const [count, setCount] = useState(0);
  useEffect(() => {
    request<Status>("/prices/status")
      .then((s) => setCount(s.pending.length))
      .catch(() => {});
  }, []);
  if (!count) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/10 ring-1 ring-amber-400/25 px-4 py-3 text-sm text-amber-200"
      role="status"
    >
      <Tag className="w-4 h-4" aria-hidden />
      {t("prices.notice", { count })}
      <Link
        to="/settings#prices"
        className="ml-auto text-xs font-medium underline-offset-2 hover:underline"
      >
        {t("prices.review")}
      </Link>
    </div>
  );
}
