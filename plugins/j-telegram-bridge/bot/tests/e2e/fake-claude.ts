// Fake `claude -p --input-format stream-json`: answers each user line; keywords trigger failures.
import { appendFileSync } from "node:fs";

const log = process.env.FAKE_CLAUDE_LOG;
if (log) appendFileSync(log, `start ${process.pid} ${process.argv.slice(2).join(" ")}\n`);
const out = (o: unknown) => process.stdout.write(JSON.stringify(o) + "\n");
const decoder = new TextDecoder();
let buf = "";
let n = 0;
for await (const chunk of Bun.stdin.stream()) {
  buf += decoder.decode(chunk, { stream: true });
  let nl: number;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (!line.trim()) continue;
    const content = String(JSON.parse(line).message?.content ?? "");
    n++;
    if (log) appendFileSync(log, `ask ${process.pid} ${content.length}\n`);
    if (content.includes("CRASH")) process.exit(3);
    if (content.includes("HANG")) continue;
    out({ type: "system", subtype: "init", model: "claude-sonnet-5-5" });
    if (content.includes("GARBAGE")) {
      process.stdout.write("this is not json\n{broken\n" + "x".repeat(300_000) + "\n");
    }
    if (content.includes("TOOLS")) {
      out({ type: "assistant", message: { id: `t${n}`, content: [{ type: "tool_use", name: "Bash", input: { command: "ls" } }] } });
      out({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "tool_use" } } });
    }
    let text = `echo: ${content.slice(0, 300)}`;
    const sf = content.match(/SENDFILE:(\S+)/);
    if (sf) text += `\nSEND_FILE: ${sf[1]}`;
    if (content.includes("BIG")) text = "**big** ".repeat(2000);
    out({ type: "assistant", message: { id: `m${n}`, content: [{ type: "text", text }] } });
    out({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "end_turn" } } });
    out({ type: "rate_limit_event", rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.5, resetsAt: 2000000000 }, seven_day: { utilization: 0.95, resetsAt: 2000000000 } } } });
    out({ type: "result", subtype: "success", is_error: false, result: text });
  }
}
