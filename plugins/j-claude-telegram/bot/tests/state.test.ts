import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { State } from "../state";

const tmpDir = join("/tmp", `j-claude-telegram-state-${process.pid}`);

beforeEach(async () => {
  await mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe("State", () => {
  test("newPairCode returns 6 chars in a-km-z", () => {
    const file = join(tmpDir, "state.json");
    const state = new State(file);
    const code = state.newPairCode(42);
    expect(code).toMatch(/^[a-km-z]{6}$/);
  });

  test("allow(code) pairs user and second allow returns null", () => {
    const file = join(tmpDir, "state.json");
    const state = new State(file);
    const code = state.newPairCode(42);
    expect(state.allow(code)).toBe(42);
    expect(state.isAllowed(42)).toBe(true);
    expect(state.allow(code)).toBeNull();
  });

  test("setSession survives reload", () => {
    const file = join(tmpDir, "state.json");
    const state = new State(file);
    state.setSession("1:0", "abc");
    const again = new State(file);
    expect(again.sessionFor("1:0")).toBe("abc");
  });

  test("clearSession removes session", () => {
    const file = join(tmpDir, "state.json");
    const state = new State(file);
    state.setSession("1:0", "abc");
    state.clearSession("1:0");
    expect(state.sessionFor("1:0")).toBeUndefined();
  });

  test("state file mode is 0o600", async () => {
    const file = join(tmpDir, "state.json");
    const state = new State(file);
    state.newPairCode(1);
    const st = await stat(file);
    expect(st.mode & 0o777).toBe(0o600);
  });
});
import { test as t2, expect as e2 } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as j2 } from "node:path";
import { State as S2 } from "../state";

t2("a second process's allow is seen by the first", () => {
  const f = j2(mkdtempSync(j2(tmpdir(), "ctg-")), "state.json");
  const bot = new S2(f);
  const code = bot.newPairCode(7);
  e2(new S2(f).allow(code)).toBe(7);
  bot.setSession("1:0", "x");
  e2(bot.isAllowed(7)).toBe(true);
  e2(new S2(f).isAllowed(7)).toBe(true);
});
