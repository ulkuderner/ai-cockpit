/**
 * @file RereadsCard.tsx
 * @description AI Cockpit token saving: files agents read again and again in the last week, ranked by the context tokens those repeats cost, with a hint on how to avoid them.
 * @author Caglar Ulkuderner
 */

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Repeat } from "lucide-react";
import { request } from "../lib/api";

interface Report {
  days: number;
  total_reads: number;
  repeated_files: number;
  repeat_tokens: number;
  files: Array<{
    file: string;
    reads: number;
    sessions: number;
    partial: number;
    file_tokens: number | null;
    repeat_tokens: number | null;
  }>;
}

export function RereadsCard() {
  const { t, i18n } = useTranslation("cockpit");
  const [data, setData] = useState<Report | null>(null);
  useEffect(() => {
    request<Report>("/rereads?days=7&limit=8")
      .then(setData)
      .catch(() => {});
  }, []);
  if (!data || data.files.length === 0) return null;
  const compact = (v: number) =>
    new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 }).format(
      v
    );
  const short = (p: string) => (p.length > 64 ? `…${p.slice(-63)}` : p);
  return (
    <section className="card p-5" aria-labelledby="rereads-title">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <Repeat className="w-4 h-4 text-amber-400" aria-hidden />
        <h2 id="rereads-title" className="text-sm font-semibold text-gray-200">
          {t("rereads.title")}
        </h2>
        <span className="ml-auto text-xs text-gray-500">
          {t("rereads.summary", {
            files: data.repeated_files,
            tokens: compact(data.repeat_tokens),
            days: data.days,
          })}
        </span>
      </div>
      <p className="text-xs text-gray-500 mb-4">{t("rereads.hint")}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-gray-500">
              <th scope="col" className="py-2 pr-3 font-medium">
                {t("rereads.file")}
              </th>
              <th scope="col" className="py-2 px-3 font-medium text-right">
                {t("rereads.reads")}
              </th>
              <th scope="col" className="py-2 px-3 font-medium text-right">
                {t("rereads.sessions")}
              </th>
              <th scope="col" className="py-2 pl-3 font-medium text-right">
                {t("rereads.tokens")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.files.map((f) => (
              <tr key={f.file}>
                <td className="py-2 pr-3 font-mono text-gray-200" title={f.file}>
                  {short(f.file)}
                </td>
                <td className="py-2 px-3 text-right text-gray-300">{f.reads}</td>
                <td className="py-2 px-3 text-right text-gray-400">{f.sessions}</td>
                <td className="py-2 pl-3 text-right text-amber-300">
                  {f.repeat_tokens == null ? "—" : compact(f.repeat_tokens)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
