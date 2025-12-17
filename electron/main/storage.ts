import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import type { Message, ChatSession, ChatSummary } from '../../src/types/verbos';

export class StorageService {
  private readonly filePath: string;

  constructor() {
    this.filePath = `${app.getPath('userData')}/verbos-history.json`;
  }

  private ensureFile(): void {
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, JSON.stringify({ sessions: {} }, null, 2));
    }
  }

  private readData(): { sessions: Record<string, ChatSession> } {
    this.ensureFile();
    const data = readFileSync(this.filePath, 'utf-8');
    return JSON.parse(data);
  }

  private writeData(data: { sessions: Record<string, ChatSession> }): void {
    writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  saveSession(session: ChatSession): void {
    const data = this.readData();
    data.sessions[session.id] = session;
    this.writeData(data);
  }

  getSession(id: string): ChatSession | null {
    const data = this.readData();
    return data.sessions[id] || null;
  }

  getAllSessions(): ChatSummary[] {
    const data = this.readData();
    const sessions = Object.values(data.sessions);

    return sessions
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(session => ({
        id: session.id,
        title: session.title,
        date: new Date(session.updatedAt).toLocaleDateString()
      }));
  }

  deleteSession(id: string): boolean {
    const data = this.readData();
    if (data.sessions[id]) {
      delete data.sessions[id];
      this.writeData(data);
      return true;
    }
    return false;
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
    this.saveSession(session);
    return session;
  }
}
