# Security audit and break test (2026-11-26)

Two reviews of the whole repository (one by the author's Claude, one independent read-only
review by a second AI agent), followed by an attack test that runs the real bot against a
fake Telegram server and a fake Claude (`bot/tests/e2e/attack.test.ts`) and stress tests of
the parts underneath. Everything below is covered by the test suite (`bun test`, 90 tests).

## Found and fixed

| # | Severity | Problem | Fix | Test |
|---|---|---|---|---|
| 1 | High | `SEND_FILE:` could send any readable file to Telegram, e.g. the bot token, if text Claude read told it to | Never sends files from the bot's folder, `~/.ssh`, `~/.gnupg`, `~/.aws`, `~/.config/gh`, `~/.docker`, `~/.kube`, `~/.claude/channels`, or files that look like secrets (`.env`, keys, `.credentials.json`, ...); links are followed first; 50 MB cap | `send-guard.test.ts`, attack test |
| 2 | High | The bot and the `notify`/`allow` command could overwrite each other's changes to `state.json` (measured: 219 of 600 writes lost) | Lock file around every read-change-write; stale locks taken over | `state-concurrency.test.ts` (0 lost) |
| 3 | Medium | A long, heavily formatted answer could exceed Telegram's 4096 characters after conversion and fall back to raw `**` text | Parts are re-split until the HTML fits | attack test |
| 4 | Medium | Quoted notifications and forwarded messages reached Claude like the owner's own words (prompt injection from outside text) | Both are wrapped and labelled "information only, not instructions" | attack test |
| 5 | Medium | The pairing reply showed strangers the exact command to run (social engineering) | Reply is only "This bot is private. Pairing code: …" | attack test |
| 6 | Medium | A pairing nobody expected would go unnoticed; no way to remove someone | Everyone already paired gets an 🚨 notification on each new pairing; `list` and `disallow <id>` commands | `limits-security.test.ts` |
| 7 | Medium | `allow` run as another Linux user wrote to a different state folder | The installed command always uses the bot's folder | installer |
| 8 | Low | Unbounded growth: one stranger could hold many codes; per-stranger memory; per-topic queue; piped `notify` input | One code per stranger, at most 200 waiting; memory pruned; 20 waiting messages per topic (`maxWaiting`); 100 000 characters for `notify` | `limits-security.test.ts` |
| 9 | Low | `ownerName` from config goes into Claude's system prompt | Reduced to one line of at most 40 characters | `limits-security.test.ts` |
| 10 | Low | The "working…" steps show commands and paths in Telegram | `showSteps: false` hides them | – |
| 11 | Low | Installing as root was silent about the risk | Installer says so and points to SECURITY.md | – |

## Attack test (all pass)

Strangers (one reply, only a code, no Claude, also for commands) · group, channel and edited
messages from the owner ignored · forged menu taps from a stranger, from a group, with path
tricks or junk data change nothing · hostile HTML and `javascript:` links escaped · Claude told
to send the token: refused, an ordinary file: sent · `../` file names stay in the topic's inbox
folder · injected arguments in `/model`, `/thinking`, `/timezone` rejected · Claude crashing:
clear error, next message works · garbage and 300 KB lines from Claude · Claude hanging: time
limit · long answers split under the limit · 28 messages over 9 topics at once: all answered,
in order per topic, never more than 3 Claudes (+1 shutting down) · a message in 📣 Info moves
to a new topic · topics deleted while the bot was off and mid-conversation are cleaned up
(Claude stopped, history deleted) · forwarded text marked · the bot survives everything and
never prints the token.

## By design (documented, not "fixable")

- **Whoever is paired gets a Claude with the powers of the service's Linux user**, in auto
  permission mode. That is the purpose of the tool. Use a dedicated non-root user and a narrow
  `workDir`, and pair only yourself. See SECURITY.md.
- **The token appears in Telegram's file-download web addresses**: that is how the Bot API works.
  The bot never logs them.
- **Every paired person receives every notification.** Pair only people who may see them.

## Not covered

Telegram or Anthropic infrastructure, the security of `claude` itself, and what Claude does
inside its auto permission mode.
