import { test, expect } from "bun:test";
import { resolveTimeZone } from "../timezone";

test("cities, zones and short names resolve", () => {
  expect(resolveTimeZone("Copenhagen")).toBe("Europe/Copenhagen");
  expect(resolveTimeZone("new york")).toBe("America/New_York");
  expect(resolveTimeZone("europe/copenhagen")).toBe("Europe/Copenhagen");
  expect(resolveTimeZone("JST")).toBe("Asia/Tokyo");
  expect(resolveTimeZone("Bangkok")).toBe("Asia/Bangkok");
  expect(resolveTimeZone("Atlantis")).toBeNull();
  expect(resolveTimeZone("")).toBeNull();
});
