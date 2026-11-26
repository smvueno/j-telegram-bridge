#!/usr/bin/env bash
# Installs the J Telegram Bridge bot as an always-on systemd service.
#
#   bash install.sh             copy the bot to ~/.local/share/j-telegram-bridge and run it from there
#   bash install.sh --in-place  run the bot from this checkout (for development)
#
# Root gets a system service (/etc/systemd/system); any other user a user service.
# The token must already be in $J_TELEGRAM_BRIDGE_HOME/bot.env (see the j-telegram-bridge:setup skill).
set -euo pipefail

NAME=j-telegram-bridge
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../bot" && pwd)"
STATE="${J_TELEGRAM_BRIDGE_HOME:-$HOME/.claude/channels/j-telegram-bridge}"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

in_place=false
[[ "${1:-}" == "--in-place" ]] && in_place=true

# --- what we need --------------------------------------------------------------------------
command -v systemctl >/dev/null || die "systemd is needed (Linux)."
BUN="$(command -v bun || true)"; [[ -z "$BUN" && -x "$HOME/.bun/bin/bun" ]] && BUN="$HOME/.bun/bin/bun"
[[ -n "$BUN" ]] || die "Bun is needed: curl -fsSL https://bun.sh/install | bash"
CLAUDE="$(command -v claude || true)"; [[ -z "$CLAUDE" && -x "$HOME/.local/bin/claude" ]] && CLAUDE="$HOME/.local/bin/claude"
[[ -n "$CLAUDE" ]] || die "Claude Code is needed and must be logged in (claude --version)."

if "$CLAUDE" plugin list 2>/dev/null | grep -A4 -E '^\s*❯ telegram@' | grep -q 'enabled'; then
  say "Warning: Anthropic's 'telegram' plugin is enabled for this user. It polls the same bot"
  say "         and Telegram then refuses both (409). Disable it: claude plugin disable telegram@<marketplace>"
fi

# --- token ---------------------------------------------------------------------------------
mkdir -p -m 700 "$STATE"
[[ -s "$STATE/bot.env" ]] || die "No token. Put TELEGRAM_BOT_TOKEN=... in $STATE/bot.env first (see README)."
chmod 600 "$STATE/bot.env"

# --- code ----------------------------------------------------------------------------------
if $in_place; then
  APP="$SRC"
else
  APP="${J_TELEGRAM_BRIDGE_APP:-$HOME/.local/share/j-telegram-bridge}"
  mkdir -p "$APP"
  # copy the bot (no node_modules, no tests), keep nothing else there
  ( cd "$SRC" && tar --exclude=node_modules --exclude=tests -cf - . ) | ( cd "$APP" && tar -xf - )
fi
( cd "$APP" && "$BUN" install --production --frozen-lockfile >/dev/null 2>&1 || "$BUN" install --production >/dev/null )

# --- where things go -----------------------------------------------------------------------
if [[ $EUID -eq 0 ]]; then
  say "Note: installing as root. Anyone you pair can then make Claude do anything root can."
  say "      A dedicated non-root user with its own workDir is safer (see SECURITY.md)."
  BIN_DIR=/usr/local/bin
  UNIT_DIR=/etc/systemd/system
  SCTL=(systemctl)
  WANTED=multi-user.target
else
  BIN_DIR="$HOME/.local/bin"
  UNIT_DIR="$HOME/.config/systemd/user"
  SCTL=(systemctl --user)
  WANTED=default.target
fi
mkdir -p "$BIN_DIR" "$UNIT_DIR"
PATH_LINE="$(dirname "$CLAUDE"):$(dirname "$BUN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# command: j-telegram-bridge notify|allow
cat > "$BIN_DIR/$NAME" <<SH
#!/bin/sh
# always the bot's own private folder, whoever runs this
J_TELEGRAM_BRIDGE_HOME="$STATE" export J_TELEGRAM_BRIDGE_HOME
cd "$APP" && exec "$BUN" cli.ts "\$@"
SH
chmod 755 "$BIN_DIR/$NAME"

# health check: restart when the service is down or its heartbeat is older than 5 minutes (frozen)
cat > "$BIN_DIR/$NAME-check" <<SH
#!/bin/sh
HB="$STATE/heartbeat"
${SCTL[*]} is-active -q $NAME || { ${SCTL[*]} restart $NAME; exit 0; }
if [ -f "\$HB" ] && [ \$(( \$(date +%s) - \$(stat -c %Y "\$HB") )) -gt 300 ]; then
  echo "heartbeat too old, restarting"; ${SCTL[*]} restart $NAME
fi
SH
chmod 755 "$BIN_DIR/$NAME-check"

cat > "$UNIT_DIR/$NAME.service" <<UNIT
[Unit]
Description=J Telegram Bridge: Claude Code in Telegram topics (each topic is its own Claude conversation)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP
Environment=HOME=$HOME
Environment=PATH=$PATH_LINE
Environment=J_TELEGRAM_BRIDGE_HOME=$STATE
ExecStart=$BUN bot.ts
Restart=always
RestartSec=5
# the Claudes run as children; stop them with the bot
KillMode=control-group

[Install]
WantedBy=$WANTED
UNIT

cat > "$UNIT_DIR/$NAME-check.service" <<UNIT
[Unit]
Description=Health check for $NAME

[Service]
Type=oneshot
ExecStart=$BIN_DIR/$NAME-check
UNIT

cat > "$UNIT_DIR/$NAME-check.timer" <<UNIT
[Unit]
Description=Health check for $NAME every 5 minutes

[Timer]
OnBootSec=3min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

"${SCTL[@]}" daemon-reload
"${SCTL[@]}" enable --now "$NAME.service" "$NAME-check.timer" >/dev/null
"${SCTL[@]}" restart "$NAME.service"
sleep 4
"${SCTL[@]}" is-active -q "$NAME" || die "The service did not start. See: journalctl ${SCTL[1]:+--user }-u $NAME -n 50"

say "Installed. The bot runs from $APP as a ${SCTL[1]:+user }service ($NAME)."
if [[ $EUID -ne 0 ]] && ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  say "To keep it running after you log out (and start at boot): sudo loginctl enable-linger $USER"
fi
say "Next: message your bot in Telegram, then run: j-telegram-bridge allow <code>"
