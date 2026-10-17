import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import type { Options } from 'pino-http';
import { pinoHttp } from 'pino-http';
import { maskEmail, scrubText } from '../common/utils/log-redaction.util';
import { loggerConfig } from './logger.config';

describe('loggerConfig (request logs carry no sensitive data)', () => {
  let server: Server;
  let base: string;
  const lines: Record<string, unknown>[] = [];

  beforeAll(async () => {
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString().split('\n').filter(Boolean))
          lines.push(JSON.parse(line) as Record<string, unknown>);
        done();
      },
    });
    const options = loggerConfig({ NODE_ENV: 'production', LOG_LEVEL: 'info' }).pinoHttp as Options;
    const log = pinoHttp(options, sink);
    server = createServer((req: IncomingMessage & { user?: { id: string } }, res) => {
      log(req, res);
      if (req.url?.startsWith('/api/v1/me')) req.user = { id: 'user-123' }; // as the JWT guard does
      // Something in the app logging a careless object: redact paths still apply.
      req.log.info({ body: { email: 'ana@example.com', password: 'hunter22' } }, 'handler');
      res.statusCode = req.url?.includes('boom') ? 500 : 200;
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const completion = (url: string) =>
    lines.find((l) => 'res' in l && (l.req as { url: string }).url === url);

  it('one JSON line per request: id, userId, method, path, status — nothing else', async () => {
    const res = await fetch(`${base}/api/v1/me?q=ana@example.com&token=abc`, {
      headers: { authorization: 'Bearer eyJhbGciOi.secret.sig', cookie: 'sid=1' },
    });
    const line = completion('/api/v1/me')!;
    expect(line).toMatchObject({
      level: 'info',
      service: 'saiyagym-api',
      env: 'production',
      userId: 'user-123',
      req: { method: 'GET', url: '/api/v1/me' },
      res: { statusCode: 200 },
    });
    const requestId = res.headers.get('x-request-id');
    expect((line.req as { id: string }).id).toBe(requestId);
    // App logs written during the request are correlated by reqId.
    expect(lines.find((l) => l.msg === 'handler')).toMatchObject({ reqId: requestId });
    expect(typeof line.time).toBe('string'); // ISO timestamp

    const all = JSON.stringify(lines);
    for (const secret of [
      'Bearer',
      'eyJhbGciOi',
      'sid=1',
      'ana@example.com',
      'hunter22',
      'token=abc',
    ]) {
      expect(all).not.toContain(secret);
    }
  });

  it('reuses a well-formed proxy request id and rejects a malformed one', async () => {
    const good = await fetch(`${base}/a`, { headers: { 'x-request-id': 'render-abc12345' } });
    expect(good.headers.get('x-request-id')).toBe('render-abc12345');
    const bad = await fetch(`${base}/b`, { headers: { 'x-request-id': '"> {"level":"fatal"}' } });
    expect(bad.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('5xx are logged as error; health checks are not logged', async () => {
    await fetch(`${base}/boom`);
    expect(completion('/boom')).toMatchObject({ level: 'error' });
    await fetch(`${base}/api/v1/health`);
    expect(completion('/api/v1/health')).toBeUndefined();
  });
});

describe('log text scrubbing', () => {
  it('masks emails but keeps the domain for support', () => {
    expect(maskEmail('ana.garcia@gmail.com')).toBe('a***@gmail.com');
  });

  it('scrubs driver messages and token-looking strings', () => {
    expect(scrubText('E11000 duplicate key { email: "bob@x.io" }')).toBe(
      'E11000 duplicate key { email: "b***@x.io" }',
    );
    expect(
      scrubText('token 3f1c2a9e-1111-4222-8333-444455556666.Zm9vYmFyYmF6cXV4cXV1eA rejected'),
    ).toBe('token [REDACTED] rejected');
    expect(
      scrubText('jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N'),
    ).toBe('jwt [REDACTED]');
  });
});
