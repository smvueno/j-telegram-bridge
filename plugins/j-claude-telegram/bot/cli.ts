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
  j-claude-telegram allow <code>                 let the person who got this pairing code use the bot`;

async function main(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === "allow") {
    const code = rest[0];
    if (!code) {
      console.error("Usage: j-claude-telegram allow <code>");
      return 2;
    }
    const userId = new State(STATE_FILE).allow(code);
    console.log(userId !== null ? `Allowed user ${userId}` : "No such code");
    return userId !== null ? 0 : 1;
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
      body = (await Bun.stdin.text()).trim();
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
    const api = new Api(await loadToken());
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
