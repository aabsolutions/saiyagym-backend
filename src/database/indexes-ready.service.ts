import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

/**
 * Mongoose builds indexes in the background after compiling each model. On a fresh database
 * (new deploy, e2e run) requests can arrive before a `unique` index exists — and duplicates
 * slip in (seen with plans.code). Waiting here blocks startup until every index is in place.
 *
 * onModuleInit runs after all providers (and thus all models) are instantiated, and before
 * any onApplicationBootstrap hook (e.g. plan seeding) or the HTTP server starts listening.
 */
@Injectable()
export class IndexesReadyService implements OnModuleInit {
  private readonly logger = new Logger(IndexesReadyService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  async onModuleInit(): Promise<void> {
    const models = Object.values(this.connection.models);
    await Promise.all(models.map((model) => model.init()));
    this.logger.log(`Indexes ready for ${models.length} collections`);
  }
}
