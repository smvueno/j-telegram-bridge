import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Deletes a Claude Code conversation from disk: ~/.claude/projects/<folder>/<id>.jsonl and the
 * <id>/ folder next to it (subagent and tool files), in whichever project folder it is.
 * Returns how many files or folders were removed.
 */
export function deleteConversation(sessionId: string, claudeHome = join(homedir(), ".claude")): number {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return 0; // never build paths from anything else
  const projects = join(claudeHome, "projects");
  if (!existsSync(projects)) return 0;
  let removed = 0;
  for (const dir of readdirSync(projects)) {
    for (const target of [join(projects, dir, `${sessionId}.jsonl`), join(projects, dir, sessionId)]) {
      if (existsSync(target)) {
        rmSync(target, { recursive: true, force: true });
        removed += 1;
      }
    }
  }
  return removed;
}

/** Folder for files sent in one topic, so they can go when the topic goes. */
export function topicInboxDir(inboxDir: string, key: string): string {
  return join(inboxDir, key.replace(/[^0-9-]/g, "_"));
}
