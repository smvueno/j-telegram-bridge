# J Telegram Bridge

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
- **Push notifications.** `j-telegram-bridge notify` posts to the 📣 Info topic from anywhere on
  the server: cron jobs, scheduled tasks, any Claude session. Info stays clean: anything you
  write there (a question, a reply to a notification) moves to a new topic of its own, named
  after the notification, and Claude answers there.
- **A useful `/status`.** Model and thinking, your Claude plan usage (5-hour and weekly, with
  reset times), CPU, memory, disk, and the top 5 processes by CPU and by memory.
- **Proper formatting.** Bold, code, lists, quotes and links show as Telegram formatting.
- **Photos and files** you send reach Claude; Claude can send files back.
- **Cleans up after itself.** Delete a topic in Telegram and, within 15 minutes, its running
  Claude is stopped and its conversation history and files are deleted from the server.
  (Pin 📣 Info yourself: long-press it → Pin. Bots cannot pin topics.)
- **Locked to you.** Only paired Telegram accounts get anything; groups are ignored.
- **Keeps itself running.** systemd restarts it on crashes and at boot, and a health check
  restarts it if it freezes. A reply cut off by a restart is marked as such, never left hanging.
- **Warns before your limit.** One notification in 📣 Info when the 5-hour or weekly Claude
  limit passes 90%, and one when it is reached.

## Commands in Telegram

| Command | What it does |
|---|---|
| `/model` | Pick the model (with its version), then the thinking level |
| `/new` | Fresh conversation in this topic (deletes the old one; keeps the model) |
| `/stop` | Stop the reply being written |
| `/status` | Claude, plan usage, server load, top processes |
| `/timezone <city>` | Show times in your zone while you travel |

## Install

You need: a Linux server with systemd, [Claude Code](https://code.claude.com) installed and
logged in, [Bun](https://bun.sh), and a Telegram account.

### With Claude (recommended)

In Claude Code on the server:

```
/plugin marketplace add smvueno/j-telegram-bridge
/plugin install j-telegram-bridge@j-telegram-bridge
```

Then ask Claude: **"set up J Telegram Bridge"**. The `j-telegram-bridge:setup` skill walks
you through making the bot in @BotFather, saving the token, installing the service and pairing
your account.

### By hand

1. In Telegram, **@BotFather** → `/newbot`. Then turn on **Threaded mode**: open the chat with
   @BotFather, tap **Open App** (the button next to the message field), pick your bot and
   switch on Threaded mode in its settings. Optional: send `/setjoingroups` → Disable.
2. Save the token where only you can read it:
   ```bash
   mkdir -p -m 700 ~/.claude/channels/j-telegram-bridge
   ( umask 077; printf 'TELEGRAM_BOT_TOKEN=%s\n' 'PASTE_TOKEN' > ~/.claude/channels/j-telegram-bridge/bot.env )
   ```
3. Install: `bash deploy/install.sh   # from this plugin's folder`
4. Message your bot. It answers with a code. Run `j-telegram-bridge allow <code>`.
5. Test: `j-telegram-bridge notify -l done -t "It works" "Hello from the server"`

## Notifications

```bash
j-telegram-bridge notify [-l info|done|warn|alert] [-t TITLE] [-s] [-f /path/file] [message | -]
```

- Levels show as ℹ️ ✅ ⚠️ 🚨. `-s` delivers without sound. `-f` attaches files.
- Without a message (or with `-`) the text is read from stdin, handy for scripts:
  `backup.sh 2>&1 | tail -5 | j-telegram-bridge notify -l warn -t "Backup failed" -`
- With the plugin installed, every Claude session on the server has the `j-telegram-bridge:notify`
  skill: it knows when a notification is worth sending, how to write one for a lock screen,
  and what must never go in one (secrets, other people's personal data).

## What it runs, sends and fetches

So you know exactly what you install:

- **Runs on your server:** a Bun program (`bot/`) as a systemd service, started by the
  installer (`deploy/install.sh`) only when you run it. It starts the `claude` command you
  already have, one per active Telegram topic, with `--permission-mode auto`, in `workDir`.
  The installer also adds the `j-telegram-bridge` command and a 5-minute health-check timer.
  The plugin itself only adds two skills; it has no hooks and no MCP servers.
- **Sends to Telegram** (api.telegram.org, the Bot API): Claude's answers, the "working…"
  status, files Claude names with `SEND_FILE:` (never from private folders), notifications,
  and `/status` (plan usage, CPU, memory, disk, top processes). Nothing goes to anyone but the
  Telegram accounts you paired.
- **Fetches from Telegram:** your messages and the photos and files you send, by long polling.
- **Sends to Anthropic:** only what Claude Code itself sends when it answers, under your own
  Claude login and plan.
- **Fetches at install:** the bot's one dependency, [grammy](https://grammy.dev), from the npm
  registry (`bun install` with the lockfile). The setup skill may suggest installing Bun from
  bun.sh; it asks first.
- **Stores on your server:** in `~/.claude/channels/j-telegram-bridge/`: the bot token
  (`bot.env`, owner-only), who is paired, which topic has which conversation, choices per topic,
  and the files you sent (deleted after 30 days, or with their topic). Claude's conversations
  are stored by Claude Code as usual and deleted with their topic or by `/new`.
- **No telemetry, no analytics,** no other servers.

## Settings

`~/.claude/channels/j-telegram-bridge/config.json` is created on first start. Restart the
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
| `showSteps` | `true` | Show commands and paths in the "working…" message |
| `maxWaiting` | `20` | Messages that may wait per topic |
| `topicSweepMinutes` | `15` | How often to look for deleted topics (0 = never) |
| `inboxKeepDays` | `30` | Delete files sent to the bot after this many days (0 = keep) |
| `limitWarnAt` | `0.9` | Notify when plan usage passes this share (0 = never) |

`J_TELEGRAM_BRIDGE_HOME` moves the whole private folder elsewhere.

## Security

Read [SECURITY.md](https://github.com/smvueno/j-telegram-bridge/blob/main/SECURITY.md) before you pair anyone. In short: whoever can use the bot can
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
cd bot
bun install
bun test
bash ../deploy/install.sh --in-place   # run the service from this checkout
```

How it works inside: [docs/ARCHITECTURE.md](https://github.com/smvueno/j-telegram-bridge/blob/main/docs/ARCHITECTURE.md).

## License

MIT

J Telegram Bridge is an independent project. It is not made, affiliated with or endorsed by
Anthropic. Claude and Claude Code are trademarks of Anthropic.
