import { Injectable } from '@nestjs/common';

export type RestSoundAccess = 'free' | 'premium';

/** Resolves a live (not deleted) sound by id, or `null` when it does not exist. */
export type RestSoundLookup = (id: string) => Promise<{ access: RestSoundAccess } | null>;

/**
 * Users store the chosen rest sound but SoundsModule depends on users (through entitlements), so
 * UsersModule can't import it (a cycle). SoundsModule registers its lookup here instead (same
 * pattern as RoutineUsageRegistry). Nothing registered means "no sound exists": fails closed.
 */
@Injectable()
export class RestSoundRegistry {
  private lookup: RestSoundLookup | null = null;

  register(lookup: RestSoundLookup): void {
    this.lookup = lookup;
  }

  async find(id: string): Promise<{ access: RestSoundAccess } | null> {
    return this.lookup ? this.lookup(id) : null;
  }
}
