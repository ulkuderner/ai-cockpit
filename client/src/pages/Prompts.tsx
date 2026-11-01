/**
 * @file Prompts.tsx
 * @description AI Cockpit "outgoing prompts": every prompt an orchestrating agent sent to another agent, i.e. Claude Code subagents (Agent tool) and agent CLIs started through Bash (cursor-agent, codex, gemini, claude -p), newest first, with target, model, session and the full prompt.
 * @author Caglar Ulkuderner
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { Send } from "lucide-react";
import { request } from "../lib/api";

interface Dispatch {
  id: number;
  session_id: string;
  session_name: string | null;
  cwd: string | null;
  at: string;
  kind: "subagent" | "cli";
  target: string;
  description: string | null;
  model: string | null;
  background: boolean;
  prompt: string;
}

const TARGET_STYLE: Record<string, string> = {
  "cursor-agent": "bg-sky-500/15 text-sky-300",
  codex: "bg-emerald-500/15 text-emerald-300",
  gemini: "bg-violet-500/15 text-violet-300",
  claude: "bg-amber-500/15 text-amber-300",
};

function label(d: Dispatch, t: (k: string) => string) {
  if (d.kind === "subagent") return `${t("prompts.subagent")} · ${d.target}`;
  return d.target === "cursor-agent"
    ? "Cursor"
    : d.target === "codex"
      ? "Codex"
      : d.target === "gemini"
        ? "Gemini"
        : "Claude -p";
}

function PromptCard({ d }: { d: Dispatch }) {
  const { t, i18n } = useTranslation("cockpit");
  const [open, setOpen] = useState(false);
  const lines = d.prompt.split("\n");
  const long = lines.length > 8 || d.prompt.length > 900;
  const shown = open || !long ? d.prompt : `${lines.slice(0, 8).join("\n").slice(0, 900)}…`;
  return (
    <li className="card p-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 ${TARGET_STYLE[d.target] ?? "bg-accent-muted text-indigo-200"}`}
        >
          {label(d, t)}
        </span>
        {d.model && (
          <span className="rounded bg-surface-4 px-1.5 py-0.5 font-mono text-gray-300">
            {d.model}
          </span>
        )}
        {d.background && <span className="text-gray-500">{t("prompts.background")}</span>}
        <span className="ml-auto text-gray-500 tabular-nums">
          {new Date(d.at).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" })}
        </span>
      </div>
      {d.description && <div className="text-sm font-medium text-gray-100">{d.description}</div>}
      <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs leading-relaxed text-gray-300 font-mono">
        {shown}
      </pre>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <Link
          to={`/sessions/${d.session_id}`}
          className="truncate hover:text-gray-200 hover:underline"
        >
          {d.session_name || d.session_id.slice(0, 8)}
        </Link>
        {d.cwd && <span className="truncate font-mono">{d.cwd}</span>}
        {long && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto shrink-0 text-accent hover:underline"
          >
            {open ? t("prompts.less") : t("prompts.more")}
          </button>
        )}
      </div>
    </li>
  );
}

export default function Prompts() {
  const { t } = useTranslation("cockpit");
  const [params] = useSearchParams();
  const session = params.get("session");
  const [items, setItems] = useState<Dispatch[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: "300", ...(session ? { session } : {}) });
    request<{ items: Dispatch[] }>(`/dispatches?${qs}`)
      .then((r) => setItems(r.items))
      .catch(() => setItems([]));
  }, [session]);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const filters = [
    ["all", t("prompts.all")],
    ["subagent", t("prompts.subagents")],
    ["cursor-agent", "Cursor"],
    ["codex", "Codex"],
    ["gemini", "Gemini"],
    ["claude", "Claude -p"],
  ] as const;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter(
      (d) =>
        (filter === "all" ||
          (filter === "subagent" ? d.kind === "subagent" : d.target === filter)) &&
        (!needle || `${d.prompt} ${d.description ?? ""} ${d.target}`.toLowerCase().includes(needle))
    );
  }, [items, filter, q]);

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
            <Send className="w-5 h-5 text-accent" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">{t("prompts.title")}</h1>
            <p className="text-sm text-gray-500">
              {session ? t("prompts.oneSession") : t("prompts.subtitle")}
            </p>
          </div>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {filters.map(([key, text]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-full px-3 py-1 text-xs ${filter === key ? "bg-accent/20 text-accent" : "bg-surface-3 text-gray-400 hover:text-gray-200"}`}
          >
            {text}
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("prompts.search")}
          aria-label={t("prompts.search")}
          className="ml-auto w-full sm:w-64 bg-surface-2 border border-border rounded-lg px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {items && shown.length === 0 && (
        <div className="card p-6 text-sm text-gray-500">{t("prompts.empty")}</div>
      )}
      <ul className="space-y-3">
        {shown.map((d) => (
          <PromptCard key={d.id} d={d} />
        ))}
      </ul>
    </div>
  );
}
