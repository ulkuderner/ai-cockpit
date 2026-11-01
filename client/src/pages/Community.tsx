/**
 * @file Community.tsx
 * @description AI Cockpit community board: the shared task queue on GitHub Issues. Shows open / mine / taken / in-review tasks with estimates, lets the user claim the next task (assign + local task branch + prefilled Run page), release it, and open a PR after previewing the exact commands.
 * @author Caglar Ulkuderner
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  CircleHelp,
  ExternalLink,
  GitPullRequest,
  Hand,
  Play,
  RotateCcw,
  Users,
} from "lucide-react";
import { cockpit, formatDuration, type CommunityBoard, type CommunityTask } from "../lib/cockpit";

const STATE_STYLE: Record<CommunityTask["state"], string> = {
  open: "bg-accent-muted text-indigo-200 ring-indigo-400/20",
  mine: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  taken: "bg-surface-5 text-gray-300 ring-white/5",
  review: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
};

type Provider = "claude" | "codex" | "cursor";

function Setup({
  onSaved,
  initial,
}: {
  onSaved: () => void;
  initial: { repo: string; localPath: string; label: string } | null;
}) {
  const { t } = useTranslation("cockpit");
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [localPath, setLocalPath] = useState(initial?.localPath ?? "");
  const [label, setLabel] = useState(initial?.label ?? "cockpit-task");
  const [err, setErr] = useState<string | null>(null);
  const input =
    "w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-accent";
  return (
    <form
      className="card p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await cockpit.communitySave({ repo, localPath, label });
          setErr(null);
          onSaved();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <div>
        <h2 className="text-sm font-semibold text-gray-200">{t("community.setupTitle")}</h2>
        <p className="text-xs text-gray-500 mt-1">{t("community.setupHint")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-xs text-gray-400">{t("community.repo")}</span>
          <input
            className={input}
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="owner/name"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-gray-400">{t("community.localPath")}</span>
          <input
            className={input}
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="/Users/…/repo"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-gray-400">{t("community.label")}</span>
          <input className={input} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      {err && (
        <p className="text-xs text-red-400" role="alert">
          {err}
        </p>
      )}
      <button
        type="submit"
        className="rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-medium text-white"
      >
        {t("community.save")}
      </button>
    </form>
  );
}

function PrDialog({
  task,
  onClose,
  onDone,
}: {
  task: CommunityTask;
  onClose: () => void;
  onDone: (url: string) => void;
}) {
  const { t } = useTranslation("cockpit");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof cockpit.communityPrPreview>
  > | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    cockpit.communityPrPreview(task.number).then(setPreview, (x: Error) => setErr(x.message));
  }, [task.number]);
  const quote = (a: string) => (/^[\w./:@-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pr-title"
    >
      <div className="card w-full max-w-2xl p-5 space-y-4">
        <h2 id="pr-title" className="text-base font-semibold text-gray-100">
          {t("community.prTitle", { n: task.number })}
        </h2>
        {preview && (
          <>
            <div>
              <div className="text-xs text-gray-400 mb-1">
                {t("community.prCommits", { count: preview.commits.length })}
              </div>
              <pre className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] font-mono text-gray-300 max-h-32 overflow-auto">
                {preview.commits.join("\n") || t("community.noCommits")}
              </pre>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1">{t("community.prCommands")}</div>
              <pre className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all">
                {preview.commands.map((c) => c.map(quote).join(" ")).join("\n")}
              </pre>
            </div>
          </>
        )}
        {err && (
          <p className="text-xs text-red-400" role="alert">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-surface-4"
          >
            {t("community.cancel")}
          </button>
          <button
            disabled={!preview || preview.commits.length === 0 || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const { url } = await cockpit.communityOpenPr(task.number);
                onDone(url);
              } catch (x) {
                setErr((x as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            <GitPullRequest className="w-4 h-4" aria-hidden />
            {busy ? t("community.sending") : t("community.sendPr")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** In-app guide: how a project owner and contributors use the shared queue. Open by default until a repo is set. */
function HowTo({ open }: { open: boolean }) {
  const { t } = useTranslation("cockpit");
  const steps = t("community.help.steps", { returnObjects: true }) as Array<{
    title: string;
    text: string;
    cmd?: string;
  }>;
  return (
    <details open={open} className="card overflow-hidden group">
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <CircleHelp className="w-4 h-4 text-accent" aria-hidden />
        <span className="text-sm font-semibold text-gray-200">{t("community.help.title")}</span>
        <span className="text-xs text-gray-500">{t("community.help.subtitle")}</span>
      </summary>
      <ol className="border-t border-border px-4 py-4 space-y-4">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-muted text-xs font-semibold text-indigo-200">
              {i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <div className="text-sm font-medium text-gray-100">{step.title}</div>
              <p className="text-xs text-gray-400 leading-relaxed">{step.text}</p>
              {step.cmd && (
                <pre className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-mono text-gray-300 whitespace-pre-wrap break-all">
                  {step.cmd}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

export default function Community() {
  const { t } = useTranslation("cockpit");
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<
    { repo: string; localPath: string; label: string } | null | undefined
  >(undefined);
  const [board, setBoard] = useState<CommunityBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [prFor, setPrFor] = useState<CommunityTask | null>(null);
  const [editing, setEditing] = useState(false);
  const [provider, setProvider] = useState<Provider>("claude");

  const load = useCallback(async () => {
    const c = await cockpit.communityConfig();
    setCfg(c);
    if (!c) return;
    try {
      setBoard(await cockpit.communityBoard());
      setErr(null);
    } catch (x) {
      setErr((x as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const act = async (n: number, fn: () => Promise<unknown>) => {
    setBusy(n);
    try {
      await fn();
      await load();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const claimAndRun = (task: CommunityTask) =>
    act(task.number, async () => {
      const r = await cockpit.communityClaim(task.number);
      const qs = new URLSearchParams({ prompt: r.prompt, cwd: r.cwd, provider });
      navigate(`/run?${qs.toString()}`);
    });

  const dur = (ms: number | null) => formatDuration(ms, t("h"), t("m"));
  const groups: Array<[CommunityTask["state"], string]> = [
    ["mine", t("community.mine")],
    ["open", t("community.open")],
    ["review", t("community.review")],
    ["taken", t("community.taken")],
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent-muted flex items-center justify-center">
            <Users className="w-5 h-5 text-accent" aria-hidden />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-100">{t("community.title")}</h1>
            <p className="text-sm text-gray-500">{t("community.subtitle")}</p>
          </div>
        </div>
        {cfg && (
          <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
            <a
              href={`https://github.com/${cfg.repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono hover:text-gray-200"
            >
              {cfg.repo} <ExternalLink className="w-3 h-3" aria-hidden />
            </a>
            <button
              onClick={() => setEditing((v) => !v)}
              className="underline-offset-2 hover:underline"
            >
              {t("community.change")}
            </button>
          </div>
        )}
      </header>

      {cfg !== undefined && <HowTo open={cfg === null} />}

      {(cfg === null || editing) && (
        <Setup
          initial={cfg ?? null}
          onSaved={() => {
            setEditing(false);
            load();
          }}
        />
      )}

      {err && (
        <div className="card p-4 text-sm text-red-400" role="alert">
          {err}
        </div>
      )}

      {board && (
        <>
          <div className="card p-5">
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">
                  {t("community.open")}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-100 tabular-nums">
                  {board.totals.open}
                </dd>
                <dd className="text-xs text-gray-500">
                  {t("community.openTotal", { d: dur(board.totals.open_estimate_ms) })}
                  {board.totals.open_unestimated > 0 &&
                    ` · ${t("community.unestimated", { count: board.totals.open_unestimated })}`}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">
                  {t("community.mine")}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-emerald-300 tabular-nums">
                  {board.totals.mine}
                </dd>
                <dd className="text-xs text-gray-500">@{board.me}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">
                  {t("community.taken")}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-100 tabular-nums">
                  {board.totals.taken}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">
                  {t("community.review")}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-amber-300 tabular-nums">
                  {board.totals.review}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span>{t("community.agent")}</span>
              {(["claude", "codex", "cursor"] as Provider[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setProvider(p)}
                  aria-pressed={provider === p}
                  className={`rounded-full px-2.5 py-1 ${provider === p ? "bg-accent/20 text-accent" : "hover:text-gray-200"}`}
                >
                  {p === "claude" ? "Claude Code" : p === "codex" ? "Codex" : "Cursor"}
                </button>
              ))}
            </div>
          </div>

          {groups.map(([state, title]) => {
            const items = board.tasks.filter((x) => x.state === state);
            if (items.length === 0) return null;
            return (
              <section key={state} className="card overflow-hidden" aria-label={title}>
                <div className="px-4 pt-4 pb-3 flex items-baseline gap-3">
                  <h2 className="text-sm font-semibold text-gray-200">{title}</h2>
                  <span className="text-xs text-gray-500 tabular-nums">{items.length}</span>
                </div>
                <ul className="divide-y divide-border border-t border-border">
                  {items.map((task) => (
                    <li key={task.number} className="flex items-center gap-3 px-4 py-3">
                      <a
                        href={task.url}
                        target="_blank"
                        rel="noreferrer"
                        className="w-12 shrink-0 font-mono text-xs text-gray-500 hover:text-gray-200"
                      >
                        #{task.number}
                      </a>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-gray-100 truncate">{task.title}</div>
                        <div className="text-xs text-gray-500 truncate">
                          {task.assignees.length > 0 && `@${task.assignees.join(", @")}`}
                          {task.pr && (
                            <a
                              href={task.pr.url}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 text-amber-300/80 hover:underline"
                            >
                              PR #{task.pr.number}
                            </a>
                          )}
                        </div>
                      </div>
                      <span className="hidden sm:block w-20 text-right text-xs text-gray-500 tabular-nums">
                        {task.estimate_ms != null ? `~${dur(task.estimate_ms)}` : ""}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${STATE_STYLE[task.state]}`}
                      >
                        {t(`community.state.${task.state}`)}
                      </span>
                      <div className="flex gap-1">
                        {task.state === "open" && (
                          <button
                            disabled={busy !== null}
                            onClick={() => claimAndRun(task)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-3 py-1.5 text-xs font-medium text-white"
                          >
                            <Hand className="w-3.5 h-3.5" aria-hidden />
                            {busy === task.number ? t("community.claiming") : t("community.claim")}
                          </button>
                        )}
                        {task.state === "mine" && (
                          <>
                            <button
                              disabled={busy !== null}
                              onClick={() => claimAndRun(task)}
                              title={t("community.continue")}
                              aria-label={t("community.continue")}
                              className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-surface-5"
                            >
                              <Play className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => setPrFor(task)}
                              title={t("community.sendPr")}
                              aria-label={t("community.sendPr")}
                              className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-surface-5"
                            >
                              <GitPullRequest className="w-4 h-4" />
                            </button>
                            <button
                              disabled={busy !== null}
                              onClick={() =>
                                act(task.number, () => cockpit.communityRelease(task.number))
                              }
                              title={t("community.release")}
                              aria-label={t("community.release")}
                              className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-surface-5"
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
          {board.tasks.length === 0 && (
            <div className="card p-6 text-sm text-gray-500">{t("community.empty")}</div>
          )}
        </>
      )}

      {prFor && (
        <PrDialog
          task={prFor}
          onClose={() => setPrFor(null)}
          onDone={(url) => {
            setPrFor(null);
            window.open(url, "_blank", "noopener,noreferrer");
            load();
          }}
        />
      )}
    </div>
  );
}
