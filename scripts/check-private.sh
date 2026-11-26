#!/usr/bin/env bash
# Run before pushing: fails when something private seems to be in the files git would publish.
# Add your own names, ids or domains to PRIVATE_WORDS (one regex, case-insensitive), e.g.
#   PRIVATE_WORDS='alice|example\.com|123456789' bash scripts/check-private.sh
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
fail=0
files=$(git ls-files --cached --others --exclude-standard)
check() { # label, regex
  local hits
  hits=$(printf '%s\n' "$files" | xargs -d '\n' grep -n -I -E -i -- "$2" 2>/dev/null | grep -v -E '^scripts/check-private\.sh:')
  if [[ -n "$hits" ]]; then printf '✗ %s\n%s\n\n' "$1" "$hits"; fail=1; fi
}
check "Telegram bot token" '[0-9]{8,10}:AA[A-Za-z0-9_-]{30,}'
check "API key or token" '(sk-ant-|sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|github_pat_|xox[bp]-|AKIA[0-9A-Z]{16})'
check "private key" 'BEGIN [A-Z ]*PRIVATE KEY'
check "email address" '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(com|net|org|io|dev|jp|dk|de|co)\b'
[[ -n "${PRIVATE_WORDS:-}" ]] && check "your private words" "$PRIVATE_WORDS"
for f in $files; do
  case "$f" in *.env|*/state.json|*/config.json|*/heartbeat|*/inbox/*) echo "✗ private file tracked: $f"; fail=1;; esac
done
[[ $fail -eq 0 ]] && echo "✓ nothing private found"
exit $fail
