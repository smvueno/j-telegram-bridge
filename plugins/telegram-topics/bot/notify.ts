import { GrammyError, InputFile, type Api } from "grammy";
import type { State } from "./state";
import { splitMessage } from "./text";

/** How urgent a notification is; the icon is the first thing on the phone's lock screen. */
export const LEVELS = {
  info: "ℹ️",
  done: "✅",
  warn: "⚠️",
  alert: "🚨",
} as const;
export type Level = keyof typeof LEVELS;

export function isLevel(v: string): v is Level {
  return Object.hasOwn(LEVELS, v);
}

/** "🚨 Title\n\nbody" (no title: "🚨 body"). */
export function formatNotification(n: { title?: string; body: string; level: Level }): string {
  const icon = LEVELS[n.level];
  const title = n.title?.trim();
  const body = n.body.trim();
  if (title && body) return `${icon} ${title}\n\n${body}`;
  return `${icon} ${title || body}`;
}

const IMAGE = /\.(jpe?g|png|gif|webp)$/i;

function threadGone(e: unknown): boolean {
  return e instanceof GrammyError && /thread not found|topic.*(deleted|closed)|TOPIC_/i.test(e.description);
}

/**
 * The "📣 Info" topic in this person's private chat with the bot (private chat id = user id).
 * Made on first use and remembered. undefined when topics are off for the bot (BotFather >
 * Threaded mode): notifications then go to the main chat.
 */
export async function ensureInfoTopic(
  api: Api,
  state: State,
  userId: number,
  name: string,
): Promise<number | undefined> {
  const known = state.infoThreadFor(userId);
  if (known) return known;
  try {
    const topic = await api.createForumTopic(userId, name);
    state.setInfoThread(userId, topic.message_thread_id);
    state.noteTopicName(`${userId}:${topic.message_thread_id}`, name, true);
    return topic.message_thread_id;
  } catch {
    return undefined;
  }
}

export type SendResult = { sent: number; errors: string[] };

/** Send one notification to every allowed person's Info topic. Files go after the text. */
export async function sendNotification(
  api: Api,
  state: State,
  opts: { topicName: string; title?: string; body: string; level: Level; silent?: boolean; files?: string[] },
): Promise<SendResult> {
  const text = formatNotification(opts);
  const result: SendResult = { sent: 0, errors: [] };
  const users = state.allowedUsers();
  if (users.length === 0) {
    result.errors.push("Nobody is paired with the bot yet.");
    return result;
  }
  for (const userId of users) {
    const deliver = async (thread: number | undefined) => {
      const extra = {
        ...(thread ? { message_thread_id: thread } : {}),
        disable_notification: opts.silent ?? false,
      };
      for (const part of splitMessage(text)) await api.sendMessage(userId, part, extra);
      for (const f of opts.files ?? []) {
        const file = new InputFile(f);
        if (IMAGE.test(f)) await api.sendPhoto(userId, file, extra);
        else await api.sendDocument(userId, file, extra);
      }
    };
    try {
      let thread = await ensureInfoTopic(api, state, userId, opts.topicName);
      try {
        await deliver(thread);
      } catch (e) {
        if (!thread || !threadGone(e)) throw e;
        // the Info topic was deleted in Telegram: make a new one once
        state.clearInfoThread(userId);
        thread = await ensureInfoTopic(api, state, userId, opts.topicName);
        await deliver(thread);
      }
      result.sent += 1;
    } catch (e) {
      result.errors.push(e instanceof Error ? e.message.slice(0, 200) : String(e));
    }
  }
  return result;
}
