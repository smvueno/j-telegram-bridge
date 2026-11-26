---
name: notify
description: Send a push notification to the owner's phone through the J Telegram Bridge bot (it lands in the "📣 Info" topic). Use when a scheduled or background task finishes or fails, when you need the owner's attention or a decision and they may not be watching, when a long job they started completes, or when the user asks to be notified, pinged, alerted or messaged on Telegram or their phone.
---

# Telegram notifications

The owner gets these as push notifications on their phone, in the **📣 Info** topic of their
private chat with the bot. Info holds only notifications: when they reply to one, the bot moves
the reply to a new topic named after the notification, and a Claude there sees which
notification they replied to.

## How to send one

```bash
j-telegram-bridge notify -l <level> -t "<title>" "<message>"
```

For anything longer than a line, or with quotes or `$` in it, pipe the message in so the
shell does not mangle it:

```bash
j-telegram-bridge notify -l warn -t "Nightly import failed" - <<'MSG'
The import stopped at step 3 of 5: the API answered 401 (login expired).
Nothing was changed. To fix: log in again in Settings, then run the import once.
MSG
```

Options: `-l info|done|warn|alert` (default info), `-t TITLE`, `-s` (no sound),
`-f /absolute/path` (attach a file, repeatable; pictures show as photos).
It prints `Sent to 1 person.` and exits 0 on success. On a non-zero exit, tell the user it
was not delivered and why (the error is printed). If `j-telegram-bridge` is not found, the
bot is not installed on this machine: say so instead of guessing another way.

## Pick the level

| Level | Icon | Use for |
|---|---|---|
| `done` | ✅ | a job finished as planned, with its result |
| `info` | ℹ️ | something worth knowing, no action needed |
| `warn` | ⚠️ | something went wrong or looks off, but nothing is on fire |
| `alert` | 🚨 | the owner must act or decide soon (service down, money, security, a blocked task) |

Use `-s` (silent) for low-priority `info` and routine `done`, so the phone does not buzz.

## Write it so it is useful on a lock screen

- **Title:** at most about 60 characters, the outcome first ("Backup finished", "Website down").
- **Body:** 1 to 5 short lines: what happened, the key number or result, and what the owner
  should do next (or "Nothing to do."). Plain text; no Markdown tables.
- **One notification per run.** Collect findings and send a single summary, not one per item.
- **Do not notify** when the owner is talking with you right now and can read your answer,
  unless they asked for it. Do not send routine "all good" messages unless the task exists to
  report them.

## Never put in a notification

- Secrets of any kind: tokens, API keys, passwords, cookies, private keys, connection strings.
  Say "the API key expired", never the key.
- Personal data about other people (customers, clients, contacts): no names, emails, phone
  numbers, addresses or message contents. Use counts, ids or neutral words ("a new booking for
  tomorrow 10:00", "3 unanswered threads").
- Whole logs or stack traces. Give the one line that matters; attach a file with `-f` only if
  it holds nothing from the two points above.

Telegram is an outside service: treat a notification as something that leaves the server.
