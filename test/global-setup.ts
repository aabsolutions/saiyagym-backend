import { MongoMemoryServer } from 'mongodb-memory-server';

declare global {
  var __MONGO__: MongoMemoryServer | undefined;
}

/**
 * Starts ONE in-memory MongoDB server for the whole e2e run. process.env set here is inherited
 * by Jest workers; test/setup-isolated-db.ts then gives each test file its own database.
 */
export default async function globalSetup(): Promise<void> {
  const mongo = await MongoMemoryServer.create();
  globalThis.__MONGO__ = mongo;
  process.env.E2E_MONGO_BASE_URI = mongo.getUri();
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'e2e-test-secret-at-least-32-characters!!';
  process.env.MAIL_DRIVER = 'console';
}
