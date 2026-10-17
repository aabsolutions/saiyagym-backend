import { Injectable } from '@nestjs/common';
import type { SyncCollection, SyncHandler } from './sync.types';

/** Domain modules register their handler in onModuleInit (same pattern as UsageCountersRegistry). */
@Injectable()
export class SyncRegistry {
  private readonly handlers = new Map<SyncCollection, SyncHandler>();

  register(handler: SyncHandler): void {
    if (this.handlers.has(handler.collection)) {
      throw new Error(`Sync handler "${handler.collection}" registered twice`);
    }
    this.handlers.set(handler.collection, handler);
  }

  get(collection: SyncCollection): SyncHandler {
    const handler = this.handlers.get(collection);
    if (!handler) throw new Error(`No sync handler registered for "${collection}"`);
    return handler;
  }

  all(): SyncHandler[] {
    return [...this.handlers.values()];
  }
}
