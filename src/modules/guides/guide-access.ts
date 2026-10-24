/**
 * Pure rules for which exercises' execution guides a plan unlocks (no I/O).
 * `limit` = the plan's `guidesPerRoutine`; `null` = unlimited.
 */

/**
 * The first `limit` DISTINCT exercises of `ordered` that have guides. Exercises without guides
 * don't use up the quota, and a repeated exercise counts once.
 */
export function firstGuided(
  ordered: readonly string[],
  guided: ReadonlySet<string>,
  limit: number | null,
): string[] {
  const picked: string[] = [];
  for (const id of ordered) {
    if (limit !== null && picked.length >= limit) break;
    if (guided.has(id) && !picked.includes(id)) picked.push(id);
  }
  return picked;
}

/** Union over the user's routines of each routine's `firstGuided`. */
export function unlockedByRoutines(
  routines: readonly (readonly string[])[],
  guided: ReadonlySet<string>,
  limit: number | null,
): Set<string> {
  if (limit === null) return new Set(guided);
  const unlocked = new Set<string>();
  for (const routine of routines) {
    for (const id of firstGuided(routine, guided, limit)) unlocked.add(id);
  }
  return unlocked;
}
