/**
 * @file Plan.tsx
 * @description AI Cockpit plan view: phases and tasks parsed from a plan Markdown file, live "running" detection from agents, manual done/blocked marks, an ordered queue of upcoming work with estimates, and usage limits.
 * @author Caglar Ulkuderner
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  ChevronRight,
  ListOrdered,
  Plus,
  RotateCcw,
  Target,
} from "lucide-react";
import {
  cockpit,
  formatDuration,
  type Plan as PlanData,
  type PlanTask,
  type TaskStatus,
} from "../lib/cockpit";
import { eventBus } from "../lib/eventBus";
import { LimitsCard } from "../components/LimitsCard";

const STATUS_STYLE: Record<TaskStatus, string> = {
  running: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  done: "bg-surface-5 text-gray-400 ring-white/5",
  blocked: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
  todo: "bg-accent-muted text-indigo-200 ring-indigo-400/20",
};

function StatusPill({ status }: { status: TaskStatus }) {
  const { t } = useTranslation("cockpit");
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ring-1 ${STATUS_STYLE[status]}`}
    >
      {status === "running" && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
      )}
      {t(`status.${status}`)}
    </span>
  );
}

function Summary({ plan }: { plan: PlanData }) {
  const { t, i18n } = useTranslation("cockpit");
  const tot = plan.totals!;
  const pct = tot.tasks ? Math.round((tot.done / tot.tasks) * 100) : 0;
  const dur = (ms: number | null) => formatDuration(ms, t("h"), t("m"));
  const finish =
    tot.remaining_ms == null
      ? null
      : new Date(Date.now() + tot.remaining_ms).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "long",
        });
  const items = [
    {
      label: t("progress"),
      value: new Intl.NumberFormat(i18n.language, { style: "percent" }).format(pct / 100),
      sub: t("doneOf", { done: tot.done, total: tot.tasks }),
    },
    {
      label: t("runningNow"),
      value: String(tot.running),
      sub: tot.blocked ? t("blockedCount", { count: tot.blocked }) : " ",
    },
    { label: t("remainingWork"), value: dur(tot.remaining_ms), sub: t("estimate") },
    {
      label: t("estimatedFinish"),
      value: finish ?? "—",
      sub: plan.typical_task_ms
        ? t("typicalTask", { d: dur(plan.typical_task_ms) })
        : t("noHistory"),
    },
  ];
  return (
    <div className="card p-5">
      <div
        className="h-1.5 rounded-full bg-surface-5 overflow-hidden mb-5"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("progress")}
      >
        <div
          className="h-full bg-accent rounded-full transition-[width] duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-xs uppercase tracking-wider text-gray-500">{it.label}</dt>
            <dd className="mt-1 text-2xl font-semibold text-gray-100 tabular-nums">{it.value}</dd>
            <dd className="text-xs text-gray-500 mt-0.5">{it.sub}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function TaskRow({
  task,
  onStatus,
}: {
  task: PlanTask;
  onStatus: (s: "todo" | "done" | "blocked") => void;
}) {
  const { t } = useTranslation("cockpit");
  const dur = (ms: number | null) => formatDuration(ms, t("h"), t("m"));
  const btn =
    "p-1.5 rounded-md text-gray-500 hover:text-gray-100 hover:bg-surface-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <li
      className={`flex items-center gap-3 px-4 py-3 ${task.status === "done" ? "opacity-60" : ""}`}
    >
      <span className="w-12 shrink-0 font-mono text-xs text-gray-500">{task.id}</span>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm truncate ${task.status === "done" ? "line-through text-gray-500" : "text-gray-100"}`}
        >
          {task.title}
        </div>
        {task.running.length > 0 && (
          <div className="text-xs text-emerald-300/80 truncate">{task.running.join(" · ")}</div>
        )}
      </div>
      <div className="hidden sm:block w-28 text-right text-xs text-gray-500 tabular-nums">
        {task.spent_ms > 0 && <div>{t("spent", { d: dur(task.spent_ms) })}</div>}
        {task.status !== "done" && task.remaining_ms != null && (
          <div>{t("left", { d: dur(task.remaining_ms) })}</div>
        )}
      </div>
      <StatusPill status={task.status} />
      <div className="flex">
        {task.status !== "done" && (
          <button
            className={btn}
            onClick={() => onStatus("done")}
            title={t("markDone")}
            aria-label={t("markDone")}
          >
            <Check className="w-4 h-4" />
          </button>
        )}
        {task.status !== "blocked" && task.status !== "done" && (
          <button
            className={btn}
            onClick={() => onStatus("blocked")}
            title={t("markBlocked")}
            aria-label={t("markBlocked")}
          >
            <Ban className="w-4 h-4" />
          </button>
        )}
        {(task.status === "done" || task.status === "blocked") && (
          <button
            className={btn}
            onClick={() => onStatus("todo")}
            title={t("reset")}
            aria-label={t("reset")}
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>
    </li>
  );
}

function Queue({ plan, onMove }: { plan: PlanData; onMove: (order: string[]) => void }) {
  const { t } = useTranslation("cockpit");
  const byId = useMemo(
    () => new Map(plan.phases.flatMap((p) => p.tasks).map((x) => [x.id, x])),
    [plan]
  );
  const q = plan.queue;
  const move = (i: number, d: number) => {
    const next = [...q];
    [next[i], next[i + d]] = [next[i + d]!, next[i]!];
    onMove(next);
  };
  let acc = 0;
  return (
    <section className="card" aria-labelledby="queue-title">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <ListOrdered className="w-4 h-4 text-accent" aria-hidden />
        <h2 id="queue-title" className="text-sm font-semibold text-gray-200">
          {t("queue")}
        </h2>
        <span className="ml-auto text-xs text-gray-400 tabular-nums">
          {t("queueTotal", {
            count: q.length,
            d: formatDuration(plan.totals?.remaining_ms ?? null, t("h"), t("m")),
          })}
        </span>
      </div>
      <ol className="divide-y divide-border">
        {q.slice(0, 12).map((id, i) => {
          const task = byId.get(id)!;
          if (task.remaining_ms != null && task.status !== "blocked") acc += task.remaining_ms;
          return (
            <li key={id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-5 text-xs text-gray-600 tabular-nums">{i + 1}</span>
              <span className="w-10 font-mono text-xs text-gray-500">{id}</span>
              <span className="flex-1 min-w-0 text-sm text-gray-200 truncate">{task.title}</span>
              <span className="hidden md:block text-xs text-gray-500 tabular-nums w-20 text-right">
                {task.status === "blocked"
                  ? t("status.blocked")
                  : task.remaining_ms == null
                    ? "—"
                    : `+${formatDuration(acc, t("h"), t("m"))}`}
              </span>
              <span className="flex">
                <button
                  className="p-1 text-gray-600 hover:text-gray-200 disabled:opacity-20"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={t("moveUp")}
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  className="p-1 text-gray-600 hover:text-gray-200 disabled:opacity-20"
                  disabled={i === q.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={t("moveDown")}
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      {q.length > 12 && (
        <p className="px-4 py-3 text-xs text-gray-500">
          {t("moreInQueue", { count: q.length - 12 })}
        </p>
      )}
    </section>
  );
}

function AddPlan({ existing, onSaved }: { existing: PlanData[]; onSaved: () => void }) {
  const { t } = useTranslation("cockpit");
  const [file, setFile] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await cockpit.savePlans([
        ...existing.map(({ id, name, file }) => ({ id, name, file })),
        { file: file.trim() },
      ]);
      setFile("");
      setErr(null);
      onSaved();
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <form onSubmit={submit} className="card p-5 space-y-3">
      <label htmlFor="plan-file" className="block text-sm font-medium text-gray-200">
        {t("addPlan")}
      </label>
      <p className="text-xs text-gray-500">{t("addPlanHint")}</p>
      <div className="flex gap-2">
        <input
          id="plan-file"
          value={file}
          onChange={(e) => setFile(e.target.value)}
          placeholder="/Users/…/docs/plans/plan.md"
          className="flex-1 min-w-0 bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={!file.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-3 py-2 text-sm font-medium text-white"
        >
          <Plus className="w-4 h-4" aria-hidden />
          {t("add")}
        </button>
      </div>
      {err && (
        <p className="text-xs text-red-400" role="alert">
          {err}
        </p>
      )}
    </form>
  );
}

export default function Plan() {
  const { t } = useTranslation("cockpit");
  const [plans, setPlans] = useState<PlanData[] | null>(null);
  const [active, setActive] = useState<string | null>(null);

  const load = useCallback(
    () =>
      cockpit
        .plans()
        .then((d) => setPlans(d.plans))
        .catch(() => setPlans([])),
    []
  );
  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    // Live sessions/agents change "running": refetch on server pushes, at most every 3 s.
    let pending: ReturnType<typeof setTimeout> | null = null;
    const off = eventBus.subscribe(() => {
      pending ??= setTimeout(() => {
        pending = null;
        load();
      }, 3000);
    });
    return () => {
      clearInterval(id);
      if (pending) clearTimeout(pending);
      off();
    };
  }, [load]);

  const plan = plans?.find((p) => p.id === active) ?? plans?.[0] ?? null;

  const setStatus = async (taskId: string, s: "todo" | "done" | "blocked") => {
    await cockpit.setStatus(plan!.id, taskId, s);
    load();
  };
  const setOrder = async (order: string[]) => {
    await cockpit.setOrder(plan!.id, order);
    load();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
            <Target className="w-5 h-5 text-accent" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">{t("planTitle")}</h1>
            <p className="text-sm text-gray-500">{t("planSubtitle")}</p>
          </div>
        </div>
        {plans && plans.length > 1 && (
          <div className="ml-auto flex rounded-lg bg-surface-2 p-1" role="tablist">
            {plans.map((p) => (
              <button
                key={p.id}
                role="tab"
                aria-selected={p.id === plan?.id}
                onClick={() => setActive(p.id)}
                className={`px-3 py-1.5 rounded-md text-sm ${p.id === plan?.id ? "bg-surface-4 text-gray-100" : "text-gray-400 hover:text-gray-200"}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
      </header>

      {plans && plans.length === 0 && <AddPlan existing={[]} onSaved={load} />}

      {plan?.error && (
        <div className="card p-5 text-sm text-red-400" role="alert">
          {plan.error}
        </div>
      )}

      {plan && !plan.error && (
        <>
          <Summary plan={plan} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-6 min-w-0">
              {plan.phases.map((ph) => {
                const done = ph.tasks.filter((x) => x.status === "done").length;
                return (
                  <details
                    key={ph.title}
                    open={done < ph.tasks.length}
                    className="card overflow-hidden group"
                  >
                    <summary className="flex items-baseline gap-3 px-4 pt-4 pb-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <ChevronRight
                        className="w-3.5 h-3.5 self-center text-gray-500 transition-transform group-open:rotate-90"
                        aria-hidden
                      />
                      <h2 className="text-sm font-semibold text-gray-200 truncate">
                        {ph.title || t("tasks")}
                      </h2>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {done}/{ph.tasks.length}
                      </span>
                    </summary>
                    <ul className="divide-y divide-border border-t border-border">
                      {ph.tasks.map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          onStatus={(s) => setStatus(task.id, s)}
                        />
                      ))}
                    </ul>
                  </details>
                );
              })}
            </div>
            <aside className="space-y-6">
              <LimitsCard />
              <Queue plan={plan} onMove={setOrder} />
              <AddPlan existing={plans!} onSaved={load} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
