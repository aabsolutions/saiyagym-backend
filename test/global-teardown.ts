import './global-setup';

export default async function globalTeardown(): Promise<void> {
  await globalThis.__MONGO__?.stop();
}
