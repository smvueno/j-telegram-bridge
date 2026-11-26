import { readFile } from "node:fs/promises";
import { TOKEN_FILE } from "./paths";

/** The bot token: TELEGRAM_BOT_TOKEN in the environment, else the TELEGRAM_BOT_TOKEN= line in bot.env. Never log it. */
export async function loadToken(): Promise<string> {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  let raw: string;
  try {
    raw = await readFile(TOKEN_FILE, "utf8");
  } catch {
    throw new Error(`No bot token: put TELEGRAM_BOT_TOKEN=... in ${TOKEN_FILE}`);
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^TELEGRAM_BOT_TOKEN=(.*)$/);
    if (m) {
      let v = m[1]!.trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (v) return v;
    }
  }
  throw new Error(`No TELEGRAM_BOT_TOKEN line in ${TOKEN_FILE}`);
}
