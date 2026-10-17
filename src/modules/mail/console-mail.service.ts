import { Injectable, Logger } from '@nestjs/common';
import { maskEmail } from '../../common/utils/log-redaction.util';
import { MailMessage, MailService } from './mail.service';

/**
 * Development transport: prints the email (including links) to the log instead of sending it.
 * With `printBody: false` (production) only a masked notice is logged: email bodies carry
 * single-use verification/reset tokens, and logs leave the app.
 */
@Injectable()
export class ConsoleMailService extends MailService {
  private readonly logger = new Logger('Mail');

  constructor(private readonly printBody = true) {
    super();
  }

  send(message: MailMessage): Promise<void> {
    if (!this.printBody) {
      this.logger.warn(
        `MAIL_DRIVER=console: email "${message.subject}" to ${maskEmail(message.to)} NOT sent`,
      );
      return Promise.resolve();
    }
    this.logger.log(
      `\n──── email to ${message.to} ────\nSubject: ${message.subject}\n\n${message.text}\n────────────`,
    );
    return Promise.resolve();
  }
}
