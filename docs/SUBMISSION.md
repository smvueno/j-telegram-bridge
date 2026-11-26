# Submitting to Anthropic's plugin directory

Checklist from Anthropic's docs: [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist),
[submit](https://claude.com/docs/plugins/submit), [publish](https://code.claude.com/docs/en/plugins/publish).

## Ready in this repo

- [x] `claude plugin validate --strict plugins/j-telegram-bridge` passes with no warnings
- [x] Name `j-telegram-bridge`, display name "J Telegram Bridge" (no reserved words, nothing that
      reads as Anthropic's own)
- [x] `plugin.json`: name, displayName, description, version, author, homepage, repository, license
- [x] README in the plugin folder (becomes the listing text), incl. "What it runs, sends and fetches"
- [x] LICENSE (MIT) in the plugin folder and at the root
- [x] Icon: `.claude-plugin/icon.png`, 1024×1024. **It becomes the listing icon permanently the
      first time the plugin is saved or submitted in the portal.**
- [x] Skills in `skills/<name>/SKILL.md` with valid front matter; no hooks, no MCP servers
- [x] No credentials in any file; the bot token is never read from environment variables
- [x] All files inside the plugin folder, readable source, under the size and count limits
- [x] Not-affiliated-with-Anthropic statement in both READMEs

## Expected reviewer holds (normal, not rejections)

- `bot/package.json` next to `bot/bun.lock` (a lockfile is held for a person to read)
- The bot is a non-shell program the installer starts (held for a person to read)

## Steps (owner only)

1. Make sure you are on a paid Claude plan and your GitHub account is connected on claude.ai
   with push access to `smvueno/j-telegram-bridge`.
2. Go to **claude.ai/directory/manage** → **Submit new** → **Plugin bundle**.
3. **Source:** `smvueno/j-telegram-bridge`, plugin path `plugins/j-telegram-bridge`, branch `main`.
4. **Validate**, then check the listing details it read from `plugin.json` and the README.
5. **Data handling:** answers below.
6. **Compliance:** your contact email and the four acknowledgements.
7. Updates: choose the GitHub push webhook (each push to `main` is picked up; raise `version`
   in `plugin.json` for every release).
8. **Submit for review.** The repository can stay private while you submit, but must be
   **public** before the listing goes live.

## Draft answers for "Data handling"

**Does the plugin read or store personal data?**
Yes, on the user's own server only. The bot receives the Telegram messages, photos and files
that the paired user sends to their own bot, and passes them to the user's own Claude Code.
It stores, in `~/.claude/channels/j-telegram-bridge/` (owner-only permissions): the bot token,
the numeric Telegram ids of paired users, which topic belongs to which Claude conversation,
per-topic choices, and files the user sent. Claude Code stores its conversations as usual.

**Does it send data to services other than its declared connectors?**
It has no connectors. It talks to the Telegram Bot API (api.telegram.org) to receive the
user's messages and send replies, files and notifications to the paired user's private chat,
and runs the user's own `claude` command (which talks to Anthropic under the user's login).
Nothing else: no telemetry, analytics or third-party servers. `bun install` fetches one
dependency (grammy) from the npm registry at install time.

**How long is data kept?**
Files sent to the bot: 30 days (setting `inboxKeepDays`), or until their topic is deleted or
cleared with `/new`. Conversations: until the topic is deleted or `/new`, otherwise Claude
Code's own retention (`cleanupPeriodDays`). Pairing and topic settings: until removed by the
user (`j-telegram-bridge disallow`, deleting the topic).

**Does it target people under 18?**
No. It is a developer tool for running Claude Code on your own server.
