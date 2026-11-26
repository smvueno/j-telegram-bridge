import { isLevel, type Level } from "./notify";

export type NotifyArgs = {
  title?: string;
  level: Level;
  silent: boolean;
  files: string[];
  /** message words; null = read the message from stdin */
  message: string | null;
};

export const NOTIFY_USAGE = `Usage: j-telegram-bridge notify [options] [message]

Sends a push notification to the "📣 Info" topic of everyone paired with the bot.

Options:
  -t, --title TEXT     bold first line, e.g. "Backup finished"
  -l, --level LEVEL    info (ℹ️, default), done (✅), warn (⚠️), alert (🚨)
  -s, --silent         deliver without sound
  -f, --file PATH      attach a file (repeatable; pictures show as photos)
  -h, --help           this help

The message is the rest of the line, or stdin when it is "-" or left out:
  j-telegram-bridge notify -l done -t "Report ready" "12 new bookings, nothing to fix."
  some-command 2>&1 | tail -20 | j-telegram-bridge notify -l warn -t "Nightly job failed" -`;

/** Parses the words after "notify". Throws Error with a message for bad input. */
export function parseNotifyArgs(argv: string[]): NotifyArgs | "help" {
  const out: NotifyArgs = { level: "info", silent: false, files: [], message: null };
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "-h" || a === "--help") return "help";
    else if (a === "-t" || a === "--title") out.title = value();
    else if (a === "-l" || a === "--level") {
      const v = value().toLowerCase();
      if (!isLevel(v)) throw new Error(`Unknown level "${v}". Use info, done, warn or alert.`);
      out.level = v;
    } else if (a === "-s" || a === "--silent") out.silent = true;
    else if (a === "-f" || a === "--file") {
      const f = value();
      if (!f.startsWith("/")) throw new Error(`--file needs an absolute path: ${f}`);
      out.files.push(f);
    } else if (a === "--") {
      words.push(...argv.slice(i + 1));
      break;
    } else words.push(a);
  }
  out.message = words.length === 0 || (words.length === 1 && words[0] === "-") ? null : words.join(" ");
  return out;
}
