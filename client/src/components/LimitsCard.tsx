/**
 * @file LimitsCard.tsx
 * @description AI Cockpit usage-limit tile: Claude and Codex 5-hour and weekly windows as rings with reset times. Shows "unknown" when a provider reports nothing; never invents a value.
 * @author Caglar Ulkuderner
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Gauge } from "lucide-react";
import { type LimitWindow } from "../lib/cockpit";
import { request } from "../lib/api";

function tone(pct: number) {
  if (pct >= 90) return "#f87171";
  if (pct >= 70) return "#fbbf24";
  return "#34d399";
}

function Meter({ win, label }: { win: LimitWindow | null; label: string }) {
  const { t, i18n } = useTranslation("cockpit");
  const pct = win ? Math.min(Math.max(win.used_percent, 0), 100) : 0;
  const reset = win
    ? new Date(win.resets_at * 1000).toLocaleString(i18n.language, {
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const pctText = win
    ? new Intl.NumberFormat(i18n.language, { style: "percent" }).format(pct / 100)
    : t("unknown");
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-gray-300">{label}</span>
        <span className="text-gray-100 font-medium tabular-nums">{pctText}</span>
      </div>
      <div
        className="mt-1.5 h-1.5 rounded-full bg-surface-5 overflow-hidden"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={win ? Math.round(pct) : undefined}
        aria-valuetext={pctText}
      >
        {win && (
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${pct}%`, background: tone(pct) }}
          />
        )}
      </div>
      {reset && (
        <div className="mt-1 text-[11px] text-gray-500">{t("resetsAt", { time: reset })}</div>
      )}
    </div>
  );
}

interface Subscription {
  provider: string;
  name: string;
  plan: string | null;
  windows: { five_hour: LimitWindow | null; seven_day: LimitWindow | null } | null;
  sessions_today: number | null;
  requests_today?: number | null;
  dashboard: string;
  note: "statusline" | "no-local-quota" | null;
}

export function LimitsCard() {
  const { t } = useTranslation("cockpit");
  const [items, setItems] = useState<Subscription[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      request<{ items: Subscription[] }>("/limits/subscriptions")
        .then((d) => alive && (setItems(d.items), setError(false)))
        .catch(() => alive && setError(true));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <section className="card p-5" aria-labelledby="limits-title">
      <div className="flex items-center gap-2 mb-4">
        <Gauge className="w-4 h-4 text-accent" aria-hidden />
        <h2 id="limits-title" className="text-sm font-semibold text-gray-200 tracking-wide">
          {t("limitsTitle")}
        </h2>
        {error && <span className="ml-auto text-xs text-red-400">{t("limitsError")}</span>}
      </div>
      <div className="space-y-5">
        {items?.map((s) => (
          <div key={s.provider} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase tracking-wider text-gray-500">{s.name}</span>
              {s.plan && (
                <span className="rounded bg-accent-muted px-1.5 py-0.5 text-[10px] text-indigo-200">
                  {s.plan}
                </span>
              )}
              <a
                href={s.dashboard}
                target="_blank"
                rel="noreferrer"
                className="ml-auto text-[11px] text-gray-500 hover:text-gray-200 hover:underline"
              >
                {t("usagePanel")} ↗
              </a>
            </div>
            {s.windows ? (
              <div className="grid grid-cols-2 gap-4">
                <Meter win={s.windows.five_hour ?? null} label={t("fiveHour")} />
                <Meter win={s.windows.seven_day ?? null} label={t("weekly")} />
              </div>
            ) : (
              <p className="text-[11px] leading-relaxed text-gray-500">
                {s.note === "statusline" ? t("claudeLimitsHint") : t("noLocalQuota")}
              </p>
            )}
            <div className="text-[11px] text-gray-400 tabular-nums">
              {t("todayActivity", { count: s.sessions_today ?? 0 })}
              {s.requests_today != null && ` · ${t("requestsToday", { count: s.requests_today })}`}
            </div>
          </div>
        ))}
        {items && items.length === 0 && (
          <p className="text-xs text-gray-500">{t("noSubscriptions")}</p>
        )}
      </div>
    </section>
  );
}
