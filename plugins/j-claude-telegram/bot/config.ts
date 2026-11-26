import { existsSync } from "node:fs";
import { readFile, writeFile, chmod } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export type Config = {
  maxParallel: number;
  timeoutMinutes: number;
  idleMinutes: number;
  /** Hard limit on Claude processes kept running at once. */
  maxWarm: number;
  /** Model for a topic that has not picked one with /model. */
  defaultModel: string;
  /** Thinking level (--effort) for a topic that has not picked one with /thinking. */
  defaultEffort: string;
  /** Time zone for times in messages until /timezone sets another. */
  timeZone: string;
  /** How Claude calls you in its system note ("You are talking to <ownerName> through Telegram"). */
  ownerName: string;
  /** The claude command. */
  claudeBin: string;
  /** Folder Claude works in. */
  workDir: string;
  /** Name of the notifications topic the bot creates in each allowed person's chat. */
  infoTopicName: string;
  /** How often to look for topics deleted in Telegram (their Claude, history and files are removed). 0 = never. */
  topicSweepMinutes: number;
  /** Seconds after start before the first deleted-topic check (tests use a short one). */
  topicSweepStartSeconds: number;
  /** Files sent to the bot are deleted after this many days (0 = keep). */
  inboxKeepDays: number;
  /** Notify in Info when the 5-hour or weekly plan usage passes this share (0 = never). */
  limitWarnAt: number;
  /** Telegram Bot API address; only changed for tests against a fake server. */
  telegramApiRoot: string;
  /** Show the tool steps (commands, file paths) in the "working…" message. */
  showSteps: boolean;
  /** Messages that may wait per topic; more are refused with a short note. */
  maxWaiting: number;
  editEveryMs: number;
  newTopicGraceMs: number;
  heartbeatSeconds: number;
};

const DEFAULT_CLAUDE =
  Bun.which("claude") ?? join(homedir(), ".local", "bin", "claude");

const DEFAULTS: Config = {
  maxParallel: 3,
  timeoutMinutes: 30,
  idleMinutes: 30,
  maxWarm: 3,
  defaultModel: "sonnet",
  defaultEffort: "medium",
  ownerName: "the owner",
  claudeBin: DEFAULT_CLAUDE,
  workDir: homedir(),
  infoTopicName: "📣 Info",
  topicSweepMinutes: 15,
  topicSweepStartSeconds: 60,
  inboxKeepDays: 30,
  limitWarnAt: 0.9,
  telegramApiRoot: "https://api.telegram.org",
  showSteps: true,
  maxWaiting: 20,
  // the server's own zone until /timezone sets another
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  editEveryMs: 3000,
  newTopicGraceMs: 60000,
  heartbeatSeconds: 60,
};

export async function loadConfig(dir: string): Promise<Config> {
  const path = join(dir, "config.json");
  if (!existsSync(path)) {
    await writeFile(path, JSON.stringify(DEFAULTS, null, 2) + "\n", "utf8");
    await chmod(path, 0o600);
    return { ...DEFAULTS };
  }
  const raw = JSON.parse(await readFile(path, "utf8")) as Partial<Config>;
  const merged = { ...DEFAULTS, ...raw };
  // goes into Claude's system prompt: one short line only
  const name = String(merged.ownerName ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 40);
  merged.ownerName = name || DEFAULTS.ownerName;
  return merged;
}