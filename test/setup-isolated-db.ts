import { randomUUID } from 'node:crypto';

/**
 * Runs before EACH e2e test file (jest `setupFiles`), before the file imports AppModule.
 * Every file gets its own database on the shared in-memory server, so files running in
 * parallel never see each other's data (seeded catalogs, user counts, plan limits…).
 */
const base = process.env.E2E_MONGO_BASE_URI;
if (!base) throw new Error('E2E_MONGO_BASE_URI not set — is test/global-setup.ts configured?');
process.env.MONGODB_URI = `${base.replace(/\/?$/, '/')}e2e-${randomUUID()}`;
