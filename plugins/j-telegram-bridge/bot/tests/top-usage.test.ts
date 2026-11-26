import { test, expect } from "bun:test";
import { groupUsage, usageRowLine } from "../server-status";

test("CPU and memory are summed per service over the sample", () => {
  const before = new Map([[1, 100], [2, 50], [3, 0]]);
  const after = [
    { pid: 1, label: "web-app", ticks: 150, rss: 300 * 1024 ** 2 }, // 50 ticks in 1 s = 50%
    { pid: 2, label: "web-app", ticks: 60, rss: 150 * 1024 ** 2 }, // 10%
    { pid: 3, label: "claude", ticks: 5, rss: 2 * 1024 ** 3 },
    { pid: 4, label: "new", ticks: 999, rss: 1 }, // started during the sample: no CPU known
  ];
  const rows = groupUsage(before, after, 1000);
  const web = rows.find((r) => r.label === "web-app")!;
  expect(web.count).toBe(2);
  expect(Math.round(web.cpu)).toBe(60);
  expect(rows.find((r) => r.label === "new")!.cpu).toBe(0);
  expect(usageRowLine(web, "cpu")).toBe("web-app (2): 60% CPU, 450 MB");
  expect(usageRowLine(rows.find((r) => r.label === "claude")!, "mem")).toBe("claude: 2.0 GB, 5% CPU");
  // on 4 cores the same work is a quarter of the server
  const four = groupUsage(before, after, 1000, 100, 4);
  expect(Math.round(four.find((r) => r.label === "web-app")!.cpu)).toBe(15);
});
