const DAY_MS = 86_400_000;

export interface StatsWindow {
  /** Inclusive lower bound actually applied (null = from the beginning). */
  from: Date | null;
  /** Exclusive upper bound. */
  to: Date;
  /** True when the plan cut the requested range (Free: last `statsHistoryDays` days). */
  limitedByPlan: boolean;
}

/**
 * Applies the plan's history limit SERVER-SIDE (SPEC: "aplicado en servidor"): whatever `from`
 * the client asks for, data older than `historyDays` is never read. `null` = unlimited.
 */
export function statsWindow(
  now: Date,
  historyDays: number | null,
  requestedFrom?: Date,
  requestedTo?: Date,
): StatsWindow {
  const to = requestedTo && requestedTo < now ? requestedTo : now;
  if (historyDays === null) return { from: requestedFrom ?? null, to, limitedByPlan: false };

  const earliest = new Date(now.getTime() - historyDays * DAY_MS);
  const limited = !requestedFrom || requestedFrom < earliest;
  return { from: limited ? earliest : requestedFrom, to, limitedByPlan: limited };
}
