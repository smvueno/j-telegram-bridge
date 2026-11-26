import { describe, expect, test } from "bun:test";
import { splitMessage, extractSendFiles, stepLabel } from "../text";

describe("splitMessage", () => {
  test("9000 a's split into 3 parts each at most 4096", () => {
    const parts = splitMessage("a".repeat(9000));
    expect(parts.length).toBe(3);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(4096);
    }
    expect(parts.join("").length).toBe(9000);
  });

  test("prefers breaking at newline before the limit", () => {
    const head = "x".repeat(4080);
    const text = `${head}line one\nline two is here`;
    const parts = splitMessage(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]!.length).toBeLessThanOrEqual(4096);
    expect(parts[0]!).toEndWith("line one");
    expect(parts[0]!).not.toContain("line two");
  });

  test("empty input yields (no answer)", () => {
    expect(splitMessage("")).toEqual(["(no answer)"]);
    expect(splitMessage("   ")).toEqual(["(no answer)"]);
  });
});

describe("extractSendFiles", () => {
  test("extracts absolute paths and strips SEND_FILE lines", () => {
    const { text, files } = extractSendFiles("hi\nSEND_FILE: /srv/x.png\nbye");
    expect(text).toBe("hi\nbye");
    expect(files).toEqual(["/srv/x.png"]);
  });

  test("ignores relative paths", () => {
    const { text, files } = extractSendFiles("SEND_FILE: rel/x.png\nok");
    expect(text).toBe("ok");
    expect(files).toEqual([]);
  });
});

describe("stepLabel", () => {
  test("Bash shows first 80 chars of command", () => {
    const cmd = "echo " + "c".repeat(100);
    expect(stepLabel("Bash", { command: cmd })).toBe(`Bash: ${cmd.slice(0, 80)}`);
  });

  test("Read shows file_path", () => {
    expect(stepLabel("Read", { file_path: "/srv/foo.ts" })).toBe(
      "Read: /srv/foo.ts",
    );
  });

  test("other tools return tool name", () => {
    expect(stepLabel("Write", { path: "/x" })).toBe("Write");
  });
});