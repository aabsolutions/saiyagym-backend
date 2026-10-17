/**
 * Log hygiene. Logs leave the app (Render's log stream, any drain attached to it), so they must
 * never carry credentials, tokens or personal data. Structured fields are covered by pino's
 * `redact` paths (`LOG_REDACT_PATHS`); free text (error messages from drivers, e.g. Mongo's
 * `E11000 dup key: { email: "ana@x.com" }`) goes through `scrubText()`.
 */

/** pino `redact` paths. `*` matches one level: `*.password` covers `body.password`. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.accessToken',
  '*.refreshToken',
  '*.email',
  '*.to',
];

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
/** Long opaque strings: JWTs (`xxx.yyy.zzz`) and our `<uuid>.<secret>` tokens. */
const OPAQUE_TOKEN = /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]{8,})?\b/g;

/** `ana.garcia@gmail.com` → `a***@gmail.com`: still useful to correlate a support ticket. */
export function maskEmail(email: string): string {
  return email.replace(EMAIL, '$1***@$2');
}

/** Masks emails and token-looking strings inside free text. */
export function scrubText(text: string): string {
  return maskEmail(text).replace(OPAQUE_TOKEN, '[REDACTED]');
}
