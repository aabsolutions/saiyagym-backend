import { Global, Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncRegistry } from './sync.registry';
import { SyncService } from './sync.service';

/** Global so any domain module can inject SyncRegistry and register its handler. */
@Global()
@Module({
  controllers: [SyncController],
  providers: [SyncRegistry, SyncService],
  exports: [SyncRegistry],
})
export class SyncModule {}
