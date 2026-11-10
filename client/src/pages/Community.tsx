/**
 * @file Community.tsx
 * @description AI Cockpit community board: a shared task queue on GitHub, GitLab or a local git repo. Shows project progress, who claimed what and when, review state of PRs/MRs and recently finished tasks; lets the user claim the next task (assign + task branch + prefilled Run page), release it, and send it for review after previewing the exact commands. An in-page guide adapts to the chosen platform.
 * @author Caglar Ulkuderner
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  ExternalLink,
  Folder,
  FolderGit2,
  GitPullRequest,
  Hand,
  Play,
  RotateCcw,
  UserRound,
  Users,
} from "lucide-react";
import {
  cockpit,
  formatDuration,
  type CommunityBoard,
  type CommunityConfig,
  type CommunityPlanSyncPreview,
  type CommunityProvider,
  type CommunityTask,
} from "../lib/cockpit";

const STATE_STYLE: Record<CommunityTask["state"], string> = {
  open: "bg-accent-muted text-indigo-200 ring-indigo-400/20",
  mine: "bg-emerald-500/15 text-emerald-300 ring-emerald-400/30",
  taken: "bg-surface-5 text-gray-300 ring-white/5",
  review: "bg-amber-500/15 text-amber-300 ring-amber-400/30",
};

/** Readiness / staleness badges on a task row (mockup: rounded-full, 11px, ring). */
const BADGE = "rounded-full px-2 py-0.5 text-[11px] ring-1";
const READY_STYLE = "bg-emerald-500/10 text-emerald-300 ring-emerald-400/25";
const WAITING_STYLE = "bg-amber-500/10 text-amber-300 ring-amber-400/25";
const CONFLICT_STYLE = "bg-red-500/10 text-red-300 ring-red-400/25";
const STALE_STYLE = "bg-amber-500/15 text-amber-300 ring-amber-400/30";
const NO_AREA_STYLE = "bg-surface-4 text-gray-400 ring-white/5";

/** Area / dependency chips under a task title (mockup: rounded-md, mono, 11px). */
const CHIP =
  "inline-flex items-center rounded-md bg-surface-4 px-1.5 py-0.5 font-mono text-[11px] text-gray-300";
const CHIP_DEP =
  "inline-flex items-center rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-gray-400 ring-1 ring-border";
const CHIP_CONFLICT =
  "inline-flex items-center rounded-md bg-red-500/10 px-1.5 py-0.5 font-mono text-[11px] text-red-200 ring-1 ring-red-400/20";

/** Root of an area pattern (before the first wildcard, trailing slash dropped), mirroring the server's clash rule. */
function areaRoot(pattern: string): string {
  const cut = pattern.search(/[*?[]/);
  return (cut === -1 ? pattern : pattern.slice(0, cut)).replace(/\/+$/, "");
}

/** True when two area patterns overlap by the board's root rule (an empty root covers the whole repo). */
function patternsOverlap(x: string, y: string): boolean {
  const rx = areaRoot(x);
  const ry = areaRoot(y);
  return !rx || !ry || rx === ry || y.startsWith(rx + "/") || x.startsWith(ry + "/");
}

const PLATFORMS: CommunityProvider[] = ["github", "gitlab", "local"];

type Agent = "claude" | "codex" | "cursor";

function useRelative() {
  const { i18n } = useTranslation();
  return (iso: string | null) => {
    if (!iso) return "";
    const diff = (Date.parse(iso) - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
    const abs = Math.abs(diff);
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    return rtf.format(Math.round(diff / 86400), "day");
  };
}

function PlatformTabs({
  value,
  onChange,
  label,
}: {
  value: CommunityProvider;
  onChange: (p: CommunityProvider) => void;
  label: string;
}) {
  const { t } = useTranslation("cockpit");
  return (
    <div className="inline-flex rounded-lg bg-surface-2 p-1" role="tablist" aria-label={label}>
      {PLATFORMS.map((p) => (
        <button
          key={p}
          type="button"
          role="tab"
          aria-selected={value === p}
          onClick={() => onChange(p)}
          className={`px-3 py-1.5 rounded-md text-xs ${value === p ? "bg-surface-4 text-gray-100" : "text-gray-400 hover:text-gray-200"}`}
        >
          {t(`community.platform.${p}`)}
        </button>
      ))}
    </div>
  );
}

/** In-app guide with steps for the selected platform. Open by default until a repo is set. */
function HowTo({
  open,
  platform,
  onPlatform,
}: {
  open: boolean;
  platform: CommunityProvider;
  onPlatform: (p: CommunityProvider) => void;
}) {
  const { t } = useTranslation("cockpit");
  const steps = t(`community.help.${platform}`, { returnObjects: true }) as Array<{
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
      <div className="border-t border-border px-4 pt-4">
        <PlatformTabs value={platform} onChange={onPlatform} label={t("community.platformLabel")} />
      </div>
      <ol className="px-4 py-4 space-y-4">
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

/** Server-side folder browser (a browser file picker cannot reveal absolute paths). Home directory only. */
function DirPicker({
  start,
  onPick,
  onClose,
}: {
  start: string;
  onPick: (p: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("cockpit");
  const [view, setView] = useState<Awaited<ReturnType<typeof cockpit.communityDirs>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const open = useCallback((p?: string) => {
    cockpit.communityDirs(p).then(
      (v) => {
        setView(v);
        setErr(null);
      },
      (x: Error) => setErr(x.message)
    );
  }, []);
  useEffect(() => open(start || undefined), [open, start]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dir-title"
    >
      <div className="card w-full max-w-xl flex flex-col max-h-[80vh]">
        <div className="px-5 pt-5 pb-3 space-y-2">
          <h2 id="dir-title" className="text-base font-semibold text-gray-100">
            {t("community.pickFolder")}
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!view?.parent}
              onClick={() => view?.parent && open(view.parent)}
              aria-label={t("community.up")}
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-surface-5 disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-xs text-gray-300 truncate">{view?.path}</span>
            {view?.git && (
              <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300">
                git
              </span>
            )}
          </div>
        </div>
        <ul className="flex-1 overflow-y-auto border-y border-border divide-y divide-border">
          {view?.dirs.map((d) => (
            <li key={d.path}>
              <button
                type="button"
                onClick={() => open(d.path)}
                className="w-full flex items-center gap-2 px-5 py-2 text-left text-sm text-gray-200 hover:bg-surface-4"
              >
                {d.git ? (
                  <FolderGit2 className="w-4 h-4 text-emerald-400" aria-hidden />
                ) : (
                  <Folder className="w-4 h-4 text-gray-500" aria-hidden />
                )}
                <span className="truncate">{d.name}</span>
                {d.git && <span className="ml-auto text-[10px] text-emerald-300/80">git</span>}
              </button>
            </li>
          ))}
          {view && view.dirs.length === 0 && (
            <li className="px-5 py-3 text-xs text-gray-500">{t("community.noSubfolders")}</li>
          )}
        </ul>
        {err && (
          <p className="px-5 pt-3 text-xs text-red-400" role="alert">
            {err}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 p-4">
          {view && !view.git && (
            <span className="mr-auto text-xs text-amber-300/80">{t("community.notGit")}</span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-surface-4"
          >
            {t("community.cancel")}
          </button>
          <button
            type="button"
            disabled={!view}
            onClick={() => view && onPick(view.path)}
            className="rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {t("community.useFolder")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Repo members with their role, plus how many tasks each holds now and has finished recently. */
function Members({ board }: { board: CommunityBoard }) {
  const { t } = useTranslation("cockpit");
  const [data, setData] = useState<Awaited<ReturnType<typeof cockpit.communityMembers>> | null>(
    null
  );
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    cockpit.communityMembers().then(setData, (x: Error) => setErr(x.message));
  }, [board.provider]);
  const active = (login: string) => board.tasks.filter((x) => x.assignees.includes(login)).length;
  const finished = (login: string) => board.done.filter((d) => d.by.includes(login)).length;
  return (
    <section className="card overflow-hidden" aria-labelledby="members-title">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Users className="w-4 h-4 text-accent" aria-hidden />
        <h2 id="members-title" className="text-sm font-semibold text-gray-200">
          {t("community.members")}
        </h2>
        {data && <span className="text-xs text-gray-500 tabular-nums">{data.members.length}</span>}
      </div>
      {err && <p className="px-4 pb-4 text-xs text-red-400">{err}</p>}
      <ul className="divide-y divide-border border-t border-border">
        {data?.members.map((m) => (
          <li key={m.login} className="flex items-center gap-2 px-4 py-2.5">
            <UserRound className="w-4 h-4 text-gray-500 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gray-200 truncate">
                {m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer" className="hover:underline">
                    {m.name || m.login}
                  </a>
                ) : (
                  m.name || m.login
                )}
                {m.login === board.me && (
                  <span className="ml-1.5 text-[10px] text-gray-500">({t("community.you")})</span>
                )}
              </div>
              <div className="text-[11px] text-gray-500">
                {t("community.memberStats", { active: active(m.login), done: finished(m.login) })}
              </div>
            </div>
            {m.role && (
              <span className="rounded bg-surface-4 px-1.5 py-0.5 text-[10px] text-gray-300">
                {t(`community.role.${m.role}`, { defaultValue: m.role })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Setup({
  initial,
  platform,
  onPlatform,
  onSaved,
}: {
  initial: CommunityConfig | null;
  platform: CommunityProvider;
  onPlatform: (p: CommunityProvider) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation("cockpit");
  const [repo, setRepo] = useState(initial?.repo ?? "");
  const [localPath, setLocalPath] = useState(initial?.localPath ?? "");
  const [label, setLabel] = useState(initial?.label ?? "cockpit-task");
  const [host, setHost] = useState(initial?.host ?? "");
  // Required for the local board; optional (plan sync only) on GitHub/GitLab, so no default there.
  const [planFile, setPlanFile] = useState(
    initial?.planFile ?? (platform === "local" ? "docs/plan.md" : "")
  );
  const [staleHours, setStaleHours] = useState(String(initial?.staleHours ?? 4));
  const [worktrunk, setWorktrunk] = useState(initial?.worktrunk !== "off");
  const [worktrunkHooks, setWorktrunkHooks] = useState(!!initial?.worktrunkHooks);
  const [err, setErr] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const input =
    "w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-sm text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-accent";
  const field = (
    labelText: string,
    value: string,
    set: (v: string) => void,
    placeholder?: string
  ) => (
    <label className="block space-y-1.5">
      <span className="text-xs text-gray-400">{labelText}</span>
      <input
        className={input}
        value={value}
        onChange={(e) => set(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
  return (
    <form
      className="card p-5 space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await cockpit.communitySave(
            platform === "local"
              ? {
                  provider: platform,
                  localPath,
                  planFile,
                  staleHours: Number(staleHours),
                  worktrunk: worktrunk ? "auto" : "off",
                  worktrunkHooks,
                }
              : {
                  provider: platform,
                  repo,
                  localPath,
                  label,
                  ...(platform === "gitlab" && host ? { host } : {}),
                  ...(planFile ? { planFile } : {}),
                  staleHours: Number(staleHours),
                  worktrunk: worktrunk ? "auto" : "off",
                  worktrunkHooks,
                }
          );
          setErr(null);
          onSaved();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-[240px]">
          <h2 className="text-sm font-semibold text-gray-200">{t("community.setupTitle")}</h2>
          <p className="text-xs text-gray-500 mt-1">{t(`community.setupHint.${platform}`)}</p>
        </div>
        <PlatformTabs value={platform} onChange={onPlatform} label={t("community.platformLabel")} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {platform !== "local" &&
          field(
            t(`community.repo.${platform}`),
            repo,
            setRepo,
            platform === "gitlab" ? "group/project" : "owner/name"
          )}
        <label className="block space-y-1.5">
          <span className="text-xs text-gray-400">{t("community.localPath")}</span>
          <span className="flex gap-2">
            <input
              className={input}
              value={localPath}
              onChange={(e) => setLocalPath(e.target.value)}
              placeholder="/Users/…/repo"
            />
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 text-xs text-gray-200 hover:bg-surface-4"
            >
              <Folder className="w-3.5 h-3.5" aria-hidden />
              {t("community.browse")}
            </button>
          </span>
        </label>
        {platform === "local"
          ? field(t("community.planFile"), planFile, setPlanFile, "docs/plan.md")
          : field(t("community.label"), label, setLabel)}
        {platform === "gitlab" && field(t("community.host"), host, setHost, "gitlab.com")}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {platform !== "local" &&
          field(t("community.planFileHosted"), planFile, setPlanFile, "docs/plan.md")}
        <label className="block space-y-1.5">
          <span className="text-xs text-gray-400">{t("community.staleHoursLabel")}</span>
          <span className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={168}
              inputMode="numeric"
              value={staleHours}
              onChange={(e) => setStaleHours(e.target.value)}
              className="w-20 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-gray-100 tabular-nums"
            />
            <span className="text-xs text-gray-400">{t("community.staleHoursUnit")}</span>
          </span>
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs text-gray-400">{t("community.worktrunkLegend")}</legend>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={worktrunk}
            onChange={(e) => setWorktrunk(e.target.checked)}
            className="accent-indigo-500"
          />
          {t("community.worktrunkUse")}
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-200">
          <input
            type="checkbox"
            checked={worktrunkHooks}
            onChange={(e) => setWorktrunkHooks(e.target.checked)}
            className="accent-indigo-500 mt-1"
          />
          <span>
            {t("community.worktrunkHooks")}
            <span className="block text-xs text-amber-300/80">
              {t("community.worktrunkHooksWarn")}
            </span>
          </span>
        </label>
      </fieldset>
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
      {picking && (
        <DirPicker
          start={localPath}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setLocalPath(p);
            setPicking(false);
          }}
        />
      )}
    </form>
  );
}

function ReviewDialog({
  task,
  reviewName,
  onClose,
  onDone,
}: {
  task: CommunityTask;
  reviewName: string;
  onClose: () => void;
  onDone: (url: string | null) => void;
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
  const quote = (a: string) => (/^[\w./:@=-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-title"
    >
      <div className="card w-full max-w-2xl p-5 space-y-4">
        <h2 id="review-title" className="text-base font-semibold text-gray-100">
          {t("community.reviewTitle", { name: reviewName, n: task.number })}
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
            {busy ? t("community.sending") : t("community.sendReview", { name: reviewName })}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Escape closes a dialog (WAI-ARIA modal dialog pattern). */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

/** Release with a handover note: the exact comment is previewed from the API before anything is written; the branch and worktree are kept. */
function ReleaseDialog({
  task,
  onClose,
  onDone,
}: {
  task: CommunityTask;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("cockpit");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  // The note the shown preview was made for: confirm only writes what the user has seen.
  const [previewFor, setPreviewFor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEscape(onClose);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      cockpit.communityReleasePreview(task.number, note).then(
        (r) => {
          if (!alive) return;
          setPreview(r.comment);
          setPreviewFor(note);
          setErr(null);
        },
        (x: Error) => {
          if (alive) setErr(x.message);
        }
      );
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [task.number, note]);
  const previewReady = preview !== null && previewFor === note && !err;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="release-dialog-title"
    >
      <div className="card w-full max-w-xl p-5 space-y-4">
        <div>
          <h2 id="release-dialog-title" className="text-sm font-semibold text-gray-100">
            {t("community.releaseTitle", { n: task.number })}
          </h2>
          <p className="mt-1 text-xs text-gray-400">{t("community.releaseBody")}</p>
        </div>
        <label className="block">
          <span className="text-xs text-gray-400">{t("community.releaseNoteLabel")}</span>
          <textarea
            autoFocus
            rows={3}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <span className="mt-1 block text-right text-[11px] text-gray-500 tabular-nums">
            {t("community.noteCounter", { n: note.length })}
          </span>
        </label>
        <div>
          <div className="text-xs text-gray-400 mb-1">{t("community.releaseCommentTitle")}</div>
          <pre className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[11px] font-mono text-gray-300 whitespace-pre-wrap">
            {preview ?? ""}
          </pre>
        </div>
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
          {!previewReady && !err && (
            <span id="release-wait" className="mr-auto self-center text-[11px] text-gray-500">
              {t("community.releaseWaitPreview")}
            </span>
          )}
          <button
            disabled={busy || !previewReady}
            aria-describedby={previewReady ? undefined : "release-wait"}
            onClick={async () => {
              setBusy(true);
              try {
                await cockpit.communityRelease(task.number, note);
                onDone();
              } catch (x) {
                setErr((x as Error).message);
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
          >
            {busy ? t("community.sending") : t("community.releaseConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** "Planı tahtaya aç": preview what would be created and updated, run only on confirm; a missing plan file offers the settings field inline. */
function PlanSyncDialog({
  cfg,
  onClose,
  onDone,
  onSynced,
}: {
  cfg: CommunityConfig;
  onClose: () => void;
  onDone: () => void;
  /** Reload the board while the dialog stays open to show what was skipped. */
  onSynced: () => void;
}) {
  const { t } = useTranslation("cockpit");
  // After a sync that skipped issues the preview is stale: only "close" remains.
  const [synced, setSynced] = useState(false);
  useEscape(onClose);
  const [preview, setPreview] = useState<CommunityPlanSyncPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [planFile, setPlanFile] = useState(cfg.planFile ?? "");
  const [busy, setBusy] = useState(false);

  const fetchPreview = useCallback(() => {
    setBusy(true);
    cockpit.communityPlanSyncPreview().then(
      (p) => {
        setPreview(p);
        setErr(null);
        setBusy(false);
      },
      (x: Error) => {
        setErr(x.message);
        setBusy(false);
      }
    );
  }, []);

  useEffect(() => {
    if (cfg.planFile) fetchPreview();
  }, [cfg.planFile, fetchPreview]);

  const saveAndPreview = async () => {
    setBusy(true);
    setErr(null);
    try {
      await cockpit.communitySave({ ...cfg, planFile: planFile.trim() });
      fetchPreview();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="plansync-dialog-title"
    >
      <div className="card w-full max-w-xl p-5 space-y-4">
        <h2 id="plansync-dialog-title" className="text-sm font-semibold text-gray-100">
          {t("community.planSync")}
        </h2>
        {preview ? (
          <>
            <p className="font-mono text-[11px] text-gray-400">
              {t("community.planSyncPath", { file: planFile, repo: cfg.repo ?? "" })}
            </p>
            <div>
              <div className="text-xs text-gray-400 mb-1.5">
                {t("community.planSyncCreate", { count: preview.create.length })}
              </div>
              <ul className="space-y-1 text-sm">
                {preview.create.map((s) => (
                  <li key={s.id} className="flex gap-2">
                    <span className="text-emerald-300">+</span>
                    <span className="text-gray-200">
                      {s.id}: {s.title}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-xs text-gray-400 mb-1.5">
                {t("community.planSyncUpdate", { count: preview.update.length })}
              </div>
              <ul className="space-y-1 text-sm">
                {preview.update.map((s) => (
                  <li key={s.id} className="flex gap-2">
                    <span className="text-indigo-300">~</span>
                    <span className="text-gray-200">
                      {s.id}: {s.title}
                    </span>
                    <span className="text-gray-500 tabular-nums">#{s.number}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-gray-500">{t("community.planSyncNote")}</p>
            {preview.update.length > 0 && (
              <p className="text-xs text-amber-300/80">{t("community.planSyncOverwrite")}</p>
            )}
          </>
        ) : (
          <>
            <p className={`text-xs ${err ? "text-red-400" : "text-amber-300/80"}`}>
              {err ?? t("community.planSyncNoPlanFile")}
            </p>
            <label className="block space-y-1.5">
              <span className="text-xs text-gray-400">{t("community.planSyncFileLabel")}</span>
              <input
                value={planFile}
                onChange={(e) => setPlanFile(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:ring-2 focus:ring-accent"
              />
            </label>
          </>
        )}
        {preview && err && (
          <p className="text-xs text-red-400" role="alert">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            autoFocus
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-gray-300 hover:bg-surface-4"
          >
            {synced ? t("community.close") : t("community.cancel")}
          </button>
          {synced ? null : preview ? (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await cockpit.communityPlanSync();
                  // Markers on issues without the board label were left alone: say which.
                  if (r.skipped?.length) {
                    setErr(
                      t("community.planSyncSkipped", {
                        list: r.skipped.map((n) => `#${n}`).join(", "),
                      })
                    );
                    setSynced(true);
                    onSynced();
                  } else onDone();
                } catch (x) {
                  setErr((x as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
            >
              {busy
                ? t("community.sending")
                : t("community.planSyncConfirm", {
                    count: preview.create.length + preview.update.length,
                  })}
            </button>
          ) : (
            <button
              disabled={busy}
              onClick={saveAndPreview}
              className="rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 px-4 py-2 text-sm font-medium text-white"
            >
              {t("community.planSyncSaveAndPreview")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Community() {
  const { t, i18n } = useTranslation("cockpit");
  const navigate = useNavigate();
  const rel = useRelative();
  const [cfg, setCfg] = useState<CommunityConfig | null | undefined>(undefined);
  const [platform, setPlatform] = useState<CommunityProvider>("github");
  const [board, setBoard] = useState<CommunityBoard | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [reviewFor, setReviewFor] = useState<CommunityTask | null>(null);
  const [releaseFor, setReleaseFor] = useState<CommunityTask | null>(null);
  const [planSyncOpen, setPlanSyncOpen] = useState(false);
  const [claimed, setClaimed] = useState<{
    number: number;
    title: string;
    branch: string;
    cwd: string;
    prompt: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [agent, setAgent] = useState<Agent>("claude");

  const load = useCallback(async () => {
    const c = await cockpit.communityConfig();
    setCfg(c);
    if (!c) return;
    setPlatform(c.provider);
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

  /** Fresh claim: keep the user here and show the worktree/brief panel; the agent is started from it. */
  const claimTask = (task: CommunityTask) =>
    act(task.number, async () => {
      const r = await cockpit.communityClaim(task.number);
      setClaimed({
        number: task.number,
        title: task.title,
        branch: r.branch,
        cwd: r.cwd,
        prompt: r.prompt,
      });
    });

  /** Continue a task already mine: reopen its worktree/brief and jump straight to Run. */
  const continueTask = (task: CommunityTask) =>
    act(task.number, async () => {
      const r = await cockpit.communityClaim(task.number);
      const qs = new URLSearchParams({ prompt: r.prompt, cwd: r.cwd, provider: agent });
      navigate(`/run?${qs.toString()}`);
    });

  const runClaimed = () => {
    if (!claimed) return;
    const qs = new URLSearchParams({ prompt: claimed.prompt, cwd: claimed.cwd, provider: agent });
    navigate(`/run?${qs.toString()}`);
  };

  const dur = (ms: number | null) => formatDuration(ms, t("h"), t("m"));
  const reviewName =
    board?.review_name === "merge" ? t("community.merge") : (board?.review_name ?? "PR");
  const groups: Array<[CommunityTask["state"], string]> = [
    ["mine", t("community.mine")],
    ["review", t("community.review", { name: reviewName })],
    ["taken", t("community.taken")],
    ["open", t("community.open")],
  ];
  const pct = board?.progress.ratio == null ? null : Math.round(board.progress.ratio * 100);
  const reviewState = (task: CommunityTask) =>
    task.pr?.draft
      ? t("community.reviewState.draft")
      : t(`community.reviewState.${task.pr?.review ?? "WAITING"}`);
  const iconBtn =
    "p-1.5 rounded-md text-gray-400 hover:text-gray-100 hover:bg-surface-5 disabled:opacity-40";

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
            <span className="rounded bg-surface-4 px-1.5 py-0.5">
              {t(`community.platform.${cfg.provider}`)}
            </span>
            {cfg.repo ? (
              <a
                href={`https://${cfg.provider === "gitlab" ? cfg.host || "gitlab.com" : "github.com"}/${cfg.repo}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono hover:text-gray-200"
              >
                {cfg.repo} <ExternalLink className="w-3 h-3" aria-hidden />
              </a>
            ) : (
              <span className="font-mono truncate max-w-[280px]">{cfg.localPath}</span>
            )}
            <button
              onClick={() => setEditing((v) => !v)}
              className="underline-offset-2 hover:underline"
            >
              {t("community.change")}
            </button>
          </div>
        )}
      </header>

      {cfg !== undefined && (
        <HowTo open={cfg === null} platform={platform} onPlatform={setPlatform} />
      )}

      {(cfg === null || editing) && (
        <Setup
          initial={cfg ?? null}
          platform={platform}
          onPlatform={setPlatform}
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
          {claimed && (
            <section className="card p-5 space-y-3 max-w-2xl" aria-labelledby="claimed-title">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-0.5 text-xs ring-1 ${STATE_STYLE.mine}`}>
                  {t("community.state.mine")}
                </span>
                <span className="text-sm text-gray-100">
                  #{claimed.number} {claimed.title}
                </span>
                <h2 id="claimed-title" className="sr-only">
                  {t("community.claimedPanelTitle")}
                </h2>
              </div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-gray-500">{t("community.claimPanelCwd")}</dt>
                <dd className="font-mono text-gray-300 break-all">{claimed.cwd}</dd>
                <dt className="text-gray-500">{t("community.claimPanelBranch")}</dt>
                <dd className="font-mono text-gray-300">{claimed.branch}</dd>
                <dt className="text-gray-500">{t("community.claimPanelBrief")}</dt>
                <dd className="text-emerald-300">
                  {t("community.claimPanelBriefReady")}{" "}
                  <span className="text-gray-500">{t("community.claimPanelBriefDetail")}</span>
                </dd>
              </dl>
              <p className="text-xs text-gray-500">{t("community.claimPanelNote")}</p>
              <div className="flex gap-2">
                <button
                  onClick={runClaimed}
                  className="rounded-lg bg-accent hover:bg-accent-hover px-4 py-2 text-sm font-medium text-white"
                >
                  {t("community.startAgent")}
                </button>
                <button
                  onClick={() => void navigator.clipboard?.writeText(claimed.cwd)}
                  className="rounded-lg border border-border px-4 py-2 text-sm text-gray-200 hover:bg-surface-4"
                >
                  {t("community.openFolder")}
                </button>
              </div>
            </section>
          )}

          <div className="card p-5">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <span className="text-xs uppercase tracking-wider text-gray-500">
                {t("community.progress")}
              </span>
              <span className="text-xs text-gray-400 tabular-nums">
                {t("community.progressOf", {
                  done: board.progress.done,
                  total: board.progress.total,
                })}
              </span>
            </div>
            <div
              className="h-2 rounded-full bg-surface-5 overflow-hidden mb-5"
              role="progressbar"
              aria-valuenow={pct ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={t("community.progress")}
            >
              <div
                className="h-full bg-emerald-400 rounded-full transition-[width] duration-700"
                style={{ width: `${pct ?? 0}%` }}
              />
            </div>
            <dl className="grid grid-cols-2 lg:grid-cols-6 gap-5">
              <div>
                <dt className="text-xs uppercase tracking-wider text-gray-500">
                  {t("community.done")}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-emerald-300 tabular-nums">
                  {pct == null
                    ? "—"
                    : new Intl.NumberFormat(i18n.language, { style: "percent" }).format(pct / 100)}
                </dd>
                <dd className="text-xs text-gray-500">{board.progress.done}</dd>
              </div>
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
                  {t("community.ready")}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-gray-100 tabular-nums">
                  {board.totals.ready}
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
                  {t("community.review", { name: reviewName })}
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-amber-300 tabular-nums">
                  {board.totals.review}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-gray-400">
              <span>{t("community.agent")}</span>
              {(["claude", "codex", "cursor"] as Agent[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setAgent(p)}
                  aria-pressed={agent === p}
                  className={`rounded-full px-2.5 py-1 ${agent === p ? "bg-accent/20 text-accent" : "hover:text-gray-200"}`}
                >
                  {p === "claude" ? "Claude Code" : p === "codex" ? "Codex" : "Cursor"}
                </button>
              ))}
              {board.provider !== "local" && (
                <button
                  onClick={() => setPlanSyncOpen(true)}
                  className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-gray-200 hover:bg-surface-4"
                >
                  {t("community.planSync")}
                </button>
              )}
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6 min-w-0">
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
                      {items.map((task) => {
                        const conflictingAreas = task.conflicts_with
                          .map((n) => board.tasks.find((x) => x.number === n))
                          .flatMap((x) => (x ? x.area : []));
                        const holder = (n: number) =>
                          board.tasks.find((x) => x.number === n)?.assignees[0];
                        const conflictWho = task.conflicts_with
                          .map((n) => (holder(n) ? `#${n} (${holder(n)})` : `#${n}`))
                          .join(", ");
                        return (
                          <li
                            key={task.number}
                            className={`flex items-center gap-3 px-4 py-3 ${task.stale ? "bg-amber-500/[0.03]" : ""}`}
                          >
                            {task.url ? (
                              <a
                                href={task.url}
                                target="_blank"
                                rel="noreferrer"
                                className="w-12 shrink-0 font-mono text-xs text-gray-500 hover:text-gray-200"
                              >
                                #{task.number}
                              </a>
                            ) : (
                              <span className="w-12 shrink-0 font-mono text-xs text-gray-500">
                                #{task.number}
                              </span>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-sm font-medium text-gray-100 truncate">
                                  {task.title}
                                </span>
                                {task.state === "open" && task.ready && (
                                  <span className={`shrink-0 ${BADGE} ${READY_STYLE}`}>
                                    {t("community.ready")}
                                  </span>
                                )}
                                {task.state === "open" && task.blocked_by.length > 0 && (
                                  <span className={`shrink-0 ${BADGE} ${WAITING_STYLE}`}>
                                    {t("community.waiting", {
                                      deps: task.blocked_by.map((n) => `#${n}`).join(", "),
                                    })}
                                  </span>
                                )}
                                {task.state === "open" && task.conflicts_with.length > 0 && (
                                  <span className={`shrink-0 ${BADGE} ${CONFLICT_STYLE}`}>
                                    {t("community.conflict", { who: conflictWho })}
                                  </span>
                                )}
                                {task.state === "open" && task.area.length === 0 && (
                                  <span
                                    className={`shrink-0 ${BADGE} ${NO_AREA_STYLE}`}
                                    title={t("community.noAreaTitle")}
                                  >
                                    {t("community.noArea")}
                                  </span>
                                )}
                                {(task.state === "mine" || task.state === "taken") &&
                                  task.stale && (
                                    <span className={`shrink-0 ${BADGE} ${STALE_STYLE}`}>
                                      {t("community.staleBadge", {
                                        when: task.last_activity_at
                                          ? rel(task.last_activity_at)
                                          : "",
                                      })}
                                    </span>
                                  )}
                              </div>
                              {(task.area.length > 0 || task.deps.length > 0) && (
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                  {task.area.map((a) => {
                                    const clash = conflictingAreas.some((y) =>
                                      patternsOverlap(a, y)
                                    );
                                    return (
                                      <span
                                        key={a}
                                        className={clash ? CHIP_CONFLICT : CHIP}
                                        title={
                                          clash && task.conflicts_with.length
                                            ? t("community.conflictAreaTitle", {
                                                n: task.conflicts_with[0],
                                              })
                                            : undefined
                                        }
                                      >
                                        {a}
                                      </span>
                                    );
                                  })}
                                  {task.deps.length > 0 && (
                                    <span className={CHIP_DEP}>
                                      {t("community.depsChip", {
                                        deps: task.deps.map((n) => `#${n}`).join(", "),
                                      })}
                                    </span>
                                  )}
                                </div>
                              )}
                              <div className="text-xs text-gray-500 truncate">
                                {task.assignees.length > 0 &&
                                  t("community.claimedBy", {
                                    who: `@${task.assignees.join(", @")}`,
                                    when: task.claimed_at
                                      ? rel(task.claimed_at)
                                      : rel(task.updated_at),
                                  })}
                                {(task.state === "mine" || task.state === "taken") &&
                                  task.last_activity_at &&
                                  ` · ${t("community.lastActivity", { when: rel(task.last_activity_at) })}`}
                                {task.dirty && (
                                  <span className="text-amber-300/80">
                                    {" · "}
                                    {t("community.dirty")}
                                  </span>
                                )}
                                {task.state === "open" &&
                                  (task.acceptance.length > 0
                                    ? t("community.acceptanceCount", {
                                        count: task.acceptance.length,
                                      })
                                    : t("community.acceptanceNone"))}
                                {task.state === "open" &&
                                  task.updated_at &&
                                  ` · ${t("community.addedAgo", { when: rel(task.updated_at) })}`}
                                {task.pr && (
                                  <>
                                    {" · "}
                                    {task.pr.url ? (
                                      <a
                                        href={task.pr.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-amber-300/80 hover:underline"
                                      >
                                        {reviewName} #{task.pr.number}
                                      </a>
                                    ) : (
                                      `${reviewName} #${task.pr.number}`
                                    )}
                                    {` · ${reviewState(task)}`}
                                    {task.pr.created_at && ` · ${rel(task.pr.created_at)}`}
                                  </>
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
                                <div className="flex flex-col items-end gap-1">
                                  <button
                                    disabled={busy !== null || !task.ready}
                                    aria-describedby={
                                      !task.ready ? `why-${task.number}` : undefined
                                    }
                                    onClick={() => claimTask(task)}
                                    className="inline-flex items-center gap-1.5 rounded-lg bg-accent hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-medium text-white"
                                  >
                                    <Hand className="w-3.5 h-3.5" aria-hidden />
                                    {busy === task.number
                                      ? t("community.claiming")
                                      : t("community.claim")}
                                  </button>
                                  {!task.ready && (
                                    <span
                                      id={`why-${task.number}`}
                                      className={`text-[11px] ${task.blocked_by.length ? "text-amber-300/80" : "text-red-300/80"}`}
                                    >
                                      {task.blocked_by.length
                                        ? t("community.claimBlockedReason", {
                                            deps: task.blocked_by.map((n) => `#${n}`).join(", "),
                                          })
                                        : t("community.claimConflictReason", {
                                            n: `#${task.conflicts_with[0]}`,
                                          })}
                                    </span>
                                  )}
                                </div>
                              )}
                              {task.state === "mine" && (
                                <>
                                  <button
                                    disabled={busy !== null}
                                    onClick={() => continueTask(task)}
                                    title={t("community.continue")}
                                    aria-label={t("community.continue")}
                                    className={iconBtn}
                                  >
                                    <Play className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setReviewFor(task)}
                                    title={t("community.sendReview", { name: reviewName })}
                                    aria-label={t("community.sendReview", { name: reviewName })}
                                    className={iconBtn}
                                  >
                                    <GitPullRequest className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => setReleaseFor(task)}
                                    title={t("community.release")}
                                    aria-label={t("community.release")}
                                    className={iconBtn}
                                  >
                                    <RotateCcw className="w-4 h-4" />
                                  </button>
                                </>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
              {board.tasks.length === 0 && (
                <div className="card p-6 text-sm text-gray-500">{t("community.empty")}</div>
              )}
            </div>

            <div className="space-y-6 self-start">
              <Members board={board} />
              <aside className="card overflow-hidden" aria-labelledby="done-title">
                <div className="flex items-center gap-2 px-4 pt-4 pb-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden />
                  <h2 id="done-title" className="text-sm font-semibold text-gray-200">
                    {t("community.recentDone")}
                  </h2>
                </div>
                {board.done.length === 0 ? (
                  <p className="px-4 pb-4 text-xs text-gray-500">{t("community.noneDone")}</p>
                ) : (
                  <ul className="divide-y divide-border border-t border-border">
                    {board.done.map((d) => (
                      <li key={d.number} className="px-4 py-2.5">
                        <div className="text-sm text-gray-200 truncate">
                          {d.url ? (
                            <a
                              href={d.url}
                              target="_blank"
                              rel="noreferrer"
                              className="hover:underline"
                            >
                              #{d.number} {d.title}
                            </a>
                          ) : (
                            `#${d.number} ${d.title}`
                          )}
                        </div>
                        <div className="text-xs text-gray-500">
                          {d.by.length ? `@${d.by.join(", @")} · ` : ""}
                          {rel(d.at)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </aside>
            </div>
          </div>
        </>
      )}

      {reviewFor && board && (
        <ReviewDialog
          task={reviewFor}
          reviewName={reviewName}
          onClose={() => setReviewFor(null)}
          onDone={(url) => {
            setReviewFor(null);
            if (url) window.open(url, "_blank", "noopener,noreferrer");
            load();
          }}
        />
      )}

      {releaseFor && (
        <ReleaseDialog
          task={releaseFor}
          onClose={() => setReleaseFor(null)}
          onDone={() => {
            setReleaseFor(null);
            load();
          }}
        />
      )}

      {planSyncOpen && cfg && (
        <PlanSyncDialog
          cfg={cfg}
          onClose={() => setPlanSyncOpen(false)}
          onDone={() => {
            setPlanSyncOpen(false);
            load();
          }}
          onSynced={load}
        />
      )}
    </div>
  );
}
