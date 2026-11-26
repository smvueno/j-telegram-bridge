# Security

This bot gives a Telegram chat a Claude Code that runs **on your server, as the Linux user
that runs the service, in auto permission mode**. Please read this before you install it.

## Who can use it

- Only Telegram accounts on the allow list get any answer. Everyone else gets one line with a
  pairing code (at most once per 10 minutes) and nothing more.
- A code does nothing until someone with access to the server runs `claude-telegram allow <code>`.
  **Never approve a code that someone sent you.** It gives that account the same power as you.
- The allow list holds numeric Telegram user ids, not usernames, so a changed or copied
  username does not get in.
- Group chats and channels are ignored completely, even for allowed people. Sharing the bot's
  link or adding it to a group gives nobody access. (You can also forbid groups in @BotFather
  with `/setjoingroups`.)

## What an allowed person can do

Claude runs with `--permission-mode auto`: actions it judges safe run without asking; risky
ones are blocked. That is a safety net, not a wall. Treat access to the bot like access to a
shell as that Linux user. To limit the damage:

- Run the bot as a dedicated non-root user that owns only what Claude should touch.
- Set `workDir` to the folder Claude should work in.
- Keep the allow list to yourself.

## The bot token

- Whoever has the token controls the bot (can read new messages to it and answer as it).
- It is stored in `~/.claude/channels/telegram-topics/bot.env`, readable only by its owner
  (folder 700, file 600), outside the code folder, and never logged.
- It is deliberately **not** in `~/.claude/channels/telegram/.env`, which Anthropic's official
  telegram plugin reads.
- The bot removes all `TELEGRAM_*` variables before it starts Claude, so Claude never sees it.
- If it may have leaked (pasted in a chat, a screenshot): `/revoke` in @BotFather, put the new
  token in `bot.env`, restart the service.

## What leaves the server

Your messages, Claude's answers, files you or Claude send, and notifications go through
Telegram's servers. Do not use it for data you are not allowed to give to Telegram. The
`telegram-notify` skill tells Claude never to put secrets or other people's personal data in a
notification.

## Private files

Everything private lives in `~/.claude/channels/telegram-topics/` (or `CLAUDE_TELEGRAM_HOME`):
`bot.env`, `state.json` (allow list, conversation ids, choices), `config.json`, `inbox/`
(files sent to the bot). None of it is in the repository, and `.gitignore` blocks those names
as an extra guard. Files in `inbox/` are not deleted automatically.

## Reporting a problem

Open a GitHub issue without details, or contact the owner of the repository privately.
