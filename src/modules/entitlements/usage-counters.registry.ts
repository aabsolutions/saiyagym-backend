import { Injectable } from '@nestjs/common';
import type { LimitKey } from '../plans/plan-entitlements';

/** Returns how many units of a limited resource the user currently has (excluding soft-deleted). */
export type UsageCounter = (userId: string) => Promise<number>;

/**
 * Domain modules own their data, so they register how to count it. Example (future RoutinesModule):
 *
 *   onModuleInit() {
 *     this.counters.register('routines', (userId) =>
 *       this.routines.countDocuments(notDeleted({ userId })));
 *   }
 *
 * Keeps EntitlementsModule free of imports from every domain module.
 */
@Injectable()
export class UsageCountersRegistry {
  private readonly counters = new Map<LimitKey, UsageCounter>();

  register(key: LimitKey, counter: UsageCounter): void {
    if (this.counters.has(key)) throw new Error(`Usage counter "${key}" registered twice`);
    this.counters.set(key, counter);
  }

  /** Fails closed: a limit with no counter is a wiring bug, never "unlimited". */
  async count(key: LimitKey, userId: string): Promise<number> {
    const counter = this.counters.get(key);
    if (!counter) throw new Error(`No usage counter registered for limit "${key}"`);
    return counter(userId);
  }
}
