import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

const MAX_BYTES = 50 * 1024 * 1024; // Telegram's limit for bots

/**
 * Whether Claude may send this file to Telegram with a SEND_FILE: line. Text Claude reads (a web
 * page, an email, a file) could ask it to send secrets; these are never sent, whatever it says.
 * Returns null when allowed, else the reason.
 */
export function refuseToSend(path: string, stateDir: string, home = homedir()): string | null {
  let real: string;
  try {
    real = realpathSync(path); // follow links, so a link to a secret is caught too
  } catch {
    return "file not found";
  }
  const st = statSync(real);
  if (!st.isFile()) return "not a file";
  if (st.size > MAX_BYTES) return "larger than Telegram's 50 MB limit";
  const inside = (dir: string) => {
    let d: string;
    try {
      d = realpathSync(dir);
    } catch {
      d = dir;
    }
    return real === d || real.startsWith(d + sep);
  };
  const privateDirs = [
    stateDir, // this bot's token, allow list, conversations
    join(home, ".ssh"),
    join(home, ".gnupg"),
    join(home, ".aws"),
    join(home, ".config", "gh"),
    join(home, ".docker"),
    join(home, ".kube"),
    join(home, ".claude", "channels"),
  ];
  if (privateDirs.some(inside)) return "private folder";
  const name = basename(real).toLowerCase();
  const privateNames = [
    /^\.env(\..*)?$/, /\.env$/, /^\.credentials\.json$/, /^\.netrc$/, /^\.pgpass$/, /^\.git-credentials$/,
    /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, /\.(pem|key|p12|pfx)$/, /^\.npmrc$/, /^\.pypirc$/,
  ];
  if (privateNames.some((r) => r.test(name))) return "looks like a secret";
  if (["/etc/shadow", "/etc/gshadow", "/etc/sudoers"].includes(real)) return "system secret";
  return null;
}
