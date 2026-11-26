import type { PlanUsage } from "./server-status";

export type Warned = { fiveHour?: string; week?: string }; // "<resetsAt>:<level>" already told
export type LimitWarning = { window: "fiveHour" | "week"; level: "warn" | "alert"; pct: number; resetsAt: number };

/**
 * Which plan-usage warnings to send now: once per window (per reset time) at warnAt (0.9),
 * and once more when the limit is reached.
 */
export function limitWarnings(u: PlanUsage, warned: Warned, warnAt = 0.9): { send: LimitWarning[]; warned: Warned } {
  const next: Warned = { ...warned };
  const send: LimitWarning[] = [];
  for (const window of ["fiveHour", "week"] as const) {
    const w = u[window];
    if (!w) continue;
    const level = w.utilization >= 1 ? "alert" : w.utilization >= warnAt ? "warn" : null;
    if (!level) continue;
    const mark = `${w.resetsAt}:${level}`;
    const prev = warned[window];
    if (prev === mark || (level === "warn" && prev === `${w.resetsAt}:alert`)) continue;
    next[window] = mark;
    send.push({ window, level, pct: Math.round(w.utilization * 100), resetsAt: w.resetsAt });
  }
  return { send, warned: next };
}
