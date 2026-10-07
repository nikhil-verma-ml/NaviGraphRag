import fs from 'fs';
import path from 'path';

export interface SessionRecord {
  thread_id: string;
  created_at: string;
  last_active_at: string;
  title: string;
}

export interface StoredMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  voiceSummary?: string;
  name?: string;
  sources?: { type: string; content: string }[];
  timestamp?: string;
}

export class SessionStore {
  private sessions: Map<string, SessionRecord> = new Map();
  private messages: Map<string, StoredMessage[]> = new Map();
  private facts: Map<string, string[]> = new Map();
  private storageFile: string;

  constructor(storageDir = './data') {
    this.storageFile = path.join(storageDir, 'store.json');
    try {
      if (!fs.existsSync(storageDir)) {
        fs.mkdirSync(storageDir, { recursive: true });
      }
      if (fs.existsSync(this.storageFile)) {
        const raw = fs.readFileSync(this.storageFile, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.sessions)) {
          for (const s of data.sessions) {
            this.sessions.set(s.thread_id, s);
          }
        }
        if (data.messages && typeof data.messages === 'object') {
          for (const [k, v] of Object.entries(data.messages)) {
            this.messages.set(k, v as StoredMessage[]);
          }
        }
      }
    } catch (err) {
      console.warn('[SessionStore] Could not load persisted data:', err);
    }
  }

  private persist() {
    try {
      const data = {
        sessions: Array.from(this.sessions.values()),
        messages: Object.fromEntries(this.messages.entries()),
      };
      fs.writeFileSync(this.storageFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // In-memory fallback if disk error
    }
  }

  createOrUpdateSession(threadId: string, title?: string): SessionRecord {
    const now = new Date().toISOString();
    const existing = this.sessions.get(threadId);

    if (existing) {
      existing.last_active_at = now;
      if (title && (!existing.title || existing.title === existing.thread_id)) {
        existing.title = title.slice(0, 50);
      }
      this.persist();
      return existing;
    }

    const newRecord: SessionRecord = {
      thread_id: threadId,
      created_at: now,
      last_active_at: now,
      title: (title || threadId).slice(0, 50),
    };
    this.sessions.set(threadId, newRecord);
    this.persist();
    return newRecord;
  }

  deleteSession(threadId: string): boolean {
    const removed = this.sessions.delete(threadId);
    this.messages.delete(threadId);
    this.facts.delete(threadId);
    this.persist();
    return removed;
  }

  listSessions(): SessionRecord[] {
    return Array.from(this.sessions.values()).sort(
      (a, b) => new Date(b.last_active_at).getTime() - new Date(a.last_active_at).getTime()
    );
  }

  getSessionMessages(threadId: string): StoredMessage[] {
    return this.messages.get(threadId) || [];
  }

  getFilteredMessages(threadId: string): { role: 'user' | 'assistant'; content: string; sources?: { type: string; content: string }[] }[] {
    const msgs = this.getSessionMessages(threadId);
    return msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
        sources: m.sources,
      }));
  }

  addMessage(threadId: string, msg: StoredMessage) {
    if (!this.messages.has(threadId)) {
      this.messages.set(threadId, []);
    }
    this.messages.get(threadId)!.push({
      ...msg,
      timestamp: new Date().toISOString(),
    });
    this.persist();
  }

  addLongTermFact(threadId: string, fact: string) {
    if (!this.facts.has(threadId)) {
      this.facts.set(threadId, []);
    }
    this.facts.get(threadId)!.push(fact);
  }

  getLongTermFacts(threadId: string): string[] {
    return this.facts.get(threadId) || [];
  }
}

let storeInstance: SessionStore | null = null;
export function getSessionStore(): SessionStore {
  if (!storeInstance) {
    storeInstance = new SessionStore();
  }
  return storeInstance;
}
