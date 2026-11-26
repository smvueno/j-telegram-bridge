import type { Subprocess } from "bun";
import { stepLabel } from "./text";

export type RunClaudeResult = {
  ok: boolean;
  text: string;
  error?: string;
  /** Last part of claude's stderr, for logs and for spotting "No conversation found". */
  stderr?: string;
};

type WarmClaudeOpts = {
  bin: string;
  sessionId: string;
  resume: boolean;
  cwd: string;
  systemNote: string;
  /** alias or full id, passed as --model */
  model?: string;
  /** thinking level, passed as --effort */
  effort?: string;
  /** full model id from claude's init line (e.g. claude-sonnet-5-5) */
  onModel?: (id: string) => void;
  /** every rate_limit_event line (plan usage) */
  onRateLimit?: (event: unknown) => void;
  onExit?: () => void;
};

type AskOpts = {
  prompt: string;
  timeoutMs: number;
  onStep: (label: string) => void;
  onEarlyAnswer?: (text: string) => void;
  signal?: AbortSignal;
};

type StreamAssistant = {
  type: "assistant";
  message?: {
    id?: string;
    content?: Array<{
      type: string;
      name?: string;
      input?: Record<string, unknown>;
      text?: string;
    }>;
  };
};

type StreamResult = {
  type: "result";
  is_error?: boolean;
  result?: string;
};

type AskState = {
  resolve: (r: RunClaudeResult) => void;
  onStep: (label: string) => void;
  onEarlyAnswer?: (text: string) => void;
  earlyAnswerSent: boolean;
  latestMsgId: string | null;
  textBlocks: string[];
  hasToolUse: boolean;
  /** end_turn seen before the text line arrived */
  endTurnPending: boolean;
  timeoutMs: number;
  timeoutId: ReturnType<typeof setTimeout>;
  aborted: boolean;
  timedOut: boolean;
  signal?: AbortSignal;
  abortListener?: () => void;
};

function spawnEnv(): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(process.env).filter(([k]) => !k.startsWith("TELEGRAM_")),
  );
}

function buildArgs(opts: WarmClaudeOpts): string[] {
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    // gives the model's own stop marker (message_delta stop_reason), used to send the answer early
    "--include-partial-messages",
    "--permission-mode",
    "auto",
    "--append-system-prompt",
    opts.systemNote,
  ];
  if (opts.model) {
    args.push("--model", opts.model);
  }
  if (opts.effort) {
    args.push("--effort", opts.effort);
  }
  if (opts.resume) {
    args.push("--resume", opts.sessionId);
  } else {
    args.push("--session-id", opts.sessionId);
  }
  return args;
}

function timeoutErrorMessage(timeoutMs: number): string {
  const minutes = timeoutMs / 60_000;
  const n =
    minutes >= 1
      ? String(Math.round(minutes))
      : minutes < 1 && minutes > 0
        ? String(minutes)
        : String(Math.ceil(timeoutMs / 60_000) || 1);
  return `Took longer than ${n} minutes, stopped`;
}

function signalGroup(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    try {
      process.kill(pid, sig);
    } catch {
      /* already gone */
    }
  }
}

function killProcessGroup(pid: number): void {
  signalGroup(pid, "SIGTERM");
  setTimeout(() => signalGroup(pid, "SIGKILL"), 5000).unref?.();
}

export class WarmClaude {
  private readonly proc: Subprocess<"pipe", "pipe", "pipe">;
  private readonly pid: number;
  private _alive = true;
  private _busy = false;
  private buffer = "";
  private stderrTail = "";
  private currentAsk: AskState | null = null;
  private readonly onExit?: () => void;
  private readonly onModel?: (id: string) => void;
  private readonly onRateLimit?: (event: unknown) => void;
  private onExitCalled = false;
  private closed = false;

  constructor(opts: WarmClaudeOpts) {
    this.onExit = opts.onExit;
    this.onModel = opts.onModel;
    this.onRateLimit = opts.onRateLimit;
    const args = buildArgs(opts);
    this.proc = Bun.spawn([opts.bin, ...args], {
      cwd: opts.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: spawnEnv(),
      detached: true,
    });

    const pid = this.proc.pid;
    if (!pid) {
      this._alive = false;
      throw new Error("Claude spawn failed");
    }
    this.pid = pid;

    void this.pumpStdout();
    void this.drainStderr();

    void this.proc.exited.then((code) => {
      this._alive = false;
      this.fireOnExit();
      const ask = this.currentAsk;
      if (ask) {
        if (ask.aborted) {
          this.finishAsk(ask, {
            ok: false,
            text: "",
            error: "Stopped",
            stderr: this.stderrTail,
          });
        } else if (ask.timedOut) {
          this.finishAsk(ask, {
            ok: false,
            text: "",
            error: timeoutErrorMessage(ask.timeoutMs),
            stderr: this.stderrTail,
          });
        } else {
          this.finishAsk(ask, {
            ok: false,
            text: "",
            error: `Claude stopped (exit ${code})`,
            stderr: this.stderrTail,
          });
        }
      }
    });
  }

  get alive(): boolean {
    return this._alive;
  }

  get busy(): boolean {
    return this._busy;
  }

  ask(opts: AskOpts): Promise<RunClaudeResult> {
    if (!this._alive) {
      return Promise.resolve({
        ok: false,
        text: "",
        error: "Claude stopped (exit 1)",
        stderr: this.stderrTail,
      });
    }
    if (this._busy) {
      throw new Error("WarmClaude is busy");
    }
    this._busy = true;

    return new Promise<RunClaudeResult>((resolve) => {
      const ask: AskState = {
        resolve,
        onStep: opts.onStep,
        onEarlyAnswer: opts.onEarlyAnswer,
        earlyAnswerSent: false,
        latestMsgId: null,
        textBlocks: [],
        hasToolUse: false,
        endTurnPending: false,
        aborted: false,
        timedOut: false,
        timeoutMs: opts.timeoutMs,
        timeoutId: setTimeout(() => {
          ask.timedOut = true;
          this._alive = false;
          killProcessGroup(this.pid);
        }, opts.timeoutMs),
      };

      if (opts.signal) {
        ask.signal = opts.signal;
        const onAbort = () => {
          if (opts.signal!.aborted) {
            ask.aborted = true;
            this._alive = false;
            killProcessGroup(this.pid);
          }
        };
        if (opts.signal.aborted) {
          ask.aborted = true;
          this._alive = false;
          killProcessGroup(this.pid);
        } else {
          opts.signal.addEventListener("abort", onAbort, { once: true });
          ask.abortListener = onAbort;
        }
      }

      this.currentAsk = ask;

      const line =
        JSON.stringify({
          type: "user",
          message: { role: "user", content: opts.prompt },
        }) + "\n";
      try {
        this.proc.stdin.write(line);
      } catch {
        /* stdin closed */
      }
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this._alive = false;
    try {
      this.proc.stdin.end();
    } catch {
      /* ignore */
    }
    killProcessGroup(this.pid);
  }

  private fireOnExit(): void {
    if (this.onExitCalled) return;
    this.onExitCalled = true;
    this.onExit?.();
  }

  private finishAsk(ask: AskState, result: RunClaudeResult): void {
    if (this.currentAsk !== ask) return;
    clearTimeout(ask.timeoutId);
    if (ask.abortListener && ask.signal) {
      ask.signal.removeEventListener("abort", ask.abortListener);
    }
    this.currentAsk = null;
    this._busy = false;
    ask.resolve(result);
  }

  /** The model said it is done (end_turn) and its text is in: send it without waiting for "result". */
  private maybeEarly(ask: AskState): void {
    if (
      ask.endTurnPending &&
      !ask.earlyAnswerSent &&
      ask.textBlocks.length > 0 &&
      !ask.hasToolUse &&
      ask.onEarlyAnswer
    ) {
      ask.earlyAnswerSent = true;
      ask.onEarlyAnswer(ask.textBlocks.join("\n"));
    }
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;
    if (rec.type === "system" && rec.subtype === "init" && typeof rec.model === "string") {
      this.onModel?.(rec.model);
    }
    if (rec.type === "rate_limit_event") {
      this.onRateLimit?.(rec);
    }
    const ask = this.currentAsk;
    if (!ask) return;

    if (rec.type === "assistant") {
      const msg = (rec as StreamAssistant).message;
      const msgId = msg?.id ?? null;
      if (msgId !== null && msgId !== ask.latestMsgId) {
        ask.latestMsgId = msgId;
        ask.textBlocks = [];
        ask.hasToolUse = false;
        // a marker seen before this message's first line belongs to it; keep it
      }
      for (const block of msg?.content ?? []) {
        if (block.type === "tool_use" && block.name) {
          ask.hasToolUse = true;
          ask.onStep(stepLabel(block.name, block.input ?? {}));
        } else if (block.type === "text" && typeof block.text === "string") {
          ask.textBlocks.push(block.text);
        }
      }
      this.maybeEarly(ask);
      return;
    }

    if (rec.type === "stream_event") {
      const ev = rec.event as
        | { type?: string; delta?: { stop_reason?: string | null } }
        | undefined;
      if (ev?.type === "message_delta" && ev.delta?.stop_reason === "end_turn") {
        ask.endTurnPending = true;
        this.maybeEarly(ask);
      }
      return;
    }

    if (rec.type === "result") {
      const ev = rec as StreamResult;
      const text = typeof ev.result === "string" ? ev.result : "";
      const ok = !ev.is_error;
      this.finishAsk(ask, { ok, text, stderr: this.stderrTail });
      return;
    }
  }

  private async pumpStdout(): Promise<void> {
    const reader = this.proc.stdout.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = this.buffer.indexOf("\n")) >= 0) {
          const line = this.buffer.slice(0, nl);
          this.buffer = this.buffer.slice(nl + 1);
          this.handleLine(line);
        }
      }
      if (this.buffer.trim()) {
        this.handleLine(this.buffer);
      }
    } catch {
      /* closed */
    }
  }

  private async drainStderr(): Promise<void> {
    const decoder = new TextDecoder();
    try {
      for await (const chunk of this.proc.stderr) {
        this.stderrTail = (
          this.stderrTail + decoder.decode(chunk, { stream: true })
        ).slice(-4000);
      }
    } catch {
      /* closed */
    }
  }
}