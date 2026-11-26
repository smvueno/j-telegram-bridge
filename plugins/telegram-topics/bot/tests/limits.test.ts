import { test, expect } from "bun:test";
import { limitWarnings } from "../limits";

const at = (u5: number, uw: number) => ({
  at: 0,
  fiveHour: { utilization: u5, resetsAt: 100 },
  week: { utilization: uw, resetsAt: 200 },
});

test("warns once per window at 90%, again at 100%, never twice", () => {
  let r = limitWarnings(at(0.5, 0.88), {});
  expect(r.send).toHaveLength(0);
  r = limitWarnings(at(0.5, 0.91), r.warned);
  expect(r.send).toEqual([{ window: "week", level: "warn", pct: 91, resetsAt: 200 }]);
  r = limitWarnings(at(0.5, 0.95), r.warned);
  expect(r.send).toHaveLength(0);
  r = limitWarnings(at(0.5, 1), r.warned);
  expect(r.send[0]).toMatchObject({ window: "week", level: "alert" });
  r = limitWarnings(at(0.5, 0.99), r.warned);
  expect(r.send).toHaveLength(0);
});

test("a new window (new reset time) can warn again", () => {
  const first = limitWarnings(at(0.92, 0.1), {});
  expect(first.send).toHaveLength(1);
  const next = limitWarnings({ at: 0, fiveHour: { utilization: 0.93, resetsAt: 999 } }, first.warned);
  expect(next.send).toHaveLength(1);
});
