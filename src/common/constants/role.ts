export const Role = {
  USER: 'user',
  ADMIN: 'admin',
  /** Reserved for a future coaching feature. Assignable, but grants nothing yet. */
  COACH: 'coach',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const ROLES = Object.values(Role);
