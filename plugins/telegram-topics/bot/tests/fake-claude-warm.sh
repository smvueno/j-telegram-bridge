#!/usr/bin/env bash
set -euo pipefail

if [ -n "${FAKE_CLAUDE_LOG_ARGS:-}" ]; then
  printf '%s\n' "$@" >"$FAKE_CLAUDE_LOG_ARGS"
fi

mode="${FAKE_MODE:-ok}"

case "$mode" in
  ok)
    n=0
    while IFS= read -r _line || [ -n "${_line:-}" ]; do
      n=$((n + 1))
      printf '%s\n' "{\"type\":\"assistant\",\"message\":{\"id\":\"m${n}a\",\"content\":[{\"type\":\"tool_use\",\"name\":\"Bash\",\"input\":{\"command\":\"ls\"}}]}}"
      # model's own stop marker (claude --include-partial-messages); on even asks the end_turn
      # marker comes before the text line, to cover that order too
      printf '%s\n' '{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"tool_use"}}}'
      textline="{\"type\":\"assistant\",\"message\":{\"id\":\"m${n}b\",\"content\":[{\"type\":\"text\",\"text\":\"done ${n}\"}]}}"
      endline='{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"}}}'
      if [ $((n % 2)) -eq 0 ]; then printf '%s\n' "$endline" "$textline"; else printf '%s\n' "$textline" "$endline"; fi
      printf '%s\n' "{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"done ${n}\",\"session_id\":\"fake-session\"}"
    done
    exit 0
    ;;
  exit)
    IFS= read -r _line || true
    exit 3
    ;;
  hang)
    sleep 86400
    ;;
  *)
    echo "unknown FAKE_MODE: $mode" >&2
    exit 2
    ;;
esac