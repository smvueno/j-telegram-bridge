# J Telegram Bridge

Use **Claude Code on your own Linux server from Telegram**: every topic in your private chat
with the bot is its own Claude conversation, with model and thinking level per topic, and a
**📣 Info** topic gets push notifications from Claude and your scheduled tasks.

This repository is a Claude Code plugin marketplace with one plugin,
[`j-telegram-bridge`](plugins/j-telegram-bridge): the bot, an installer for a systemd service,
and two skills (`j-telegram-bridge:notify` and `j-telegram-bridge:setup`).

```
/plugin marketplace add smvueno/j-telegram-bridge
/plugin install j-telegram-bridge@j-telegram-bridge
```

Then ask Claude: **"set up J Telegram Bridge"**.

- Full documentation, commands, settings and what it runs, sends and fetches:
  [plugins/j-telegram-bridge/README.md](plugins/j-telegram-bridge/README.md)
- Security model: [SECURITY.md](SECURITY.md) · latest audit: [docs/SECURITY-AUDIT.md](docs/SECURITY-AUDIT.md)
- How it works inside: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

MIT licence. J Telegram Bridge is an independent project, not made, affiliated with or
endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.
