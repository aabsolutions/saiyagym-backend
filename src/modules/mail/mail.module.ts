import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { ConsoleMailService } from './console-mail.service';
import { MailTemplatesService } from './mail-templates.service';
import { MailService } from './mail.service';
import { SmtpMailService } from './smtp-mail.service';

@Global()
@Module({
  providers: [
    MailTemplatesService,
    {
      provide: MailService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): MailService =>
        config.get('MAIL_DRIVER', { infer: true }) === 'smtp'
          ? new SmtpMailService(config)
          : new ConsoleMailService(config.get('NODE_ENV', { infer: true }) !== 'production'),
    },
  ],
  exports: [MailService, MailTemplatesService],
})
export class MailModule {}
