export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Transport abstraction. Selected by MAIL_DRIVER: `console` (dev, logs the email) or `smtp`.
 * Abstract class (not interface) so it doubles as the DI token: `constructor(mail: MailService)`.
 */
export abstract class MailService {
  abstract send(message: MailMessage): Promise<void>;
}
