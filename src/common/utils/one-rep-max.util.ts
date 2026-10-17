/** SPEC: Epley, only valid for 1–12 reps (beyond that the estimate is unreliable). */
export const E1RM_MIN_REPS = 1;
export const E1RM_MAX_REPS = 12;

/** Estimated 1RM (Epley): weight × (1 + reps / 30). `null` outside 1–12 reps or without weight. */
export function epley1RM(weightKg: number | null, reps: number): number | null {
  if (weightKg === null || weightKg <= 0) return null;
  if (!Number.isInteger(reps) || reps < E1RM_MIN_REPS || reps > E1RM_MAX_REPS) return null;
  return reps === 1 ? weightKg : weightKg * (1 + reps / 30);
}

/** Rounds to the nearest multiple of `step` (e.g. 2.5 kg plates), avoiding float noise. */
export function roundToStep(value: number, step: number): number {
  if (step <= 0) return value;
  return Math.round(Math.round(value / step) * step * 1000) / 1000;
}
