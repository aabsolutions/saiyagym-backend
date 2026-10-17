import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { createTestApp } from './utils/create-test-app';

/**
 * docs/INDEXES.md explains why every index exists. This keeps it honest: an index added to a
 * schema without a documented reason (or a documented one that no longer exists) fails here.
 */
describe('MongoDB indexes match docs/INDEXES.md (e2e)', () => {
  let app: INestApplication;
  let db: Connection;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    db = app.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await app?.close();
  });

  /** `collection.indexName` for every model's collection, `_id_` excluded. */
  const actualIndexes = async (): Promise<string[]> => {
    const names: string[] = [];
    for (const model of Object.values(db.models)) {
      for (const index of await model.collection.indexes()) {
        if (index.name !== '_id_') names.push(`${model.collection.collectionName}.${index.name}`);
      }
    }
    return names.sort();
  };

  /** Rows like: | `workouts` | `userId_1_startedAt_-1` | … */
  const documentedIndexes = (): string[] => {
    const doc = readFileSync(join(__dirname, '..', 'docs', 'INDEXES.md'), 'utf8');
    return [...doc.matchAll(/^\|\s*`([a-z_]+)`\s*\|\s*`([^`]+)`\s*\|/gm)]
      .map(([, collection, name]) => `${collection}.${name}`)
      .sort();
  };

  it('every index is documented and every documented index exists', async () => {
    expect(documentedIndexes()).toEqual(await actualIndexes());
  });
});
