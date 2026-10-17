import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';
import { maskEmail, scrubText } from '../../common/utils/log-redaction.util';
import type { Env } from '../../config/env.schema';
import { MailMessage, MailService } from './mail.service';

/** SMTP transport (any provider: Brevo, SES SMTP, Mailgun, Gmail app password…), configured via SMTP_*. */
@Injectable()
export class SmtpMailService extends MailService {
  private readonly logger = new Logger(SmtpMailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService<Env, true>) {
    super();
    const user = config.get('SMTP_USER', { infer: true });
    this.from = config.get('MAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_SECURE', { infer: true }),
      auth: user ? { user, pass: config.get('SMTP_PASS', { infer: true }) } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({ from: this.from, ...message });
    } catch (error) {
      // Callers decide whether a failed email should fail the request; log with context here.
      this.logger.error(
        `Failed to send "${message.subject}" to ${maskEmail(message.to)}`,
        error instanceof Error ? scrubText(error.stack ?? error.message) : undefined,
      );
      throw error;
    }
  }
}
