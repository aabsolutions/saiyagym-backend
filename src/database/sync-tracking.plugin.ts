import type { Query, Schema } from 'mongoose';

const UPDATE_OPS = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'replaceOne',
  'findOneAndReplace',
] as const;

/**
 * Adds `serverUpdatedAt`: the SERVER time of the last write to the document, by any path
 * (REST, sync, seed, admin). It's the cursor of GET /sync/pull.
 *
 * Why not `updatedAt`? With last-write-wins, `updatedAt` is the CLIENT's edit time. A change made
 * offline at 10:00 and pushed at 15:00 keeps updatedAt=10:00 — a device that pulled at 12:00 would
 * never receive it. Two clocks: `updatedAt` decides conflicts, `serverUpdatedAt` drives pull.
 *
 * Not covered: `bulkWrite` and raw driver calls bypass middleware — set the field explicitly there.
 */
export function syncTrackingPlugin(schema: Schema, options: { ownerField?: string } = {}): void {
  schema.add({ serverUpdatedAt: { type: Date, default: () => new Date() } });
  schema.index({ [options.ownerField ?? 'userId']: 1, serverUpdatedAt: 1 });

  schema.pre('save', function () {
    this.set('serverUpdatedAt', new Date());
  });

  schema.pre([...UPDATE_OPS], function (this: Query<unknown, unknown>) {
    const update = this.getUpdate();
    // Aggregation-pipeline updates (arrays) manage the field themselves (see the backfill).
    if (!update || Array.isArray(update)) return;
    const now = new Date();
    const isOperatorUpdate = Object.keys(update).some((key) => key.startsWith('$'));
    if (isOperatorUpdate) {
      update.$set = { ...(update.$set ?? {}), serverUpdatedAt: now };
      this.setUpdate(update);
    } else {
      this.setUpdate({ ...update, serverUpdatedAt: now }); // replacement document
    }
  });
}
