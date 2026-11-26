import { describe, expect, test } from "bun:test";
import { TopicTracker } from "../topics";

describe("TopicTracker", () => {
  const t = 1_000_000;
  const graceMs = 60_000;

  test("main chat key when no thread id", () => {
    const tracker = new TopicTracker(graceMs);
    expect(tracker.keyFor(5, undefined, t)).toBe("5:0");
  });

  test("explicit thread id in key", () => {
    const tracker = new TopicTracker(graceMs);
    expect(tracker.keyFor(5, 9, t)).toBe("5:9");
  });

  test("routes General to new topic within grace after noteNewTopic", () => {
    const tracker = new TopicTracker(graceMs);
    tracker.noteNewTopic(5, 77, t);
    expect(tracker.keyFor(5, undefined, t + 1000)).toBe("5:77");
  });

  test("after grace, General chat key again", () => {
    const tracker = new TopicTracker(graceMs);
    tracker.noteNewTopic(5, 77, t);
    expect(tracker.keyFor(5, undefined, t + 61_000)).toBe("5:0");
  });
});