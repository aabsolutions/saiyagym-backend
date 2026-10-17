import { Injectable } from '@nestjs/common';
import {
  isWorkingSet,
  type DeloadConfig,
  type DoubleProgressionRule,
  type PercentOf1RMRule,
  type ProgressionRule,
  type SetType,
  type TargetSet,
} from '../../../common/constants/training';
import { epley1RM, roundToStep } from '../../../common/utils/one-rep-max.util';
import type { ExercisePerformance } from './workout-history.provider';

export const DEFAULT_INCREMENT_KG = { compound: 2.5, isolation: 1 } as const;

export interface ProgressionInput {
  /** The routine's prescription for this exercise. */
  targets: TargetSet[];
  /** Per-exercise rule (Premium). `null` = static prescription. */
  rule: ProgressionRule | null;
  mechanic: 'compound' | 'isolation';
  /** Past sessions of this exercise, most recent first. */
  history: ExercisePerformance[];
  /** 0-based program week. */
  weekIndex: number;
  /** Effective deload config when THIS week is a deload week; `null` otherwise. */
  deload: DeloadConfig | null;
  /** Training max set by the user for this exercise, if any (wins over estimates). */
  trainingMaxKg: number | null;
  /** Whether the user's plan includes `autoProgression`. */
  progressionEnabled: boolean;
}

export interface PlannedSet {
  type: SetType;
  repsMin: number;
  repsMax: number;
  weightKg: number | null;
  restSeconds: number;
}

export type ProgressionNoteCode =
  | 'PERCENT_OF_MAX'
  | 'NO_REFERENCE_MAX'
  | 'PROGRESSION_DISABLED'
  | 'NO_HISTORY'
  | 'INCREASE'
  | 'HOLD'
  | 'WEEK_PERCENT'
  | 'DELOAD_WEIGHT'
  | 'DELOAD_SETS';

/** Machine-readable explanation of what was applied; clients render/translate them. */
export interface ProgressionNote {
  code: ProgressionNoteCode;
  params?: Record<string, number | string>;
}

export interface ProgressionResult {
  sets: PlannedSet[];
  notes: ProgressionNote[];
  /** The max used for %-based weights and where it came from. */
  referenceMax: { kg: number; source: 'training_max' | 'estimated' } | null;
}

/**
 * Pure calculation of the next session's targets — no I/O, deterministic, unit-tested.
 *
 * Pipeline:
 *  1. Static prescription: `weightKg` as written; `percent1RM` resolved against the reference
 *     max (training max, else best Epley e1RM in history). Applies to every plan.
 *  2. If the plan has autoProgression and the exercise has a rule:
 *       - double_progression: per set position, last session's weight; +increment when EVERY
 *         working set reached the top of its range (never on a deload week).
 *       - percent_1rm: the week's % of the reference max (+ optional reps/sets override).
 *  3. Deload week (autoProgression only): −Y % weight, or −Y % working sets (min 1).
 */
@Injectable()
export class ProgressionService {
  compute(input: ProgressionInput): ProgressionResult {
    const notes: ProgressionNote[] = [];
    const rounding = this.roundingFor(input);
    const referenceMax = this.referenceMax(input);

    let sets = this.staticPrescription(input.targets, referenceMax?.kg ?? null, rounding, notes);

    if (!input.progressionEnabled) {
      if (input.rule) notes.push({ code: 'PROGRESSION_DISABLED' });
      return { sets, notes: dedupe(notes), referenceMax };
    }

    if (input.rule?.type === 'double_progression') {
      sets = this.doubleProgression(sets, input, input.rule, notes);
    } else if (input.rule?.type === 'percent_1rm') {
      sets = this.percentOfMax(sets, input, input.rule, referenceMax?.kg ?? null, rounding, notes);
    }

    const deload = input.rule?.deload ?? input.deload;
    if (input.deload && deload) sets = this.applyDeload(sets, deload, rounding, notes);

    return { sets, notes: dedupe(notes), referenceMax };
  }

  /** Best Epley e1RM across the given sessions (working, completed sets with 1–12 reps). */
  bestEstimated1RM(history: ExercisePerformance[]): number | null {
    let best: number | null = null;
    for (const session of history) {
      for (const set of session.sets) {
        if (!set.completed || !isWorkingSet(set.type)) continue;
        const e1rm = epley1RM(set.weightKg, set.reps);
        if (e1rm !== null && (best === null || e1rm > best)) best = e1rm;
      }
    }
    return best === null ? null : Math.round(best * 10) / 10;
  }

  // ----- steps -----

  private staticPrescription(
    targets: TargetSet[],
    maxKg: number | null,
    rounding: number,
    notes: ProgressionNote[],
  ): PlannedSet[] {
    return targets.map((target) => {
      let weightKg = target.weightKg;
      if (target.percent1RM !== null) {
        if (maxKg === null) {
          weightKg = null;
          notes.push({ code: 'NO_REFERENCE_MAX' });
        } else {
          weightKg = roundToStep((maxKg * target.percent1RM) / 100, rounding);
          notes.push({ code: 'PERCENT_OF_MAX' });
        }
      }
      return {
        type: target.type,
        repsMin: target.repsMin,
        repsMax: target.repsMax,
        weightKg,
        restSeconds: target.restSeconds,
      };
    });
  }

  private doubleProgression(
    sets: PlannedSet[],
    input: ProgressionInput,
    rule: DoubleProgressionRule,
    notes: ProgressionNote[],
  ): PlannedSet[] {
    const performed = (input.history[0]?.sets ?? []).filter(
      (set) => set.completed && isWorkingSet(set.type) && set.weightKg !== null,
    );
    if (!performed.length) {
      notes.push({ code: 'NO_HISTORY' });
      return sets;
    }

    const working = sets.filter((set) => isWorkingSet(set.type));
    const rangeCompleted =
      performed.length >= working.length &&
      working.every((target, i) => performed[i]!.reps >= target.repsMax);
    const increase = rangeCompleted && !input.deload;
    const incrementKg = rule.incrementKg ?? DEFAULT_INCREMENT_KG[input.mechanic];

    let position = 0;
    const next = sets.map((set) => {
      if (!isWorkingSet(set.type)) return set; // warmups keep their prescription
      // Fewer sets last time than planned now → reuse the last weight performed.
      const previous = performed[Math.min(position++, performed.length - 1)]!;
      const weightKg = previous.weightKg! + (increase ? incrementKg : 0);
      return { ...set, weightKg: round3(weightKg) };
    });

    notes.push(increase ? { code: 'INCREASE', params: { incrementKg } } : { code: 'HOLD' });
    return next;
  }

  private percentOfMax(
    sets: PlannedSet[],
    input: ProgressionInput,
    rule: PercentOf1RMRule,
    maxKg: number | null,
    rounding: number,
    notes: ProgressionNote[],
  ): PlannedSet[] {
    const week = rule.weeks[input.weekIndex % rule.weeks.length]!;
    notes.push({ code: 'WEEK_PERCENT', params: { percent: week.percent } });
    if (maxKg === null) notes.push({ code: 'NO_REFERENCE_MAX' });

    const weightKg = maxKg === null ? null : roundToStep((maxKg * week.percent) / 100, rounding);
    const warmups = sets.filter((set) => !isWorkingSet(set.type));
    let working = sets
      .filter((set) => isWorkingSet(set.type))
      .map((set) => ({
        ...set,
        weightKg,
        ...(week.reps ? { repsMin: week.reps, repsMax: week.reps } : {}),
      }));

    if (week.sets && working.length) {
      const template = working[working.length - 1]!;
      working =
        week.sets <= working.length
          ? working.slice(0, week.sets)
          : [
              ...working,
              ...Array.from({ length: week.sets - working.length }, () => ({ ...template })),
            ];
    }
    return [...warmups, ...working];
  }

  private applyDeload(
    sets: PlannedSet[],
    deload: DeloadConfig,
    rounding: number,
    notes: ProgressionNote[],
  ): PlannedSet[] {
    const factor = 1 - deload.percent / 100;

    if (deload.mode === 'weight') {
      notes.push({ code: 'DELOAD_WEIGHT', params: { percent: deload.percent } });
      return sets.map((set) =>
        isWorkingSet(set.type) && set.weightKg !== null
          ? { ...set, weightKg: roundToStep(set.weightKg * factor, rounding) }
          : set,
      );
    }

    notes.push({ code: 'DELOAD_SETS', params: { percent: deload.percent } });
    const workingCount = sets.filter((set) => isWorkingSet(set.type)).length;
    const keep = Math.max(1, Math.round(workingCount * factor));
    let kept = 0;
    return sets.filter((set) => !isWorkingSet(set.type) || kept++ < keep);
  }

  // ----- helpers -----

  private referenceMax(input: ProgressionInput): ProgressionResult['referenceMax'] {
    if (input.trainingMaxKg !== null && input.trainingMaxKg > 0) {
      return { kg: input.trainingMaxKg, source: 'training_max' };
    }
    const needsMax =
      input.rule?.type === 'percent_1rm' || input.targets.some((t) => t.percent1RM !== null);
    if (!needsMax) return null;
    const estimated = this.bestEstimated1RM(input.history);
    return estimated === null ? null : { kg: estimated, source: 'estimated' };
  }

  /** Plate math: 2.5 kg for compounds, 1 kg for isolation, unless the rule says otherwise. */
  private roundingFor(input: ProgressionInput): number {
    return input.rule?.roundingKg ?? DEFAULT_INCREMENT_KG[input.mechanic];
  }
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function dedupe(notes: ProgressionNote[]): ProgressionNote[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = `${note.code}:${JSON.stringify(note.params ?? {})}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
}
