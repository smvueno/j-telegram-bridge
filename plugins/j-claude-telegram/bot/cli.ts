import { existsSync } from "node:fs";
import { Api } from "grammy";
import { loadConfig } from "./config";
import { sendNotification } from "./notify";
import { NOTIFY_USAGE, parseNotifyArgs } from "./notify-args";
import { STATE_DIR, STATE_FILE } from "./paths";
import { State } from "./state";
import { loadToken } from "./token";

const USAGE = `j-claude-telegram: helper for the J Claude Telegram bot

  j-claude-telegram notify [options] [message]   push a notification (see: notify --help)
  j-claude-telegram allow <code>                 let the person who got this pairing code use the bot
  j-claude-telegram list                         who may use the bot
  j-claude-telegram disallow <user id>           take someone off the list`;

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === "allow") {
    const code = rest[0];
    if (!code) {
      console.error("Usage: j-claude-telegram allow <code>");
      return 2;
    }
    const state = new State(STATE_FILE);
    const before = state.allowedUsers();
    const userId = state.allow(code);
    if (userId === null) {
      console.log("No such code");
      return 1;
    }
    console.log(`Allowed user ${userId}`);
    // tell everyone already paired, so a pairing nobody expected is noticed at once
    if (before.length > 0 && !before.includes(userId)) {
      const config = await loadConfig(STATE_DIR);
      const api = new Api(await loadToken(), { apiRoot: config.telegramApiRoot });
      const others = new State(STATE_FILE);
      await sendNotification(api, others, {
        topicName: config.infoTopicName,
        level: "alert",
        title: "Someone new can use the bot",
        body: `Telegram user ${userId} was just paired on the server. If that was not you: j-claude-telegram disallow ${userId}`,
      }).catch(() => {});
    }
    return 0;
  }

  if (sub === "list") {
    const state = new State(STATE_FILE);
    const users = state.allowedUsers();
    console.log(users.length ? users.map((u) => `${u}`).join("\n") : "Nobody is paired.");
    const waiting = state.pendingCount();
    if (waiting) console.log(`(${waiting} pairing code${waiting === 1 ? "" : "s"} waiting)`);
    return 0;
  }

  if (sub === "disallow") {
    const id = Number(rest[0]);
    if (!Number.isInteger(id) || id <= 0) {
      console.error("Usage: j-claude-telegram disallow <user id>   (see: j-claude-telegram list)");
      return 2;
    }
    const removed = new State(STATE_FILE).disallow(id);
    console.log(removed ? `Removed user ${id}. Restart the bot to close their open Claudes.` : `User ${id} was not on the list.`);
    return removed ? 0 : 1;
  }

  if (sub === "notify") {
    let args;
    try {
      args = parseNotifyArgs(rest);
    } catch (e) {
      console.error(e instanceof Error ? e.message : String(e));
      console.error(NOTIFY_USAGE);
      return 2;
    }
    if (args === "help") {
      console.log(NOTIFY_USAGE);
      return 0;
    }
    let body = args.message;
    if (body === null) {
      if (process.stdin.isTTY) {
        console.error("No message. Give it after the options, or pipe it in.");
        return 2;
      }
      const raw = await Bun.stdin.text();
      if (raw.length > 100_000) {
        console.error("Message too long (over 100 000 characters). Send the important part, or attach a file with -f.");
        return 2;
      }
      body = raw.trim();
    }
    if (!body && !args.title) {
      console.error("Empty message.");
      return 2;
    }
    for (const f of args.files) {
      if (!existsSync(f)) {
        console.error(`No such file: ${f}`);
        return 2;
      }
    }
    const config = await loadConfig(STATE_DIR);
    const api = new Api(await loadToken(), { apiRoot: config.telegramApiRoot });
    const res = await sendNotification(api, new State(STATE_FILE), {
      topicName: config.infoTopicName,
      title: args.title,
      body: body ?? "",
      level: args.level,
      silent: args.silent,
      files: args.files,
    });
    for (const err of res.errors) console.error(`Not sent: ${err}`);
    if (res.sent > 0) console.log(`Sent to ${res.sent} ${res.sent === 1 ? "person" : "people"}.`);
    return res.errors.length === 0 ? 0 : 1;
  }

  console.error(USAGE);
  return sub === undefined || sub === "help" || sub === "--help" ? 0 : 2;
}

process.exit(await main(process.argv.slice(2)));
