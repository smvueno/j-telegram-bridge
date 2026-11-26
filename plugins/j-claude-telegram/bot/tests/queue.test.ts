import { describe, expect, test } from "bun:test";
import { TopicQueue } from "../queue";

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("TopicQueue", () => {
  test("two jobs on key A never overlap and run in push order", async () => {
    const q = new TopicQueue(3);
    const order: number[] = [];
    let overlapping = false;
    let aRunning = 0;

    const gate1 = defer();
    const gate2 = defer();

    q.push("A", async () => {
      aRunning++;
      if (aRunning > 1) overlapping = true;
      order.push(1);
      await gate1.promise;
      aRunning--;
    });

    await new Promise((r) => setTimeout(r, 10));
    expect(q.running("A")).toBe(true);

    q.push("A", async () => {
      aRunning++;
      if (aRunning > 1) overlapping = true;
      order.push(2);
      await gate2.promise;
      aRunning--;
    });

    // job 2 must wait until job 1 finishes
    await new Promise((r) => setTimeout(r, 5));
    expect(q.waiting("A")).toBe(1);

    gate1.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);
    expect(overlapping).toBe(false);
    expect(q.running("A")).toBe(true);

    gate2.resolve();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([1, 2]);
    expect(overlapping).toBe(false);
    expect(q.running("A")).toBe(false);
    expect(q.waiting("A")).toBe(0);
  });

  test("maxParallel 2 limits active keys to two", async () => {
    const q = new TopicQueue(2);
    const gates = [defer(), defer(), defer()];
    let maxSeen = 0;

    const track = () => {
      const { running } = q.status();
      if (running.length > maxSeen) maxSeen = running.length;
    };

    q.push("k1", async () => {
      track();
      await gates[0].promise;
    });
    q.push("k2", async () => {
      track();
      await gates[1].promise;
    });
    q.push("k3", async () => {
      track();
      await gates[2].promise;
    });

    await new Promise((r) => setTimeout(r, 20));
    track();
    expect(maxSeen).toBeLessThanOrEqual(2);
    const { running, waiting } = q.status();
    expect(running.length).toBe(2);
    expect(waiting).toBe(1);

    gates[0].resolve();
    await new Promise((r) => setTimeout(r, 20));
    track();
    expect(maxSeen).toBeLessThanOrEqual(2);
    const after = q.status();
    expect(after.running.length).toBe(2);
    expect(after.waiting).toBe(0);

    gates[1].resolve();
    gates[2].resolve();
    await new Promise((r) => setTimeout(r, 20));
    expect(q.status().running.length).toBe(0);
  });

  test("a throwing job still lets the next one run", async () => {
    const q = new TopicQueue(3);
    let secondRan = false;

    q.push("A", async () => {
      throw new Error("boom");
    });
    q.push("A", async () => {
      secondRan = true;
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(secondRan).toBe(true);
    expect(q.running("A")).toBe(false);
    expect(q.waiting("A")).toBe(0);
  });
});
import { test as tq, expect as eq } from "bun:test";
import { TopicQueue as Q2 } from "../queue";
tq("drop removes waiting jobs but not the running one", async () => {
  const q = new Q2(1);
  const ran: string[] = [];
  let release!: () => void;
  q.push("a", () => new Promise<void>((r) => { ran.push("1"); release = r; }));
  q.push("a", async () => { ran.push("2"); });
  eq(q.drop("a")).toBe(1);
  release();
  await new Promise((r) => setTimeout(r, 20));
  eq(ran).toEqual(["1"]);
});
