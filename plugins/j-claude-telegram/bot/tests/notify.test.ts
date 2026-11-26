import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatNotification, sendNotification } from "../notify";
import { parseNotifyArgs } from "../notify-args";
import { State } from "../state";

test("notification text: level icon, title, body", () => {
  expect(formatNotification({ level: "alert", title: "Disk almost full", body: "3 GB left" })).toBe(
    "🚨 Disk almost full\n\n3 GB left",
  );
  expect(formatNotification({ level: "done", body: "Backup finished" })).toBe("✅ Backup finished");
  expect(formatNotification({ level: "info", title: "Only a title", body: "" })).toBe("ℹ️ Only a title");
});

test("notify arguments", () => {
  expect(parseNotifyArgs(["-l", "warn", "-t", "Job", "two", "words"])).toEqual({
    level: "warn", title: "Job", silent: false, files: [], message: "two words",
  });
  expect(parseNotifyArgs(["--silent", "-"])).toMatchObject({ silent: true, message: null });
  expect(parseNotifyArgs([])).toMatchObject({ message: null, level: "info" });
  expect(parseNotifyArgs(["-f", "/tmp/a.png", "hi"])).toMatchObject({ files: ["/tmp/a.png"] });
  expect(parseNotifyArgs(["--", "-t", "is text"])).toMatchObject({ message: "-t is text" });
  expect(parseNotifyArgs(["-h"])).toBe("help");
  expect(() => parseNotifyArgs(["-l", "loud"])).toThrow(/Unknown level/);
  expect(() => parseNotifyArgs(["-f", "rel.txt"])).toThrow(/absolute/);
  expect(() => parseNotifyArgs(["-t"])).toThrow(/needs a value/);
});

/** A stand-in for grammy's Api that records calls. */
function fakeApi(opts: { topicFails?: boolean; threadGoneOnce?: boolean } = {}) {
  const calls: Array<{ m: string; args: unknown[] }> = [];
  let topicN = 100;
  let gone = opts.threadGoneOnce ?? false;
  const api = {
    createForumTopic: async (...args: unknown[]) => {
      calls.push({ m: "createForumTopic", args });
      if (opts.topicFails) throw new Error("topics are off");
      return { message_thread_id: ++topicN };
    },
    sendMessage: async (...args: unknown[]) => {
      calls.push({ m: "sendMessage", args });
      const extra = args[2] as { message_thread_id?: number };
      if (gone && extra.message_thread_id) {
        gone = false;
        const { GrammyError } = await import("grammy");
        throw new GrammyError("x", { ok: false, error_code: 400, description: "Bad Request: message thread not found" }, "sendMessage", {});
      }
      return {};
    },
    sendPhoto: async (...args: unknown[]) => (calls.push({ m: "sendPhoto", args }), {}),
    sendDocument: async (...args: unknown[]) => (calls.push({ m: "sendDocument", args }), {}),
  };
  return { api: api as never, calls };
}

function pairedState(...users: number[]): State {
  const s = new State(join(mkdtempSync(join(tmpdir(), "ctg-")), "state.json"));
  for (const u of users) s.allow(s.newPairCode(u));
  return s;
}

test("first notification makes the Info topic once and reuses it", async () => {
  const s = pairedState(7);
  const { api, calls } = fakeApi();
  const opts = { topicName: "📣 Info", body: "hello", level: "info" as const };
  expect((await sendNotification(api, s, opts)).sent).toBe(1);
  await sendNotification(api, s, opts);
  expect(calls.filter((c) => c.m === "createForumTopic")).toHaveLength(1);
  const sends = calls.filter((c) => c.m === "sendMessage");
  expect(sends[1]!.args[0]).toBe(7);
  expect(sends[1]!.args[2]).toMatchObject({ message_thread_id: 101, disable_notification: false });
});

test("topics off: goes to the main chat", async () => {
  const s = pairedState(7);
  const { api, calls } = fakeApi({ topicFails: true });
  expect((await sendNotification(api, s, { topicName: "x", body: "hi", level: "warn", silent: true })).sent).toBe(1);
  const extra = calls.find((c) => c.m === "sendMessage")!.args[2] as Record<string, unknown>;
  expect(extra.message_thread_id).toBeUndefined();
  expect(extra.disable_notification).toBe(true);
});

test("a deleted Info topic is made again", async () => {
  const s = pairedState(7);
  s.setInfoThread(7, 55);
  const { api, calls } = fakeApi({ threadGoneOnce: true });
  expect((await sendNotification(api, s, { topicName: "x", body: "hi", level: "info" })).sent).toBe(1);
  expect(calls.filter((c) => c.m === "createForumTopic")).toHaveLength(1);
  expect(s.infoThreadFor(7)).toBe(101);
});

test("nobody paired: says so", async () => {
  const { api } = fakeApi();
  const res = await sendNotification(api, pairedState(), { topicName: "x", body: "hi", level: "info" });
  expect(res.sent).toBe(0);
  expect(res.errors[0]).toMatch(/Nobody is paired/);
});

test("pictures as photos, other files as documents", async () => {
  const { api, calls } = fakeApi();
  await sendNotification(api, pairedState(7), {
    topicName: "x", body: "see files", level: "done", files: ["/tmp/a.PNG", "/tmp/log.txt"],
  });
  expect(calls.map((c) => c.m)).toContain("sendPhoto");
  expect(calls.map((c) => c.m)).toContain("sendDocument");
});
