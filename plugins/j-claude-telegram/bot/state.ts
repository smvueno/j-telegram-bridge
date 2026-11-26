import {
  chmodSync,
  rmSync,
  statSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomInt } from "node:crypto";

const PAIR_ALPHABET = "abcdefghijkmnopqrstuvwxyz";
const PAIR_EXPIRY_MS = 60 * 60 * 1000;
const MAX_PENDING = 200;

type PendingEntry = { userId: number; at: number };

type StateData = {
  allowed: number[];
  pending: Record<string, PendingEntry>;
  sessions: Record<string, string>;
  /** topic key -> model chosen with /model (missing = config default) */
  models: Record<string, string>;
  /** topic key -> thinking level chosen with /thinking (missing = config default) */
  efforts: Record<string, string>;
  /** model alias -> full id it last ran as (from claude's init line), for labels like "Sonnet 5.5" */
  modelIds: Record<string, string>;
  /** last plan usage seen from claude (see server-status.ts PlanUsage) */
  planUsage?: unknown;
  /** time zone from /timezone (missing = config default) */
  timeZone?: string;
  /** user id -> message_thread_id of their notifications topic */
  infoThreads: Record<string, number>;
  /** topic key -> its name; sure = seen when made or renamed (safe to use for the existence check) */
  topicNames: Record<string, { name: string; sure: boolean }>;
  /** plan-usage warnings already sent (see limits.ts) */
  limitWarned?: { fiveHour?: string; week?: string };
  /** "working…" messages of replies in progress, so a restart can mark them as cut off */
  working: Record<string, { chatId: number; messageId: number }>;
};

const emptyState = (): StateData => ({
  allowed: [],
  pending: {},
  sessions: {},
  models: {},
  efforts: {},
  modelIds: {},
  infoThreads: {},
  topicNames: {},
  working: {},
});

export class State {
  private readonly file: string;
  private data: StateData;

  constructor(file: string) {
    this.file = file;
    this.data = emptyState();
    this.loadSync();
  }

  private lockDepth = 0;

  /**
   * Runs a read-change-write under a lock file, so the bot and the j-claude-telegram command
   * never overwrite each other's changes. Re-entrant; a lock older than 5 s is taken as stale.
   */
  private withLock<T>(fn: () => T): T {
    if (this.lockDepth > 0) {
      this.lockDepth++;
      try {
        return fn();
      } finally {
        this.lockDepth--;
      }
    }
    const lock = `${this.file}.lock`;
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const deadline = Date.now() + 3000;
    for (;;) {
      try {
        mkdirSync(lock);
        break;
      } catch {
        try {
          if (Date.now() - statSync(lock).mtimeMs > 5000) rmSync(lock, { recursive: true, force: true });
        } catch {
          /* gone meanwhile */
        }
        if (Date.now() > deadline) break; // never hang: go ahead without it
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    this.lockDepth = 1;
    try {
      this.loadSync();
      return fn();
    } finally {
      this.lockDepth = 0;
      rmSync(lock, { recursive: true, force: true });
    }
  }

  private loadSync(): void {
    if (!existsSync(this.file)) {
      this.data = emptyState();
      return;
    }
    const raw = JSON.parse(readFileSync(this.file, "utf8")) as StateData;
    this.data = {
      allowed: raw.allowed ?? [],
      pending: raw.pending ?? {},
      sessions: raw.sessions ?? {},
      models: raw.models ?? {},
      efforts: raw.efforts ?? {},
      modelIds: raw.modelIds ?? {},
      planUsage: raw.planUsage,
      timeZone: raw.timeZone,
      infoThreads: raw.infoThreads ?? {},
      topicNames: raw.topicNames ?? {},
      limitWarned: raw.limitWarned,
      working: raw.working ?? {},
    };
    this.pruneExpiredPending();
  }

  private pruneExpiredPending(): void {
    const now = Date.now();
    let changed = false;
    for (const [code, entry] of Object.entries(this.data.pending)) {
      if (now - entry.at > PAIR_EXPIRY_MS) {
        delete this.data.pending[code];
        changed = true;
      }
    }
    void changed; // saved with the next write (which holds the lock)
  }

  isAllowed(userId: number): boolean {
    this.loadSync(); // another process (the allow command) may have changed the file
    return this.data.allowed.includes(userId);
  }

  newPairCode(userId: number): string {
    return this.withLock(() => {
      this.loadSync(); // another process (the allow command) may have changed the file
      // one live code per person, and never more than MAX_PENDING waiting in total
      for (const [c, e] of Object.entries(this.data.pending)) if (e.userId === userId) delete this.data.pending[c];
      const waiting = Object.entries(this.data.pending).sort((a, b) => a[1].at - b[1].at);
      while (waiting.length >= MAX_PENDING) delete this.data.pending[waiting.shift()![0]];
      let code: string;
      do {
        code = "";
        for (let i = 0; i < 6; i++) {
          code += PAIR_ALPHABET[randomInt(PAIR_ALPHABET.length)];
        }
      } while (this.data.pending[code]);
  
      this.data.pending[code] = { userId, at: Date.now() };
      this.persist();
      return code;
    });
  }

  allow(code: string): number | null {
    return this.withLock(() => {
      this.loadSync(); // another process (the allow command) may have changed the file
      const entry = this.data.pending[code];
      if (!entry) {
        return null;
      }
      if (Date.now() - entry.at > PAIR_EXPIRY_MS) {
        delete this.data.pending[code];
        this.persist();
        return null;
      }
      delete this.data.pending[code];
      if (!this.data.allowed.includes(entry.userId)) {
        this.data.allowed.push(entry.userId);
      }
      this.persist();
      return entry.userId;
    });
  }

  sessionFor(key: string): string | undefined {
    this.loadSync(); // another process (the allow command) may have changed the file
    return this.data.sessions[key];
  }

  setSession(key: string, id: string): void {
    return this.withLock(() => {
      this.loadSync(); // another process (the allow command) may have changed the file
      this.data.sessions[key] = id;
      this.persist();
    });
  }

  modelFor(key: string): string | undefined {
    this.loadSync();
    return this.data.models[key];
  }

  setModel(key: string, model: string): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.models[key] = model;
      this.persist();
    });
  }

  effortFor(key: string): string | undefined {
    this.loadSync();
    return this.data.efforts[key];
  }

  setEffort(key: string, level: string): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.efforts[key] = level;
      this.persist();
    });
  }

  modelIdFor(alias: string): string | undefined {
    this.loadSync();
    return this.data.modelIds[alias];
  }

  noteModelId(alias: string, id: string): void {
    return this.withLock(() => {
      this.loadSync();
      if (this.data.modelIds[alias] === id) return;
      this.data.modelIds[alias] = id;
      this.persist();
    });
  }

  planUsage(): unknown {
    this.loadSync();
    return this.data.planUsage;
  }

  setPlanUsage(u: unknown): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.planUsage = u;
      this.persist();
    });
  }

  timeZone(): string | undefined {
    this.loadSync();
    return this.data.timeZone;
  }

  setTimeZone(zone: string): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.timeZone = zone;
      this.persist();
    });
  }

  /** Removes a person from the allow list; true when they were on it. */
  disallow(userId: number): boolean {
    return this.withLock(() => {
      const before = this.data.allowed.length;
      this.data.allowed = this.data.allowed.filter((u) => u !== userId);
      this.persist();
      return this.data.allowed.length < before;
    });
  }

  pendingCount(): number {
    this.loadSync();
    return Object.keys(this.data.pending).length;
  }

  allowedUsers(): number[] {
    this.loadSync();
    return [...this.data.allowed];
  }

  infoThreadFor(userId: number): number | undefined {
    this.loadSync();
    return this.data.infoThreads[String(userId)];
  }

  setInfoThread(userId: number, threadId: number): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.infoThreads[String(userId)] = threadId;
      this.persist();
    });
  }

  clearInfoThread(userId: number): void {
    return this.withLock(() => {
      this.loadSync();
      delete this.data.infoThreads[String(userId)];
      this.persist();
    });
  }

  topicName(key: string): { name: string; sure: boolean } | undefined {
    this.loadSync();
    return this.data.topicNames[key];
  }

  /** A guessed name (sure=false) never replaces a sure one. */
  noteTopicName(key: string, name: string, sure: boolean): void {
    return this.withLock(() => {
      this.loadSync();
      const cur = this.data.topicNames[key];
      if (cur && cur.sure && !sure) return;
      if (cur && cur.name === name && cur.sure === sure) return;
      this.data.topicNames[key] = { name, sure };
      this.persist();
    });
  }

  /** Every topic key the bot knows something about. */
  knownTopics(): string[] {
    this.loadSync();
    return [...new Set([...Object.keys(this.data.sessions), ...Object.keys(this.data.topicNames)])];
  }

  /** Drops everything about a deleted topic; returns its conversation id, if any. */
  forgetTopic(key: string): string | undefined {
    return this.withLock(() => {
      this.loadSync();
      const id = this.data.sessions[key];
      delete this.data.sessions[key];
      delete this.data.models[key];
      delete this.data.efforts[key];
      delete this.data.topicNames[key];
      this.persist();
      return id;
    });
  }

  limitWarned(): { fiveHour?: string; week?: string } {
    this.loadSync();
    return this.data.limitWarned ?? {};
  }

  setLimitWarned(w: { fiveHour?: string; week?: string }): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.limitWarned = w;
      this.persist();
    });
  }

  setWorking(key: string, chatId: number, messageId: number): void {
    return this.withLock(() => {
      this.loadSync();
      this.data.working[key] = { chatId, messageId };
      this.persist();
    });
  }

  clearWorking(key: string): void {
    return this.withLock(() => {
      this.loadSync();
      if (!this.data.working[key]) return;
      delete this.data.working[key];
      this.persist();
    });
  }

  /** Takes all recorded "working…" messages (used once at start). */
  takeWorking(): Array<{ key: string; chatId: number; messageId: number }> {
    this.loadSync();
    const all = Object.entries(this.data.working).map(([key, w]) => ({ key, ...w }));
    this.data.working = {};
    this.persist();
    return all;
  }

  clearSession(key: string): void {
    return this.withLock(() => {
      this.loadSync(); // another process (the allow command) may have changed the file
      delete this.data.sessions[key];
      this.persist();
    });
  }

  private persist(): void {
    const dir = dirname(this.file);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = join(dir, `.state-${process.pid}-${Date.now()}.tmp`);
    const body = JSON.stringify(this.data, null, 2) + "\n";
    writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
    renameSync(tmp, this.file);
    chmodSync(this.file, 0o600);
  }
}