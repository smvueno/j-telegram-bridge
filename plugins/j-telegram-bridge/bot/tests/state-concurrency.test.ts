import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("two processes writing at once lose nothing and leave valid JSON", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "ctg-")), "state.json");
  const writer = join(import.meta.dir, "stress", "state-writer.ts");
  const run = (prefix: string) =>
    Bun.spawn([process.execPath, writer, file, prefix, "300"], { stdout: "ignore", stderr: "inherit" }).exited;
  const codes = await Promise.all([run("1"), run("2")]);
  expect(codes).toEqual([0, 0]);
  const data = JSON.parse(readFileSync(file, "utf8"));
  expect(Object.keys(data.sessions)).toHaveLength(600);
  expect(existsSync(`${file}.lock`)).toBe(false);
}, 60_000);
