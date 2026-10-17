import { Injectable } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';
import type { MailMessage } from './mail.service';

export type MailTemplate = 'verifyEmail' | 'resetPassword';

export interface RenderParams {
  template: MailTemplate;
  to: string;
  lang: string;
  name: string | null;
  actionUrl: string;
  /** Interpolated into the template strings, e.g. `{ hours: 24 }`. */
  args?: Record<string, unknown>;
}

/**
 * Builds localized emails from src/i18n/<lang>/mail.json — adding a language needs no code.
 * Plain text + minimal inline-styled HTML (email clients ignore <style> and external CSS).
 */
@Injectable()
export class MailTemplatesService {
  constructor(private readonly i18n: I18nService) {}

  render({ template, to, lang, name, actionUrl, args = {} }: RenderParams): MailMessage {
    const t = (key: string, extra: Record<string, unknown> = {}): string =>
      String(this.i18n.t(`mail.${key}`, { lang, args: { ...args, ...extra } }));

    const greeting = name ? t('layout.greeting', { name }) : t('layout.greetingAnonymous');
    const intro = t(`${template}.intro`);
    const action = t(`${template}.action`);
    const expires = t(`${template}.expires`);
    const ignore = t(`${template}.ignore`);
    const footer = t('layout.footer');

    const text = [
      greeting,
      '',
      intro,
      '',
      `${action}: ${actionUrl}`,
      '',
      expires,
      ignore,
      '',
      footer,
    ].join('\n');

    const html = `<!doctype html>
<html lang="${escapeHtml(lang)}"><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,sans-serif;color:#18181b">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px">
<p style="margin:0 0 16px">${escapeHtml(greeting)}</p>
<p style="margin:0 0 24px">${escapeHtml(intro)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px">${escapeHtml(action)}</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#52525b">${escapeHtml(expires)}</p>
<p style="margin:0 0 24px;font-size:13px;color:#52525b">${escapeHtml(ignore)}</p>
<p style="margin:0;font-size:12px;color:#a1a1aa;word-break:break-all">${escapeHtml(actionUrl)}</p>
</div>
<p style="text-align:center;font-size:12px;color:#a1a1aa">${escapeHtml(footer)}</p>
</body></html>`;

    return { to, subject: t(`${template}.subject`), text, html };
  }
}

/** User-controlled values (name) end up in HTML: always escape. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
