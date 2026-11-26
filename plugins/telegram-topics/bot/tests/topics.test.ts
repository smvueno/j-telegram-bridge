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
import { topicNameFor } from "../topics";
import { test as t3, expect as e3 } from "bun:test";

t3("a message moved out of Info gets a short topic name", () => {
  e3(topicNameFor("why did the backup fail?")).toBe("why did the backup fail?");
  e3(topicNameFor("what should I do", "⚠️ Nightly import failed\n\nstep 3 of 5")).toBe("Re: Nightly import failed");
  e3(topicNameFor("x", "✅ Backup finished")).toBe("Re: Backup finished");
  const long = topicNameFor("can you look into why the server was so slow this morning around nine");
  e3(long.length).toBeLessThanOrEqual(41);
  e3(long.endsWith("…")).toBe(true);
  e3(long).toBe("can you look into why the server was so…");
  e3(topicNameFor("   ")).toBe("New question");
});
