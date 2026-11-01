/**
 * @file cockpit.ts
 * @description AI Cockpit REST client: plan view (`server/routes/plan.js`) and usage limits (`/api/limits`).
 * @author Caglar Ulkuderner
 */

import { request } from "./api";

export type TaskStatus = "todo" | "running" | "done" | "blocked";

export interface PlanTask {
  id: string;
  title: string;
  status: TaskStatus;
  running: string[];
  spent_ms: number;
  remaining_ms: number | null;
}

export interface Plan {
  id: string;
  name: string;
  file: string;
  error?: string;
  phases: Array<{ title: string; tasks: PlanTask[] }>;
  queue: string[];
  typical_task_ms: number | null;
  totals?: {
    tasks: number;
    done: number;
    running: number;
    blocked: number;
    remaining_ms: number | null;
  };
}

export interface LimitWindow {
  used_percent: number;
  resets_at: number;
}

export interface ProviderLimits {
  five_hour: LimitWindow | null;
  seven_day: LimitWindow | null;
  updated_at?: string | number | null;
}

export interface LimitsPayload {
  claude: ProviderLimits | null;
  codex: ProviderLimits | null;
}

const json = (body: unknown) => ({ body: JSON.stringify(body) });

export const cockpit = {
  plans: () => request<{ plans: Plan[] }>("/plan"),
  savePlans: (plans: Array<{ id?: string; name?: string; file: string }>) =>
    request<{ plans: Plan[] }>("/plan/config", { method: "PUT", ...json({ plans }) }),
  setStatus: (planId: string, taskId: string, status: "todo" | "done" | "blocked") =>
    request(`/plan/${encodeURIComponent(planId)}/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      ...json({ status }),
    }),
  setOrder: (planId: string, order: string[]) =>
    request(`/plan/${encodeURIComponent(planId)}/order`, { method: "PUT", ...json({ order }) }),
  limits: () => request<LimitsPayload>("/limits"),
};

/** "3 sa 20 dk" style duration; null → "—". */
export function formatDuration(ms: number | null, h: string, m: string): string {
  if (ms == null) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} ${m}`;
  const hrs = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `${hrs} ${h} ${rest} ${m}` : `${hrs} ${h}`;
}
