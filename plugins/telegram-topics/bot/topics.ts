export class TopicTracker {
  private readonly graceMs: number;
  private readonly recent = new Map<number, { threadId: number; at: number }>();

  constructor(graceMs: number) {
    this.graceMs = graceMs;
  }

  noteNewTopic(chatId: number, threadId: number, now: number): void {
    this.recent.set(chatId, { threadId, at: now });
  }

  keyFor(chatId: number, threadId: number | undefined, now: number): string {
    if (threadId !== undefined) {
      return `${chatId}:${threadId}`;
    }
    const hit = this.recent.get(chatId);
    if (hit && now - hit.at < this.graceMs) {
      return `${chatId}:${hit.threadId}`;
    }
    return `${chatId}:0`;
  }
}