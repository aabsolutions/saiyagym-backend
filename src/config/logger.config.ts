import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions } from 'pino';
import type { AuthenticatedUser } from '../common/types/authenticated-user';
import { LOG_REDACT_PATHS } from '../common/utils/log-redaction.util';
import type { Env } from './env.schema';

/** Accept a caller/proxy request id only if it looks like one (no log injection). */
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const HEALTH_PATH = '/api/v1/health';

type Req = IncomingMessage & { user?: AuthenticatedUser; originalUrl?: string };

/** Path without the query string: queries carry user search text and aren't needed to debug. */
const pathOf = (req: IncomingMessage) => ((req as Req).originalUrl ?? req.url ?? '').split('?')[0];

/**
 * Structured JSON logs (one line per event) for Render's log stream; pretty-printed in development.
 * Every request gets one completion line `{ userId, req: { id, method, url }, res: { statusCode },
 * responseTime }` — never headers, bodies or query strings. App logs inside a request get `reqId`. Health checks aren't logged (Render
 * probes them constantly). See docs/DEPLOYMENT.md#logs.
 */
export function loggerConfig(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: 'saiyagym-api', env: env.NODE_ENV },
      timestamp: stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      redact: { paths: LOG_REDACT_PATHS, censor: '[REDACTED]' },
      ...(env.NODE_ENV === 'development' && {
        transport: { target: 'pino-pretty', options: { singleLine: true, colorize: true } },
      }),

      // Reuse the proxy's id (Render sends one) so a request can be followed across both logs.
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const incoming = req.headers['x-request-id'] ?? req.headers['rndr-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      // App logs written during a request carry only `reqId` (not the whole req) as a binding.
      quietReqLogger: true,
      autoLogging: { ignore: (req: IncomingMessage) => pathOf(req) === HEALTH_PATH },
      customLogLevel: (_req, res, error) =>
        error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Evaluated when the response finishes, i.e. after the JWT guard has set req.user.
      customProps: (req: IncomingMessage) => {
        const user = (req as Req).user;
        return user ? { userId: user.id } : {};
      },
      serializers: {
        // Receives pino's standard request object (with `id`); keep only what's safe.
        req: (req: IncomingMessage & { id?: unknown }) => ({
          id: req.id,
          method: req.method,
          url: pathOf(req),
        }),
        res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
