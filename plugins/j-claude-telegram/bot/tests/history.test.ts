import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteConversation, topicInboxDir } from "../history";
import { State } from "../state";

const ID = "0e9a88c8-224d-42fb-99eb-4501ca0d9fa3";

test("a conversation's files are deleted, others stay", () => {
  const home = mkdtempSync(join(tmpdir(), "ctg-"));
  const p = join(home, "projects", "-srv");
  mkdirSync(join(p, ID, "subagents"), { recursive: true });
  writeFileSync(join(p, `${ID}.jsonl`), "{}");
  writeFileSync(join(p, "other.jsonl"), "{}");
  expect(deleteConversation(ID, home)).toBe(2);
  expect(existsSync(join(p, `${ID}.jsonl`))).toBe(false);
  expect(existsSync(join(p, ID))).toBe(false);
  expect(existsSync(join(p, "other.jsonl"))).toBe(true);
});

test("only real conversation ids are used as paths", () => {
  const home = mkdtempSync(join(tmpdir(), "ctg-"));
  mkdirSync(join(home, "projects", "x"), { recursive: true });
  expect(deleteConversation("../../etc", home)).toBe(0);
  expect(deleteConversation("", home)).toBe(0);
});

test("inbox folder per topic", () => {
  expect(topicInboxDir("/in", "5:77")).toBe("/in/5_77");
});

test("forgetting a topic removes its conversation, model, thinking and name", () => {
  const s = new State(join(mkdtempSync(join(tmpdir(), "ctg-")), "state.json"));
  s.setSession("5:77", ID);
  s.setModel("5:77", "opus");
  s.setEffort("5:77", "high");
  s.noteTopicName("5:77", "Taxes", true);
  s.setSession("5:78", "keep");
  expect(s.forgetTopic("5:77")).toBe(ID);
  expect(s.sessionFor("5:77")).toBeUndefined();
  expect(s.modelFor("5:77")).toBeUndefined();
  expect(s.topicName("5:77")).toBeUndefined();
  expect(s.sessionFor("5:78")).toBe("keep");
});

test("a sure name is never replaced by a guessed one", () => {
  const s = new State(join(mkdtempSync(join(tmpdir(), "ctg-")), "state.json"));
  s.noteTopicName("5:1", "Renamed", true);
  s.noteTopicName("5:1", "Original", false);
  expect(s.topicName("5:1")).toEqual({ name: "Renamed", sure: true });
  s.noteTopicName("5:2", "Guess", false);
  s.noteTopicName("5:2", "Live", true);
  expect(s.topicName("5:2")).toEqual({ name: "Live", sure: true });
});
