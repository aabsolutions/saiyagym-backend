import { Injectable } from '@nestjs/common';

/** Returns true when the routine can't be deleted because something depends on it. */
export type RoutineUsageCheck = (userId: string, routineId: string) => Promise<boolean>;

/**
 * Programs depend on routines, not the other way round. Instead of RoutinesModule importing
 * ProgramsModule (a cycle), dependents register a check here (same pattern as UsageCountersRegistry).
 */
@Injectable()
export class RoutineUsageRegistry {
  private readonly checks: RoutineUsageCheck[] = [];

  register(check: RoutineUsageCheck): void {
    this.checks.push(check);
  }

  async isInUse(userId: string, routineId: string): Promise<boolean> {
    for (const check of this.checks) if (await check(userId, routineId)) return true;
    return false;
  }
}
