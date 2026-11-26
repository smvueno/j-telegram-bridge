---
name: telegram-topics-setup
description: Install or check the Claude Telegram topics bot on this Linux server, so the user can talk to Claude Code from Telegram (one topic per conversation) and get push notifications. Use when the user asks to set up, install, pair, repair or update the Telegram topics bot, or asks how to use Claude from Telegram with this plugin.
user-invocable: true
---

# Set up the Telegram topics bot

Work through these steps with the user. Explain each in plain words; never print the bot
token back, never put it in a command line that ends up in shell history or logs.

The files of this plugin are next to this skill: the bot is in `../../bot` and the installer
is `../../deploy/install.sh` (relative to this skill's base directory, which is shown when
the skill loads).

## 1. Check the machine

- Linux with systemd (`systemctl --version`). macOS and Windows are not supported by the installer.
- Claude Code installed and logged in for the user who will run the bot (`claude --version`;
  a quick `claude -p "say ok"` must answer).
- Bun (`bun --version`). If missing, ask before installing it: `curl -fsSL https://bun.sh/install | bash`.
- Anthropic's official `telegram` plugin must **not** be enabled for this user
  (`claude plugin list`). It polls the same bot and makes Telegram refuse both (error 409).
  If it is enabled, ask the user, then `claude plugin disable telegram@<marketplace>`.

## 2. Make the bot in Telegram (the user does this)

1. In Telegram, open **@BotFather**, send `/newbot`, pick a name and a username ending in `bot`.
2. Turn on **Threaded mode** (topics in the private chat): in the chat with @BotFather tap
   **Open App** (next to the message field), pick the bot, and switch on Threaded mode in its
   settings. Without it everything works, but in one chat instead of topics.
3. Optional but recommended: `/setjoingroups` → Disable, so nobody can add it to groups.
4. Copy the token BotFather shows (`123456789:AA...`).

## 3. Save the token

Ask the user to paste the token. Write it without echoing it:

```bash
STATE="${CLAUDE_TELEGRAM_HOME:-$HOME/.claude/channels/telegram-topics}"
mkdir -p -m 700 "$STATE"
( umask 077; printf 'TELEGRAM_BOT_TOKEN=%s\n' "<token>" > "$STATE/bot.env" )
```

Check it works without printing it: `curl -s "https://api.telegram.org/bot$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$STATE/bot.env")/getMe"`
should say `"ok":true` and the bot's username. Tell the user the token is now in their chat
history with you and they can replace it later with `/revoke` in BotFather.

## 4. Install

Run the installer from this plugin (as the user who should run the bot; root works too):

```bash
bash <plugin>/deploy/install.sh
```

It copies the bot to `~/.local/share/claude-telegram-topics`, installs its packages, adds the
`claude-telegram` command, and starts a systemd service that restarts on crashes and at boot,
plus a 5-minute health check. For a non-root user it uses a user service and asks for
`loginctl enable-linger <user>` (needs sudo) so it keeps running after logout.

Optional settings (`~/.claude/channels/telegram-topics/config.json`, created on first start):
`ownerName` (how Claude calls the user), `workDir` (folder Claude works in, default home),
`defaultModel` (`sonnet`), `defaultEffort` (`medium`), `maxWarm` (Claudes kept running, 3),
`idleMinutes` (30), `timeZone`. Restart after changes: `systemctl restart claude-telegram`
(add `--user` for a user service).

## 5. Pair

1. The user sends any message to their bot. It answers with a pairing code.
2. Run `claude-telegram allow <code>`. Only do this for a code the user got themselves, never
   for one someone else sent them: it gives that Telegram account full use of Claude on this server.
3. Test: `claude-telegram notify -l done -t "Setup finished" "Notifications work."`
   A **📣 Info** topic appears in their chat with the notification.

## 6. Tell the user how to use it

- Each topic is its own Claude conversation, kept for later. `/model` (model, then thinking
  level), `/new`, `/stop`, `/status`, `/timezone`.
- Claude runs in auto permission mode as the service's user, in `workDir`. Anyone who can use
  the bot can do what that user can do. Keep the pairing list to people they fully trust.
- Logs: `journalctl -u claude-telegram` (add `--user` for a user service).
