import type { TierListSource } from './dto/exercise-query.dto';
import { TIERS, type Tier, type TierGoal, type Tiers } from './exercise.constants';

export interface TierListItem {
  name: string;
  tiers: Tiers;
  personalTiers: Tiers;
}

export interface TierListGroups<T> {
  tiers: Record<Tier, T[]>;
  unranked: T[];
}

/**
 * Groups exercises into S/A/B/C columns for one goal.
 * - `global`: the admin tier for that goal.
 * - `personal`: the user's personal tier FOR THAT GOAL wins when set, otherwise the global tier.
 * Exercises without a tier (custom ones, or unranked for that goal) go to `unranked`.
 * Each column is sorted by localized name (locale-aware: "Élévation" next to "Elevation").
 */
export function groupByTier<T extends TierListItem>(
  items: T[],
  goal: TierGoal,
  source: TierListSource,
  lang: string,
): TierListGroups<T> {
  const tiers = Object.fromEntries(TIERS.map((tier) => [tier, [] as T[]])) as Record<Tier, T[]>;
  const unranked: T[] = [];

  for (const item of items) {
    const tier =
      source === 'personal' ? (item.personalTiers[goal] ?? item.tiers[goal]) : item.tiers[goal];
    (tier ? tiers[tier] : unranked).push(item);
  }

  const collator = new Intl.Collator(lang, { sensitivity: 'base' });
  const byName = (a: T, b: T) => collator.compare(a.name, b.name);
  for (const tier of TIERS) tiers[tier].sort(byName);
  unranked.sort(byName);

  return { tiers, unranked };
}
