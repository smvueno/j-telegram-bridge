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
/**
 * Name for the topic a message written in 📣 Info moves to: "Re: <notification title>" when it
 * replies to a notification (its first line without the level icon), else the first words of
 * the message. At most about 40 characters, cut at a word.
 */
export function topicNameFor(text: string, quoted?: string): string {
  const source = quoted
    ? (quoted.split("\n")[0] ?? "").replace(/^\p{Extended_Pictographic}️?\s*/u, "")
    : text;
  let name = source.replace(/\s+/g, " ").trim();
  if (!name) return quoted ? "Re: notification" : "New question";
  if (name.length > 40) {
    const cut = name.slice(0, 40);
    const space = cut.lastIndexOf(" ");
    name = `${(space > 20 ? cut.slice(0, space) : cut).trimEnd()}…`;
  }
  return quoted ? `Re: ${name}` : name;
}
