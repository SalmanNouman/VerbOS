import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteCheckpointer } from '../SQLiteCheckpointer';
import Database from 'better-sqlite3';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { rm } from 'fs/promises';

describe('SQLiteCheckpointer Migration', () => {
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbPath = join(tmpdir(), `verbos-test-db-${randomUUID()}.db`);
    db = new Database(dbPath);
  });

  afterEach(async () => {
    db.close();
    try {
      await rm(dbPath, { force: true });
    } catch {}
  });

  it('should migrate old schema to new schema', async () => {
    // 1. Create OLD schema (missing columns)
    db.exec(`
      CREATE TABLE graph_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint BLOB NOT NULL,
        metadata BLOB NOT NULL,
        created_at REAL NOT NULL DEFAULT (julianday('now')),
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
    `);

    // 2. Initialize Checkpointer
    const checkpointer = new SQLiteCheckpointer(db);
    
    // 3. Trigger setup() by calling a method
    // We can't call private setup(), but getTuple calls it.
    await checkpointer.getTuple({ configurable: { thread_id: '1' } });

    // 4. Verify columns exist
    const columns = db.prepare("PRAGMA table_info(graph_checkpoints)").all() as any[];
    const hasCheckpointType = columns.some(c => c.name === 'checkpoint_type');
    const hasMetadataType = columns.some(c => c.name === 'metadata_type');

    expect(hasCheckpointType).toBe(true);
    expect(hasMetadataType).toBe(true);
  });

  it('should initialize correctly with no existing tables', async () => {
    const checkpointer = new SQLiteCheckpointer(db);
    await checkpointer.getTuple({ configurable: { thread_id: '1' } });

    const columns = db.prepare("PRAGMA table_info(graph_checkpoints)").all() as any[];
    const hasCheckpointType = columns.some(c => c.name === 'checkpoint_type');
    expect(hasCheckpointType).toBe(true);
  });
});
