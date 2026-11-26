import { test, expect } from "bun:test";
import { normalizeModel, modelLabel, normalizeEffort, effortLabel, prettyModelId } from "../models";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { State } from "../state";

test("aliases and full ids are accepted, junk is not", () => {
  expect(normalizeModel("Opus")).toBe("opus");
  expect(normalizeModel(" haiku ")).toBe("haiku");
  expect(normalizeModel("claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
  expect(normalizeModel("gpt-5")).toBeNull();
  expect(normalizeModel("opus; rm -rf /")).toBeNull();
  expect(normalizeModel("")).toBeNull();
});
test("labels show the version like the Claude app", () => {
  expect(modelLabel("sonnet")).toBe("Sonnet");
  expect(modelLabel("sonnet", "claude-sonnet-5-5")).toBe("Sonnet 5.5");
  expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
  expect(prettyModelId("claude-haiku-6")).toBe("Haiku 6");
  expect(prettyModelId("claude-sonnet-4-5-20250929")).toBe("Sonnet 4.5");
  expect(prettyModelId("gpt-5")).toBeNull();
});
test("thinking levels", () => {
  expect(normalizeEffort("Medium")).toBe("medium");
  expect(normalizeEffort("extra high")).toBe("xhigh");
  expect(normalizeEffort("XHIGH")).toBe("xhigh");
  expect(normalizeEffort("turbo")).toBeNull();
  expect(effortLabel("xhigh")).toBe("Extra high");
});
test("a topic's thinking level and the versions seen are saved", () => {
  const f = join(mkdtempSync(join(tmpdir(), "ctg-")), "state.json");
  const s = new State(f);
  s.setEffort("1:5", "high");
  s.noteModelId("sonnet", "claude-sonnet-5-5");
  const again = new State(f);
  expect(again.effortFor("1:5")).toBe("high");
  expect(again.modelIdFor("sonnet")).toBe("claude-sonnet-5-5");
});
test("a topic's model is saved and survives /new", () => {
  const f = join(mkdtempSync(join(tmpdir(), "ctg-")), "state.json");
  const s = new State(f);
  expect(s.modelFor("1:5")).toBeUndefined();
  s.setModel("1:5", "opus");
  s.setSession("1:5", "abc");
  s.clearSession("1:5");
  expect(new State(f).modelFor("1:5")).toBe("opus");
});
