import { loadSeedFile, validateSeedFile, type SeedFile } from './exercises.seeder';

describe('exercises seed file', () => {
  const seed = loadSeedFile();

  it('is valid: bilingual names, known enums and tags, unique slugs', () => {
    expect(validateSeedFile(seed)).toEqual([]);
  });

  it('covers the SPEC catalog (~120) including competition lifts and their accessories', () => {
    expect(seed.exercises.length).toBeGreaterThanOrEqual(120);
    const slugs = new Set(seed.exercises.map((e) => e.slug));
    for (const slug of [
      'barbell-back-squat',
      'barbell-bench-press',
      'conventional-deadlift',
      'sumo-deadlift',
      'paused-bench-press',
      'pin-press',
      'deficit-deadlift',
      'close-grip-bench-press',
    ]) {
      expect(slugs).toContain(slug);
    }
  });

  it('every exercise has bilingual execution steps, one per line, as translations', () => {
    for (const e of seed.exercises) {
      const es = (e.instructions?.es ?? '').split('\n').filter((s) => s.trim());
      const en = (e.instructions?.en ?? '').split('\n').filter((s) => s.trim());
      expect([e.slug, es.length >= 3]).toEqual([e.slug, true]);
      expect([e.slug, en.length]).toEqual([e.slug, es.length]);
    }
  });

  it('matches the SPEC tier examples', () => {
    const bySlug = new Map(seed.exercises.map((e) => [e.slug, e]));
    expect(bySlug.get('barbell-back-squat')!.tiers).toEqual({
      hypertrophy: 'S',
      powerlifting: 'S',
    });
    expect(bySlug.get('concentration-curl')!.tiers).toEqual({
      hypertrophy: 'B',
      powerlifting: 'C',
    });
  });

  it('only competition lifts are powerlifting_main', () => {
    for (const e of seed.exercises.filter((x) => x.category === 'powerlifting_main')) {
      expect(e.tags).toContain('competition');
      expect(e.tiers.powerlifting).toBe('S');
    }
  });

  it('reports structural problems instead of seeding garbage', () => {
    const broken: SeedFile = {
      tags: [{ slug: 'basic', name: { es: 'Básico', en: '' } }],
      exercises: [
        {
          ...seed.exercises[0]!,
          slug: 'Bad Slug',
          primaryMuscle: 'neck' as never,
          tags: ['nope'],
          tiers: { hypertrophy: 'X' as never, powerlifting: null },
          instructions: { es: 'Paso 1', en: '' },
        },
      ],
    };
    const errors = validateSeedFile(broken).join('\n');
    expect(errors).toMatch(/tag basic: name needs es and en/);
    expect(errors).toMatch(/instructions needs es and en/);
    expect(errors).toMatch(/invalid slug/);
    expect(errors).toMatch(/bad primaryMuscle neck/);
    expect(errors).toMatch(/unknown tag nope/);
    expect(errors).toMatch(/bad hypertrophy tier X/);
  });
});
