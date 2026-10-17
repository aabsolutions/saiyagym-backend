import type { Translatable } from '../../common/utils/translatable.util';
import type { Entitlements } from './plan-entitlements';

export interface PlanSeed {
  code: string;
  name: Translatable;
  description: Translatable;
  entitlements: Entitlements;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * Initial values from SPEC ("valores iniciales, configurables"). Seeded with $setOnInsert:
 * once a plan exists, admin edits win and these values are never re-applied.
 */
export const DEFAULT_PLANS: PlanSeed[] = [
  {
    code: 'free',
    name: { es: 'Gratis', en: 'Free' },
    description: {
      es: 'Lo esencial para planificar y registrar tus entrenamientos.',
      en: 'The essentials to plan and log your workouts.',
    },
    isDefault: true,
    sortOrder: 0,
    entitlements: {
      limits: { routines: 3, activePrograms: 1, customExercises: 10 },
      statsHistoryDays: 90,
      features: {
        progressPhotos: false,
        autoProgression: false,
        fullStats: false,
        fullNutrition: false,
        dataExport: false,
      },
    },
  },
  {
    code: 'premium',
    name: { es: 'Premium', en: 'Premium' },
    description: {
      es: 'Sin límites: progresión automática, estadísticas completas, fotos de progreso y más.',
      en: 'No limits: automatic progression, full stats, progress photos and more.',
    },
    isDefault: false,
    sortOrder: 1,
    entitlements: {
      limits: { routines: null, activePrograms: null, customExercises: null },
      statsHistoryDays: null,
      features: {
        progressPhotos: true,
        autoProgression: true,
        fullStats: true,
        fullNutrition: true,
        dataExport: true,
      },
    },
  },
];
