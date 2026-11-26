import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WarmClaude } from "../warm-claude";

const fakeBin = join(import.meta.dir, "fake-claude-warm.sh");

const systemNote =
  'You are talking to Sam through Telegram.';

function withMode<T>(mode: string, fn: () => Promise<T>): Promise<T> {
  const prev = process.env.FAKE_MODE;
  process.env.FAKE_MODE = mode;
  return fn().finally(() => {
    if (prev === undefined) delete process.env.FAKE_MODE;
    else process.env.FAKE_MODE = prev;
  });
}

describe("WarmClaude", () => {
  test("two asks on one instance give done 1 then done 2", async () => {
    await withMode("ok", async () => {
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "sess-warm",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      expect(wc.alive).toBe(true);
      const a1 = await wc.ask({
        prompt: "one",
        timeoutMs: 30_000,
        onStep: () => {},
      });
      expect(a1).toMatchObject({ ok: true, text: "done 1" });
      expect(wc.alive).toBe(true);
      const a2 = await wc.ask({
        prompt: "two",
        timeoutMs: 30_000,
        onStep: () => {},
      });
      expect(a2).toMatchObject({ ok: true, text: "done 2" });
      wc.close();
    });
  });

  test("onStep gets Bash: ls", async () => {
    await withMode("ok", async () => {
      const steps: string[] = [];
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      await wc.ask({
        prompt: "hi",
        timeoutMs: 30_000,
        onStep: (l) => steps.push(l),
      });
      expect(steps).toEqual(["Bash: ls"]);
      wc.close();
    });
  });

  test("onEarlyAnswer once per ask with done N not after tool_use", async () => {
    await withMode("ok", async () => {
      const early: string[] = [];
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      await wc.ask({
        prompt: "a",
        timeoutMs: 30_000,
        onStep: () => {},
        onEarlyAnswer: (t) => early.push(t),
      });
      expect(early).toEqual(["done 1"]);
      early.length = 0;
      await wc.ask({
        prompt: "b",
        timeoutMs: 30_000,
        onStep: () => {},
        onEarlyAnswer: (t) => early.push(t),
      });
      expect(early).toEqual(["done 2"]);
      wc.close();
    });
  });

  test("exit mode yields ok false exit 3 and onExit", async () => {
    await withMode("exit", async () => {
      let exited = false;
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
        onExit: () => {
          exited = true;
        },
      });
      const out = await wc.ask({
        prompt: "x",
        timeoutMs: 30_000,
        onStep: () => {},
      });
      expect(out.ok).toBe(false);
      expect(out.error).toBe("Claude stopped (exit 3)");
      expect(exited).toBe(true);
      expect(wc.alive).toBe(false);
    });
  });

  test("hang mode timeout reports stopped", async () => {
    await withMode("hang", async () => {
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      const out = await wc.ask({
        prompt: "wait",
        timeoutMs: 300,
        onStep: () => {},
      });
      expect(out.ok).toBe(false);
      expect(out.error?.toLowerCase()).toContain("stopped");
      expect(wc.alive).toBe(false);
    });
  }, 15_000);

  test("abort signal yields Stopped", async () => {
    await withMode("hang", async () => {
      const ac = new AbortController();
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      const p = wc.ask({
        prompt: "wait",
        timeoutMs: 60_000,
        onStep: () => {},
        signal: ac.signal,
      });
      await new Promise((r) => setTimeout(r, 150));
      ac.abort();
      const out = await p;
      expect(out.ok).toBe(false);
      expect(out.error).toBe("Stopped");
      expect(wc.alive).toBe(false);
    });
  }, 15_000);

  test("resume vs session-id args", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warm-claude-args-"));
    const logResume = join(dir, "resume.args");
    const logNew = join(dir, "new.args");
    await withMode("ok", async () => {
      process.env.FAKE_CLAUDE_LOG_ARGS = logResume;
      const w1 = new WarmClaude({
        bin: fakeBin,
        sessionId: "X",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      for (let i = 0; i < 50 && !(await Bun.file(logResume).exists()); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const resumeArgs = (await Bun.file(logResume).text()).trim().split("\n");
      expect(resumeArgs).toContain("--resume");
      expect(resumeArgs).toContain("X");
      expect(resumeArgs).not.toContain("--session-id");
      expect(resumeArgs).toContain("--input-format");
      expect(resumeArgs).toContain("stream-json");
      w1.close();

      delete process.env.FAKE_CLAUDE_LOG_ARGS;
      process.env.FAKE_CLAUDE_LOG_ARGS = logNew;
      const w2 = new WarmClaude({
        bin: fakeBin,
        sessionId: "Y",
        resume: false,
        cwd: "/tmp",
        systemNote,
      });
      for (let i = 0; i < 50 && !(await Bun.file(logNew).exists()); i++) {
        await new Promise((r) => setTimeout(r, 10));
      }
      const newArgs = (await Bun.file(logNew).text()).trim().split("\n");
      expect(newArgs).toContain("--session-id");
      expect(newArgs).toContain("Y");
      expect(newArgs).not.toContain("--resume");
      w2.close();
    }).finally(async () => {
      delete process.env.FAKE_CLAUDE_LOG_ARGS;
      await rm(dir, { recursive: true, force: true });
    });
  });

  test("spawn env omits TELEGRAM_* keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "warm-env-"));
  const log = join(dir, "env-check.sh");
    await Bun.write(
      log,
      `#!/usr/bin/env bash
if [ -n "\${FAKE_CLAUDE_LOG_ARGS:-}" ]; then printf '%s\\n' "$@" >"\$FAKE_CLAUDE_LOG_ARGS"; fi
if [ -n "\${TELEGRAM_TEST_X:-}" ]; then echo "HAS_TELEGRAM" >&2; exit 9; fi
exec "${fakeBin}" "$@"
`,
    );
    await Bun.spawn(["chmod", "+x", log]).exited;
    const prevX = process.env.TELEGRAM_TEST_X;
    process.env.TELEGRAM_TEST_X = "should-not-leak";
    process.env.FAKE_MODE = "ok";
    try {
      const wc = new WarmClaude({
        bin: log,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      const out = await wc.ask({
        prompt: "p",
        timeoutMs: 30_000,
        onStep: () => {},
      });
      expect(out.ok).toBe(true);
      wc.close();
    } finally {
      if (prevX === undefined) delete process.env.TELEGRAM_TEST_X;
      else process.env.TELEGRAM_TEST_X = prevX;
      delete process.env.FAKE_MODE;
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("throws if ask while busy", async () => {
    await withMode("ok", async () => {
      const wc = new WarmClaude({
        bin: fakeBin,
        sessionId: "s",
        resume: true,
        cwd: "/tmp",
        systemNote,
      });
      const p = wc.ask({
        prompt: "slow",
        timeoutMs: 30_000,
        onStep: () => {},
      });
      expect(wc.busy).toBe(true);
      expect(() =>
        wc.ask({ prompt: "other", timeoutMs: 30_000, onStep: () => {} }),
      ).toThrow();
      await p;
      wc.close();
    });
  });
});