import { app } from 'electron';
import { join } from 'path';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ChatSession, ChatSummary } from '../../src/types/verbos';

export class StorageService {
  private db: Database.Database;

  constructor() {
    const dbPath = join(app.getPath('userData'), 'verbos.db');
    console.log(`[StorageService] Initializing database at: ${dbPath}`);

    this.db = new Database(dbPath);
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for performance
    this.initializeTables();
    this.migrateFromJSON();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(session_id, timestamp);
    `);
    console.log('[StorageService] Database tables initialized');
  }

  private migrateFromJSON(): void {
    try {
      const { existsSync, readFileSync, renameSync } = require('fs');
      const oldPath = join(app.getPath('userData'), 'verbos-history.json');

      if (existsSync(oldPath)) {
        console.log('[StorageService] Found legacy JSON file, migrating...');
        const data = JSON.parse(readFileSync(oldPath, 'utf-8'));

        if (data.sessions) {
          const sessionCount = Object.keys(data.sessions).length;

          for (const session of Object.values(data.sessions) as ChatSession[]) {
            // Create session
            this.db.prepare(`
              INSERT OR IGNORE INTO sessions (id, title, summary, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
            `).run(session.id, session.title, '', session.createdAt, session.updatedAt);

            // Insert messages with per-message timestamps to preserve order
            const insertMsg = this.db.prepare(`
              INSERT INTO messages (session_id, role, content, timestamp)
              VALUES (?, ?, ?, ?)
            `);

            const baseTimestamp = session.createdAt || session.updatedAt;
            for (let i = 0; i < session.messages.length; i++) {
              const msg = session.messages[i];
              // Use message's own timestamp if available, otherwise derive from index
              const msgTimestamp = (msg as any).timestamp || (msg as any).createdAt || (baseTimestamp + i);
              insertMsg.run(session.id, msg.role, msg.content, msgTimestamp);
            }
          }

          console.log(`[StorageService] Migrated ${sessionCount} sessions from JSON`);
        }

        // Archive the old file
        renameSync(oldPath, join(app.getPath('userData'), 'verbos-history.json.backup'));
        console.log('[StorageService] Legacy file archived');
      }
    } catch (error) {
      console.error('[StorageService] Migration failed (non-fatal):', error);
    }
  }

  createSession(title?: string): ChatSession {
    const now = Date.now();
    const session: ChatSession = {
      id: uuidv4(),
      title: title || 'New Chat',
      messages: [],
      createdAt: now,
      updatedAt: now
    };

    this.db.prepare(`
      INSERT INTO sessions (id, title, summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(session.id, session.title, '', now, now);

    console.log(`[StorageService] Created session: ${session.id}`);
    return session;
  }

  addMessage(sessionId: string, role: 'user' | 'assistant', content: string): void {
    const now = Date.now();
    const insert = this.db.prepare(`
      INSERT INTO messages (session_id, role, content, timestamp)
      VALUES (?, ?, ?, ?)
      `);
    const update = this.db.prepare(`
      UPDATE sessions SET updated_at = ? WHERE id = ?
      `);

    this.db.transaction(() => {
      insert.run(sessionId, role, content, now);
      update.run(now, sessionId);
    })();
  }

  updateSummary(sessionId: string, summary: string): void {
    this.db.prepare(`
      UPDATE sessions SET summary = ? WHERE id = ?
    `).run(summary, sessionId);
  }

  getSummary(sessionId: string): string {
    const row = this.db.prepare(`
      SELECT summary FROM sessions WHERE id = ?
    `).get(sessionId) as { summary: string } | undefined;

    return row?.summary || '';
  }

  getRecentMessages(sessionId: string, limit: number): Message[] {
    const rows = this.db.prepare(`
      SELECT role, content
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(sessionId, limit) as Array<{ role: 'user' | 'assistant'; content: string }>;

    return rows.reverse(); // Return in chronological order
  }

  getSession(id: string): ChatSession | null {
    const sessionRow = this.db.prepare(`
      SELECT id, title, created_at, updated_at
      FROM sessions
      WHERE id = ?
    `).get(id) as { id: string; title: string; created_at: number; updated_at: number } | undefined;

    if (!sessionRow) return null;

    const messages = this.db.prepare(`
      SELECT role, content
      FROM messages
      WHERE session_id = ?
      ORDER BY timestamp ASC
    `).all(id) as Message[];

    return {
      id: sessionRow.id,
      title: sessionRow.title,
      messages,
      createdAt: sessionRow.created_at,
      updatedAt: sessionRow.updated_at
    };
  }

  getAllSessions(): ChatSummary[] {
    const rows = this.db.prepare(`
      SELECT id, title, updated_at
      FROM sessions
      ORDER BY updated_at DESC
    `).all() as Array<{ id: string; title: string; updated_at: number }>;

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      date: new Date(row.updated_at).toLocaleDateString()
    }));
  }

  deleteSession(id: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM sessions WHERE id = ?
    `).run(id);

    console.log(`[StorageService] Deleted session: ${id}`);
    return result.changes > 0;
  }

  updateTitle(sessionId: string, title: string): boolean {
    const result = this.db.prepare(`
      UPDATE sessions SET title = ? WHERE id = ?
    `).run(title, sessionId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
