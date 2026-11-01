/**
 * @file TelemetryCard.tsx
 * @description AI Cockpit live telemetry: token throughput, cache hit rate and money saved by prompt caching, for the last hour (per-minute chart) and all time. Polls /api/telemetry.
 * @author Caglar Ulkuderner
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity } from "lucide-react";
import { cockpit, type TelemetryPayload } from "../lib/cockpit";

const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  cursor: "Cursor",
  gemini: "Gemini",
};

const W = 600;
const H = 96;

function Chart({ series }: { series: TelemetryPayload["series"] }) {
  const { t } = useTranslation("cockpit");
  if (series.length < 2) {
    return (
      <div className="h-24 flex items-center justify-center text-xs text-gray-500">
        {t("noActivity")}
      </div>
    );
  }
  const max = Math.max(...series.map((p) => p.tokens), 1);
  // Fixed 60-minute axis ending now, so the chart fills from the right as data arrives.
  const SLOTS = 60;
  const nowMin = Math.floor(Date.now() / 60_000) * 60_000;
  const step = W / SLOTS;
  const barW = step * 0.7;
  const x = (t: number) => (SLOTS - 1 - (nowMin - t) / 60_000) * step + step / 2;
  const hitPts = series
    .filter((p) => p.cache_hit != null)
    .map((p) => `${x(p.t)},${H - p.cache_hit! * (H - 4) - 2}`)
    .join(" ");
  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-24"
        role="img"
        aria-label={t("tokensLegend")}
      >
        {series.map((p) => {
          const h = (p.tokens / max) * (H - 4);
          return (
            <rect
              key={p.t}
              x={x(p.t) - barW / 2}
              y={H - h}
              width={barW}
              height={h}
              rx={1.5}
              className="fill-accent/40"
            >
              <title>{`${new Date(p.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${p.tokens.toLocaleString()}`}</title>
            </rect>
          );
        })}
        {hitPts && (
          <polyline
            points={hitPts}
            fill="none"
            stroke="#34d399"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-[11px] text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent/40" />
          {t("tokensLegend")}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-emerald-400" />
          {t("hitLegend")}
        </span>
      </figcaption>
    </figure>
  );
}

export function TelemetryCard() {
  const { t, i18n } = useTranslation("cockpit");
  const [data, setData] = useState<TelemetryPayload | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      cockpit
        .telemetry()
        .then((d) => alive && setData(d))
        .catch(() => {});
    load();
    const id = setInterval(load, 5_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const lang = i18n.language;
  const pct = (v: number | null | undefined) =>
    v == null
      ? "—"
      : new Intl.NumberFormat(lang, { style: "percent", maximumFractionDigits: 1 }).format(v);
  const usd = (v: number | null) =>
    v == null
      ? t("unpriced")
      : new Intl.NumberFormat(lang, {
          style: "currency",
          currency: "USD",
          maximumFractionDigits: v < 100 ? 2 : 0,
        }).format(v);
  const compact = (v: number) =>
    new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(v);

  const w = data?.window;
  const a = data?.all_time;
  const minutes = data ? Math.max((Date.now() - data.window_started_at) / 60_000, 1) : 1;
  const started = data
    ? new Date(data.window_started_at).toLocaleTimeString(lang, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const stats = [
    {
      label: t("tokensPerMin"),
      value: w ? compact(w.tokens / Math.min(minutes, 60)) : "—",
      sub: w ? `${compact(w.tokens)} · ${t("lastHour")}` : "",
    },
    {
      label: t("cacheHit"),
      value: pct(w?.cache_hit),
      sub: `${t("allTime")}: ${pct(a?.cache_hit)}`,
      tone: "text-emerald-300",
    },
    {
      label: t("saved"),
      value: w ? usd(w.saved) : "—",
      sub: a ? `${t("allTime")}: ${usd(a.saved)}` : "",
      tone: "text-emerald-300",
    },
    {
      label: t("spentHour"),
      value: w ? usd(w.cost) : "—",
      sub: a ? `${t("allTime")}: ${usd(a.cost)}` : "",
    },
  ];

  return (
    <section className="card p-5" aria-labelledby="telemetry-title">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-accent" aria-hidden />
        <h2 id="telemetry-title" className="text-sm font-semibold text-gray-200">
          {t("telemetryTitle")}
        </h2>
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
        <span className="ml-auto text-[11px] text-gray-500">
          {data ? t("sinceStart", { time: started }) : ""}
        </span>
      </div>
      {a && a.saved != null && a.saved > 0 && (
        <div className="mb-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-400/20 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-emerald-300/80">
            {t("totalSaved")}
          </span>
          <span className="text-3xl font-semibold text-emerald-300 tabular-nums">
            {usd(a.saved)}
          </span>
          {a.no_cache_cost > 0 && (
            <span className="text-sm text-emerald-200/70">
              {t("totalSavedShare", { pct: pct(a.saved! / a.no_cache_cost) })}
            </span>
          )}
        </div>
      )}
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-5">
        {stats.map((s) => (
          <div key={s.label}>
            <dt className="text-xs uppercase tracking-wider text-gray-500">{s.label}</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${s.tone ?? "text-gray-100"}`}>
              {s.value}
            </dd>
            <dd className="text-xs text-gray-500 mt-0.5 tabular-nums">{s.sub}</dd>
          </div>
        ))}
      </dl>
      <Chart series={data?.series ?? []} />
      {data && data.models.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">{t("byModel")}</caption>
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
                <th scope="col" className="py-2 pr-3 font-medium">
                  {t("model")}
                </th>
                <th scope="col" className="py-2 px-3 font-medium text-right">
                  {t("lastHour")}
                </th>
                <th scope="col" className="py-2 px-3 font-medium text-right">
                  {t("allTime")}
                </th>
                <th scope="col" className="py-2 px-3 font-medium text-right">
                  {t("cacheHit")}
                </th>
                <th scope="col" className="py-2 pl-3 font-medium text-right">
                  {t("saved")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.models.slice(0, 10).map((m) => (
                <tr key={`${m.provider}|${m.model}`}>
                  <td className="py-2 pr-3">
                    <span className="inline-block w-14 mr-2 rounded px-1.5 py-0.5 text-[10px] text-center bg-surface-4 text-gray-300">
                      {PROVIDER_LABEL[m.provider] ?? m.provider}
                    </span>
                    <span className="font-mono text-gray-200">{m.model}</span>
                  </td>
                  <td className="py-2 px-3 text-right text-gray-300">
                    {m.window.tokens ? compact(m.window.tokens) : "—"}
                  </td>
                  <td className="py-2 px-3 text-right text-gray-400">
                    {compact(m.all_time.tokens)}
                  </td>
                  <td className="py-2 px-3 text-right text-emerald-300">
                    {pct(m.all_time.cache_hit)}
                  </td>
                  <td className="py-2 pl-3 text-right text-emerald-300">{usd(m.all_time.saved)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-gray-500">{t("savedHint")}</p>
    </section>
  );
}
