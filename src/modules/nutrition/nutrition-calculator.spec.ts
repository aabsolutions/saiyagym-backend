import {
  ageInYears,
  calculateNutrition,
  mifflinStJeor,
  resolveCalculatorInput,
  type CalculatorInput,
  type StoredProfile,
} from './nutrition-calculator';

const MALE: CalculatorInput = {
  sex: 'male',
  ageYears: 30,
  heightCm: 180,
  weightKg: 80,
  activityLevel: 'moderate',
  goal: 'maintenance',
};

describe('mifflinStJeor', () => {
  it('male: 10·kg + 6.25·cm − 5·age + 5', () => {
    expect(mifflinStJeor(MALE)).toBe(1780); // 800 + 1125 − 150 + 5
  });

  it('female: same base − 161', () => {
    expect(mifflinStJeor({ sex: 'female', ageYears: 25, heightCm: 165, weightKg: 60 })).toBe(
      1345.25, // 600 + 1031.25 − 125 − 161
    );
  });
});

describe('calculateNutrition', () => {
  it('maintenance: TDEE = BMR × activity factor, 1.8 g/kg protein, 30 % fat, carbs fill the rest', () => {
    expect(calculateNutrition(MALE)).toEqual({
      bmrKcal: 1780,
      tdeeKcal: 2759, // 1780 × 1.55
      targetKcal: 2759,
      clampedToBmr: false,
      macros: {
        proteinG: 144, // 80 × 1.8
        fatG: 92, // 2759 × 0.30 / 9
        carbsG: 339, // (2759 − 144·4 − 92·9) / 4
        proteinPercent: 21,
        carbsPercent: 49,
        fatPercent: 30,
      },
    });
  });

  it('bulk: +10 % kcal, 25 % fat', () => {
    const result = calculateNutrition({ ...MALE, goal: 'bulk' });
    expect(result.targetKcal).toBe(3035); // 2759 × 1.1
    expect(result.macros).toMatchObject({ proteinG: 144, fatG: 84, carbsG: 426 });
  });

  it('cut: −20 % kcal and more protein (2.2 g/kg)', () => {
    const result = calculateNutrition({ ...MALE, goal: 'cut' });
    expect(result.targetKcal).toBe(2207); // 2759 × 0.8
    expect(result.macros).toMatchObject({ proteinG: 176, fatG: 61, carbsG: 239 });
    expect(result.clampedToBmr).toBe(false);
  });

  it('macro grams add up to the target (± rounding)', () => {
    for (const goal of ['bulk', 'cut', 'maintenance'] as const) {
      const { targetKcal, macros } = calculateNutrition({ ...MALE, goal });
      const kcal = macros.proteinG * 4 + macros.carbsG * 4 + macros.fatG * 9;
      expect(Math.abs(kcal - targetKcal)).toBeLessThanOrEqual(10);
    }
  });

  it.each([
    ['sedentary', 1.2],
    ['light', 1.375],
    ['moderate', 1.55],
    ['active', 1.725],
    ['very_active', 1.9],
  ] as const)('activity %s multiplies the BMR by %d', (activityLevel, factor) => {
    expect(calculateNutrition({ ...MALE, activityLevel }).tdeeKcal).toBe(Math.round(1780 * factor));
  });

  it('never targets below the BMR: a deep cut on a sedentary profile is clamped', () => {
    const result = calculateNutrition({
      sex: 'female',
      ageYears: 25,
      heightCm: 165,
      weightKg: 60,
      activityLevel: 'sedentary',
      goal: 'cut', // 1345.25 × 1.2 × 0.8 = 1291 < BMR
    });
    expect(result.clampedToBmr).toBe(true);
    expect(result.targetKcal).toBe(1345);
    expect(result.bmrKcal).toBe(1345);
  });

  it('carbs never go negative', () => {
    const result = calculateNutrition({
      sex: 'female',
      ageYears: 100,
      heightCm: 120,
      weightKg: 250,
      activityLevel: 'sedentary',
      goal: 'cut',
    });
    expect(result.macros.carbsG).toBeGreaterThanOrEqual(0);
  });
});

describe('ageInYears', () => {
  const birth = new Date('2000-06-15T00:00:00Z');

  it('counts whole years, birthday included', () => {
    expect(ageInYears(birth, new Date('2026-06-14T23:59:59Z'))).toBe(25);
    expect(ageInYears(birth, new Date('2026-06-15T00:00:00Z'))).toBe(26);
    expect(ageInYears(birth, new Date('2026-12-01T00:00:00Z'))).toBe(26);
  });
});

describe('resolveCalculatorInput', () => {
  const today = new Date('2026-10-16T12:00:00Z');
  const goal = { activityLevel: 'light', goal: 'cut' } as const;
  const profile: StoredProfile = {
    sex: 'female',
    birthDate: new Date('1990-01-01T00:00:00Z'),
    heightCm: 168,
    weightKg: 64.5,
  };

  it('fills every gap from the profile and the latest body weight', () => {
    const resolved = resolveCalculatorInput(goal, profile, today);
    expect(resolved).toEqual({
      ok: true,
      input: { sex: 'female', ageYears: 36, heightCm: 168, weightKg: 64.5, ...goal },
      sources: {
        sex: 'profile',
        ageYears: 'profile',
        heightCm: 'profile',
        weightKg: 'body_metrics',
      },
    });
  });

  it('request values win over stored ones', () => {
    const resolved = resolveCalculatorInput(
      { ...goal, sex: 'male', weightKg: 70, ageYears: 40 },
      profile,
      today,
    );
    expect(resolved).toMatchObject({
      ok: true,
      input: { sex: 'male', weightKg: 70, ageYears: 40, heightCm: 168 },
      sources: { sex: 'request', weightKg: 'request', ageYears: 'request', heightCm: 'profile' },
    });
  });

  it('lists what is missing when neither request nor profile has it', () => {
    const empty: StoredProfile = { sex: null, birthDate: null, heightCm: null, weightKg: null };
    expect(resolveCalculatorInput({ ...goal, heightCm: 170 }, empty, today)).toEqual({
      ok: false,
      missing: ['sex', 'ageYears', 'weightKg'],
      outOfRange: [],
    });
  });

  it("the profile's `other` sex can't feed the formula: missing unless sent", () => {
    const other = { ...profile, sex: 'other' };
    expect(resolveCalculatorInput(goal, other, today)).toMatchObject({
      ok: false,
      missing: ['sex'],
    });
    expect(resolveCalculatorInput({ ...goal, sex: 'female' }, other, today)).toMatchObject({
      ok: true,
    });
  });

  it('stored values outside the formula bounds are reported, not used (minors, typos)', () => {
    const teen = { ...profile, birthDate: new Date('2010-01-01T00:00:00Z'), heightCm: 260 };
    expect(resolveCalculatorInput(goal, teen, today)).toEqual({
      ok: false,
      missing: [],
      outOfRange: ['ageYears', 'heightCm'],
    });
    // Sending valid values for the request overrides them.
    expect(
      resolveCalculatorInput({ ...goal, ageYears: 30, heightCm: 170 }, teen, today),
    ).toMatchObject({ ok: true });
  });
});
