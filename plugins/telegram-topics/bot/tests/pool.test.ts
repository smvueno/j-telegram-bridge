import { test, expect } from "bun:test";
import { pickEvict } from "../pool";

test("nothing to close while under the limit", () => {
  expect(pickEvict([{ key: "a", lastUsed: 1, busy: false }], 3)).toBeUndefined();
});
test("at the limit, the quiet one used longest ago closes", () => {
  const e = [
    { key: "a", lastUsed: 30, busy: false },
    { key: "b", lastUsed: 10, busy: false },
    { key: "c", lastUsed: 20, busy: false },
  ];
  expect(pickEvict(e, 3)).toBe("b");
});
test("a busy one is never closed", () => {
  const e = [
    { key: "a", lastUsed: 1, busy: true },
    { key: "b", lastUsed: 5, busy: false },
    { key: "c", lastUsed: 9, busy: true },
  ];
  expect(pickEvict(e, 3)).toBe("b");
  expect(pickEvict([{ key: "a", lastUsed: 1, busy: true }], 1)).toBeUndefined();
});
