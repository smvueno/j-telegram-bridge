# Plan: shareable repo, info channel, notify skill (done)

1. **Shareable layout.** The repo is a plugin marketplace (`.claude-plugin/marketplace.json`)
   with one plugin in `plugins/j-telegram-bridge` (bot, skills, installer). Nothing personal in
   the code: owner name, Claude command, work folder and time zone are settings; private files
   live in `~/.claude/channels/j-telegram-bridge`, never in the repo. Fresh git history.
2. **Info channel.** `j-telegram-bridge notify` makes a "📣 Info" topic in each paired person's
   private chat on first use (Bot API `createForumTopic`; private chats need Threaded mode,
   without it the main chat is used), remembers it, and makes it again if it was deleted.
   Levels info/done/warn/alert, silent, files, stdin.
3. **Replies to notifications.** A reply to a bot message quotes that message to Claude
   (skipping the topic's own first message, which Telegram sets as the reply target of every
   message in a topic). Anything written in 📣 Info moves to a new topic ("Re: <notification
   title>" or the first words), the original is deleted from Info, and Claude answers there.
   Commands such as /status still answer in Info.
4. **Skills.** `j-telegram-bridge:notify` (when and how to notify, what never to include) and
   `j-telegram-bridge:setup` (install and pair, step by step).
5. **Installer.** `deploy/install.sh`: copies or runs in place, system service for root, user
   service otherwise, `j-telegram-bridge` command, 5-minute health check.
6. **Before every push:** `scripts/check-private.sh` scans for tokens, keys, emails and your own
   private words. Private GitHub repo first; public only when the owner decides.

Ideas for later: let the bot itself notify (plan usage above 90%, a crash it recovered from),
a Telegram-side mute for notifications, clean up old files in `inbox/`.
