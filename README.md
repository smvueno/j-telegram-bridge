# Claude Telegram Topics

Use **Claude Code on your own Linux server from Telegram**. Every topic in your private chat
with the bot is its own Claude conversation, and a **📣 Info** topic gets push notifications
from Claude and your scheduled tasks.

It is a small always-on Bun program plus a Claude Code plugin with two skills. It talks to
the `claude` command you already have logged in on the server; nothing runs in anyone
else's cloud except Telegram and Claude itself.

## What you get

- **One topic = one conversation.** Turn on Threaded mode for your bot and start new topics
  with Telegram's own button. Each remembers its conversation, also after restarts
  (resume it on the server too: `/status` shows the `claude --resume` line).
- **Fast replies.** The Claude of a topic you are using stays running (at most 3 at once,
  closed after 30 minutes of quiet) and the answer is sent the moment it is written.
- **Model and thinking per topic.** `/model` shows the versions like the Claude app
  (Sonnet, Opus, Haiku), then asks the thinking level (Low to Max). Default: Sonnet, Medium.
- **Push notifications.** `claude-telegram notify` posts to the 📣 Info topic from anywhere on
  the server: cron jobs, scheduled tasks, any Claude session. Info stays clean: anything you
  write there (a question, a reply to a notification) moves to a new topic of its own, named
  after the notification, and Claude answers there.
- **A useful `/status`.** Model and thinking, your Claude plan usage (5-hour and weekly, with
  reset times), CPU, memory, disk, and the top 5 processes by CPU and by memory.
- **Photos and files** you send reach Claude; Claude can send files back.
- **Locked to you.** Only paired Telegram accounts get anything; groups are ignored.
- **Keeps itself running.** systemd restarts it on crashes and at boot, and a health check
  restarts it if it freezes.

## Commands in Telegram

| Command | What it does |
|---|---|
| `/model` | Pick the model (with its version), then the thinking level |
| `/new` | Fresh conversation in this topic (keeps its model) |
| `/stop` | Stop the reply being written |
| `/status` | Claude, plan usage, server load, top processes |
| `/timezone <city>` | Show times in your zone while you travel |

## Install

You need: a Linux server with systemd, [Claude Code](https://code.claude.com) installed and
logged in, [Bun](https://bun.sh), and a Telegram account.

### With Claude (recommended)

In Claude Code on the server:

```
/plugin marketplace add smvueno/claude-telegram-topics
/plugin install telegram-topics@claude-telegram-topics
```

Then ask Claude: **"set up the Telegram topics bot"**. The `telegram-topics-setup` skill walks
you through making the bot in @BotFather, saving the token, installing the service and pairing
your account.

### By hand

1. In Telegram, **@BotFather** → `/newbot`. Then turn on **Threaded mode**: open the chat with
   @BotFather, tap **Open App** (the button next to the message field), pick your bot and
   switch on Threaded mode in its settings. Optional: send `/setjoingroups` → Disable.
2. Save the token where only you can read it:
   ```bash
   mkdir -p -m 700 ~/.claude/channels/telegram-topics
   ( umask 077; printf 'TELEGRAM_BOT_TOKEN=%s\n' 'PASTE_TOKEN' > ~/.claude/channels/telegram-topics/bot.env )
   ```
3. Install: `bash plugins/telegram-topics/deploy/install.sh`
4. Message your bot. It answers with a code. Run `claude-telegram allow <code>`.
5. Test: `claude-telegram notify -l done -t "It works" "Hello from the server"`

## Notifications

```bash
claude-telegram notify [-l info|done|warn|alert] [-t TITLE] [-s] [-f /path/file] [message | -]
```

- Levels show as ℹ️ ✅ ⚠️ 🚨. `-s` delivers without sound. `-f` attaches files.
- Without a message (or with `-`) the text is read from stdin, handy for scripts:
  `backup.sh 2>&1 | tail -5 | claude-telegram notify -l warn -t "Backup failed" -`
- With the plugin installed, every Claude session on the server has the `telegram-notify`
  skill: it knows when a notification is worth sending, how to write one for a lock screen,
  and what must never go in one (secrets, other people's personal data).

## Settings

`~/.claude/channels/telegram-topics/config.json` is created on first start. Restart the
service after changing it.

| Key | Default | Meaning |
|---|---|---|
| `ownerName` | `the owner` | How Claude calls you |
| `workDir` | your home folder | Folder Claude works in |
| `claudeBin` | `claude` on PATH | The claude command |
| `defaultModel` | `sonnet` | Model for new topics |
| `defaultEffort` | `medium` | Thinking level for new topics |
| `maxWarm` | `3` | Claudes kept running at once |
| `idleMinutes` | `30` | Close a topic's Claude after this much quiet |
| `maxParallel` | `3` | Topics answering at the same time |
| `timeoutMinutes` | `30` | Longest a single reply may take |
| `timeZone` | the server's | Times in `/status` (also `/timezone`) |
| `infoTopicName` | `📣 Info` | Name of the notifications topic |

`CLAUDE_TELEGRAM_HOME` moves the whole private folder elsewhere.

## Security

Read [SECURITY.md](SECURITY.md) before you pair anyone. In short: whoever can use the bot can
make Claude do anything the service's Linux user can do. Pair only yourself or people you
fully trust, and keep the token private.

## Good to know

- **Anthropic's official `telegram` plugin must stay disabled** for the user running this bot.
  Both would poll the same bot and Telegram refuses both (error 409).
- Voice messages are saved but Claude cannot listen to audio.
- Replies use your Claude plan like any other Claude Code session.
- Tested on Ubuntu with root's system service. The non-root (user service) path of the
  installer has not been tried on a real machine yet.

## Development

```bash
cd plugins/telegram-topics/bot
bun install
bun test
bash ../deploy/install.sh --in-place   # run the service from this checkout
```

How it works inside: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## License

MIT
