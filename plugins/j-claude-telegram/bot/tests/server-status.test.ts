import { test, expect } from "bun:test";
import { planUsageFrom, usageLine, durationLabel, whenLabel } from "../server-status";

const ev = {
  type: "rate_limit_event",
  rate_limit_info: {
    unifiedWindows: {
      five_hour: { utilization: 0.01, resetsAt: 1795695000, status: "allowed" },
      seven_day: { utilization: 0.88, resetsAt: 1795795200, status: "allowed_warning" },
    },
  },
};

test("plan usage is read from claude's rate_limit_event", () => {
  const u = planUsageFrom(ev, 123)!;
  expect(u.at).toBe(123);
  expect(u.fiveHour!.utilization).toBe(0.01);
  expect(u.week!.resetsAt).toBe(1795795200);
  expect(planUsageFrom({ type: "rate_limit_event" }, 1)).toBeNull();
});
test("usage lines warn from 75% and say when the limit is hit", () => {
  const now = 1795695000 * 1000 - 3600_000;
  expect(usageLine({ utilization: 0.01, resetsAt: 1795695000 }, now, "Asia/Tokyo")).toMatch(/^1% \(resets /);
  expect(usageLine({ utilization: 0.88, resetsAt: 1795795200 }, now)).toMatch(/^88% ⚠️ \(resets /);
  expect(usageLine({ utilization: 1, resetsAt: 1795795200 }, now)).toContain("limit reached");
});
test("reset time is a clock time today, a day name later, with its zone", () => {
  // 2026-11-26 10:00 JST = 01:00 UTC
  const now = Date.UTC(2026, 10, 26, 1, 0);
  expect(whenLabel(Date.UTC(2026, 10, 26, 9, 30) / 1000, now, "Asia/Tokyo")).toBe("18:30 JST");
  expect(whenLabel(Date.UTC(2026, 10, 30, 0, 5) / 1000, now, "Asia/Tokyo")).toBe("Mon 09:05 JST");
  expect(whenLabel(Date.UTC(2026, 10, 26, 9, 30) / 1000, now, "Europe/Copenhagen")).toBe("10:30 GMT+1");
});
test("durations", () => {
  expect(durationLabel(50000)).toBe("13 h");
  expect(durationLabel(2 * 86400 + 4 * 3600)).toBe("2 d 4 h");
  expect(durationLabel(90)).toBe("1 min");
});
