type KeyQueue = {
  pending: Array<() => Promise<void>>;
  running: boolean;
};

export class TopicQueue {
  private readonly maxParallel: number;
  private activeCount = 0;
  private readonly keys = new Map<string, KeyQueue>();

  constructor(maxParallel: number) {
    this.maxParallel = maxParallel;
  }

  /** Queues a job; false (and nothing queued) when maxWaiting jobs already wait for this key. */
  push(key: string, job: () => Promise<void>, maxWaiting = Infinity): boolean {
    let kq = this.keys.get(key);
    if (!kq) {
      kq = { pending: [], running: false };
      this.keys.set(key, kq);
    }
    if (kq.pending.length >= maxWaiting) return false;
    kq.pending.push(job);
    this.pump();
    return true;
  }

  running(key: string): boolean {
    return this.keys.get(key)?.running ?? false;
  }

  waiting(key: string): number {
    return this.keys.get(key)?.pending.length ?? 0;
  }

  /** Throws away jobs still waiting for this key (the running one is not touched). Returns how many. */
  drop(key: string): number {
    const kq = this.keys.get(key);
    if (!kq) return 0;
    const n = kq.pending.length;
    kq.pending = [];
    return n;
  }

  status(): { running: string[]; waiting: number } {
    const running: string[] = [];
    let waiting = 0;
    for (const [key, kq] of this.keys) {
      if (kq.running) running.push(key);
      waiting += kq.pending.length;
    }
    return { running, waiting };
  }

  private pump(): void {
    for (const [key, kq] of this.keys) {
      if (this.activeCount >= this.maxParallel) break;
      if (kq.pending.length > 0 && !kq.running) {
        this.startKey(key, kq);
      }
    }
  }

  private startKey(_key: string, kq: KeyQueue): void {
    kq.running = true;
    this.activeCount++;
    const job = kq.pending.shift()!;
    void (async () => {
      try {
        await job();
      } catch {
        // later jobs for this key still run
      } finally {
        kq.running = false;
        this.activeCount--;
        this.pump();
      }
    })();
  }
}