# How it works

```
Telegram ⇄ bot.ts (Bun, grammy, long polling) ── one `claude -p --input-format stream-json` per active topic
                │                                    (warm-claude.ts, resumed by conversation id)
                ├─ state.json   allow list, topic → conversation, model/thinking per topic, plan usage
                └─ config.json  numbers and choices
j-telegram-bridge notify ──(Telegram Bot API)──▶ 📣 Info topic   (cli.ts, notify.ts; no polling)
```

## Files (`plugins/j-telegram-bridge/bot`)

| File | Job |
|---|---|
| `bot.ts` | Telegram side: access check, topics, commands, menus, files in and out, sending answers |
| `warm-claude.ts` | One long-running Claude per topic: streams steps, sends the answer at the model's `end_turn`, reports model id and plan usage |
| `queue.ts` | Messages in one topic wait their turn; topics run in parallel up to `maxParallel` |
| `pool.ts` | Which running Claude to close when `maxWarm` is reached (the quiet one used longest ago) |
| `topics.ts` | Topic key (`chat:thread`), incl. a guard for a Telegram bug where the first message of a new topic arrives without its topic id |
| `state.ts` | `state.json`, re-read before every use and written atomically (temp file, then rename), so the CLI and the bot never overwrite each other |
| `config.ts` | Defaults and `config.json` |
| `models.ts`, `timezone.ts`, `server-status.ts`, `text.ts` | Labels, times, `/status` sections, message splitting and `SEND_FILE:` lines |
| `notify.ts`, `notify-args.ts`, `cli.ts` | The `j-telegram-bridge` command: `notify` and `allow` |
| `history.ts` | Deletes a conversation's files; one inbox folder per topic |
| `paths.ts`, `token.ts`, `prompt.ts` | Private folder, token, the note added to Claude's system prompt |

## Decisions

- **Own program instead of Anthropic's telegram channel plugin.** That plugin feeds one
  interactive session; topics need one conversation each. Only one program may poll a bot,
  so the official plugin must be off for this user.
- **Headless `claude -p` kept running per topic**, not a new process per message: start-up
  (MCP servers, hooks, plugins) costs about 4 s; a running one answers in about 2 s.
- **Answer at `end_turn`.** Claude prints its final `result` about 1.5 s after the text is
  written; `--include-partial-messages` gives the model's own stop marker, so the answer goes
  out at once.
- **Auto permission mode.** There are no Allow/Deny buttons; Claude's auto mode decides. See
  [SECURITY.md](../SECURITY.md).
- **Notifications go straight to the Bot API** from the CLI (sending does not conflict with the
  bot's polling), so they work even while the bot restarts.
- **Deleted topics.** Telegram sends bots nothing when a topic is deleted. Every
  `topicSweepMinutes` the bot renames each known topic to the name it already has: no visible
  change, but `TOPIC_ID_INVALID` once it is gone. Then its Claude is stopped and its
  conversation file (`~/.claude/projects/*/<id>.jsonl`), settings and inbox folder are deleted.
  Names come from the topic being made or renamed, or (a guess) from its first message.
- **Plain text out.** Telegram's Markdown modes break on ordinary text; answers are sent as is.
