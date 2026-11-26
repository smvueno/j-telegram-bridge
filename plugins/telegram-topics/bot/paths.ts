import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the bot keeps its private files (token, allow list, sessions, config, inbox).
 * Never inside the code folder, so nothing private can end up in git.
 * Override with CLAUDE_TELEGRAM_HOME.
 */
export const STATE_DIR =
  process.env.CLAUDE_TELEGRAM_HOME ?? join(homedir(), ".claude", "channels", "telegram-topics");
export const STATE_FILE = join(STATE_DIR, "state.json");
export const TOKEN_FILE = join(STATE_DIR, "bot.env");
export const INBOX_DIR = join(STATE_DIR, "inbox");
export const HEARTBEAT_FILE = join(STATE_DIR, "heartbeat");
