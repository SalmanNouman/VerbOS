import type Database from 'better-sqlite3';
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointPendingWrite,
  type PendingWrite,
} from '@langchain/langgraph-checkpoint';
import type { RunnableConfig } from '@langchain/core/runnables';
import { GraphLogger } from './logger';

/**
 * SQLiteCheckpointer adapts Better-SQLite3 for LangGraph persistence.
 * This ensures complete data sovereignty by storing all graph state locally.
 */
export class SQLiteCheckpointer extends BaseCheckpointSaver {
  private db: Database.Database;
  private isSetup: boolean = false;

  constructor(db: Database.Database) {
    super();
    this.db = db;
  }

  /**
   * Initialize the checkpoint tables in the database
   */
  private setup(): void {
    if (this.isSetup) return;

    // Check for existing tables and their schema
    const checkpointTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_checkpoints'"
    ).get();

    if (checkpointTable) {
      // Check for columns
      const columns = this.db.prepare("PRAGMA table_info(graph_checkpoints)").all() as any[];
      const hasCheckpointType = columns.some(c => c.name === 'checkpoint_type');
      const hasMetadataType = columns.some(c => c.name === 'metadata_type');

      if (!hasCheckpointType) {
        this.db.exec("ALTER TABLE graph_checkpoints ADD COLUMN checkpoint_type TEXT NOT NULL DEFAULT 'json'");
      }
      if (!hasMetadataType) {
        this.db.exec("ALTER TABLE graph_checkpoints ADD COLUMN metadata_type TEXT NOT NULL DEFAULT 'json'");
      }
    } else {
      this.db.exec(`
        CREATE TABLE graph_checkpoints (
          thread_id TEXT NOT NULL,
          checkpoint_ns TEXT NOT NULL DEFAULT '',
          checkpoint_id TEXT NOT NULL,
          parent_checkpoint_id TEXT,
          checkpoint BLOB NOT NULL,
          metadata BLOB NOT NULL,
          checkpoint_type TEXT NOT NULL DEFAULT 'json',
          metadata_type TEXT NOT NULL DEFAULT 'json',
          created_at REAL NOT NULL DEFAULT (julianday('now')),
          PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
        );
      `);
    }

    const writesTable = this.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='graph_writes'"
    ).get();

    if (writesTable) {
       const columns = this.db.prepare("PRAGMA table_info(graph_writes)").all() as any[];
       const hasType = columns.some(c => c.name === 'type');
       
       if (!hasType) {
         this.db.exec("ALTER TABLE graph_writes ADD COLUMN type TEXT NOT NULL DEFAULT 'json'");
       }
    } else {
      this.db.exec(`
        CREATE TABLE graph_writes (
          thread_id TEXT NOT NULL,
          checkpoint_ns TEXT NOT NULL DEFAULT '',
          checkpoint_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          idx INTEGER NOT NULL,
          channel TEXT NOT NULL,
          value BLOB,
          type TEXT NOT NULL DEFAULT 'json',
          PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, idx)
        );
      `);
    }

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_checkpoints_thread 
        ON graph_checkpoints(thread_id, checkpoint_ns);
      CREATE INDEX IF NOT EXISTS idx_writes_checkpoint 
        ON graph_writes(thread_id, checkpoint_ns, checkpoint_id);
    `);

    this.isSetup = true;
    GraphLogger.info('CHECKPOINT', 'Tables initialized/migrated');
  }

  /**
   * Get the thread_id and checkpoint_ns from config
   */
  private getConfigValues(config: RunnableConfig): { threadId: string; checkpointNs: string; checkpointId?: string } {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error('Missing thread_id in config.configurable');
    }
    return {
      threadId: String(threadId),
      checkpointNs: String(config.configurable?.checkpoint_ns ?? ''),
      checkpointId: config.configurable?.checkpoint_id ? String(config.configurable.checkpoint_id) : undefined,
    };
  }

  /**
   * Get a checkpoint tuple from the database
   */
  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.setup();
    const { threadId, checkpointNs, checkpointId } = this.getConfigValues(config);

    let row: any;

    if (checkpointId) {
      row = this.db.prepare(`
        SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata, checkpoint_type, metadata_type
        FROM graph_checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      `).get(threadId, checkpointNs, checkpointId);
    } else {
      row = this.db.prepare(`
        SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata, checkpoint_type, metadata_type
        FROM graph_checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(threadId, checkpointNs);
    }

    if (!row) {
      return undefined;
    }

    const checkpoint = await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint) as Checkpoint;
    const metadata = await this.serde.loadsTyped(row.metadata_type, row.metadata) as CheckpointMetadata;

    // Get pending writes for this checkpoint
    const writeRows = this.db.prepare(`
      SELECT task_id, channel, value, type
      FROM graph_writes
      WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      ORDER BY idx
    `).all(threadId, checkpointNs, row.checkpoint_id) as any[];

    const pendingWrites: CheckpointPendingWrite[] = await Promise.all(writeRows.map(async (writeRow) => {
      const value = writeRow.value ? await this.serde.loadsTyped(writeRow.type, writeRow.value) : null;
      return [writeRow.task_id, writeRow.channel, value] as CheckpointPendingWrite;
    }));

    return {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: row.checkpoint_id,
        },
      },
      checkpoint,
      metadata,
      parentConfig: row.parent_checkpoint_id
        ? {
            configurable: {
              thread_id: threadId,
              checkpoint_ns: checkpointNs,
              checkpoint_id: row.parent_checkpoint_id,
            },
          }
        : undefined,
      pendingWrites,
    };
  }

  /**
   * List checkpoints matching the given config
   */
  async *list(
    config: RunnableConfig,
    options?: { limit?: number; before?: RunnableConfig; filter?: Record<string, unknown> }
  ): AsyncGenerator<CheckpointTuple> {
    this.setup();
    const { threadId, checkpointNs } = this.getConfigValues(config);

    let query = `
      SELECT checkpoint_id, parent_checkpoint_id, checkpoint, metadata, checkpoint_type, metadata_type, created_at
      FROM graph_checkpoints
      WHERE thread_id = ? AND checkpoint_ns = ?
    `;
    const params: any[] = [threadId, checkpointNs];

    if (options?.before?.configurable?.checkpoint_id) {
      const beforeRow = this.db.prepare(`
        SELECT created_at FROM graph_checkpoints
        WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
      `).get(threadId, checkpointNs, options.before.configurable.checkpoint_id) as any;

      if (beforeRow) {
        query += ` AND created_at < ?`;
        params.push(beforeRow.created_at);
      }
    }

    query += ` ORDER BY created_at DESC`;

    if (options?.limit) {
      query += ` LIMIT ?`;
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as any[];

    for (const row of rows) {
      const checkpoint = await this.serde.loadsTyped(row.checkpoint_type, row.checkpoint) as Checkpoint;
      const metadata = await this.serde.loadsTyped(row.metadata_type, row.metadata) as CheckpointMetadata;

      // Apply metadata filter if provided
      if (options?.filter) {
        let matches = true;
        for (const [key, value] of Object.entries(options.filter)) {
          if ((metadata as any)[key] !== value) {
            matches = false;
            break;
          }
        }
        if (!matches) continue;
      }

      yield {
        config: {
          configurable: {
            thread_id: threadId,
            checkpoint_ns: checkpointNs,
            checkpoint_id: row.checkpoint_id,
          },
        },
        checkpoint,
        metadata,
        parentConfig: row.parent_checkpoint_id
          ? {
              configurable: {
                thread_id: threadId,
                checkpoint_ns: checkpointNs,
                checkpoint_id: row.parent_checkpoint_id,
              },
            }
          : undefined,
      };
    }
  }

  /**
   * Save a checkpoint to the database
   */
  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, number>
  ): Promise<RunnableConfig> {
    this.setup();
    const { threadId, checkpointNs } = this.getConfigValues(config);

    const checkpointId = checkpoint.id;
    const parentCheckpointId = config.configurable?.checkpoint_id;

    const [checkpointType, checkpointData] = await this.serde.dumpsTyped(checkpoint);
    const [metadataType, metadataData] = await this.serde.dumpsTyped(metadata);

    this.db.prepare(`
      INSERT OR REPLACE INTO graph_checkpoints 
        (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id, checkpoint, metadata, checkpoint_type, metadata_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadId,
      checkpointNs,
      checkpointId,
      parentCheckpointId || null,
      checkpointData,
      metadataData,
      checkpointType,
      metadataType
    );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpointId,
      },
    };
  }

  /**
   * Store pending writes for a checkpoint
   */
  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string
  ): Promise<void> {
    this.setup();
    const { threadId, checkpointNs, checkpointId } = this.getConfigValues(config);

    if (!checkpointId) {
      throw new Error('Missing checkpoint_id in config for putWrites');
    }

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO graph_writes 
        (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value, type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // We need to resolve all dumps before starting transaction
    const serializedWrites = await Promise.all(writes.map(async (write) => {
      const channel = write[0];
      const value = write[1];
      const [type, data] = value !== null ? await this.serde.dumpsTyped(value) : ['json', null];
      return { channel, data, type };
    }));

    this.db.transaction(() => {
      for (let idx = 0; idx < serializedWrites.length; idx++) {
        const { channel, data, type } = serializedWrites[idx];
        insertStmt.run(
          threadId,
          checkpointNs,
          checkpointId,
          taskId,
          idx,
          channel,
          data,
          type
        );
      }
    })();
  }

  /**
   * Delete checkpoints for a thread
   */
  async deleteThread(threadId: string): Promise<void> {
    this.setup();
    
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM graph_writes WHERE thread_id = ?`).run(threadId);
      this.db.prepare(`DELETE FROM graph_checkpoints WHERE thread_id = ?`).run(threadId);
    })();

    GraphLogger.info('CHECKPOINT', `Deleted thread: ${threadId}`);
  }
}