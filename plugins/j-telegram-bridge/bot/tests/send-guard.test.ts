import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refuseToSend } from "../send-guard";

const home = mkdtempSync(join(tmpdir(), "ctg-home-"));
const state = join(home, ".claude", "channels", "j-telegram-bridge");
mkdirSync(state, { recursive: true });
mkdirSync(join(home, ".ssh"));
mkdirSync(join(home, "work"));
writeFileSync(join(state, "bot.env"), "TELEGRAM_BOT_TOKEN=x");
writeFileSync(join(home, ".ssh", "id_ed25519"), "key");
writeFileSync(join(home, "work", "report.pdf"), "pdf");
writeFileSync(join(home, "work", ".env"), "A=1");
writeFileSync(join(home, "work", "server.key"), "k");
symlinkSync(join(state, "bot.env"), join(home, "work", "innocent.txt"));

test("ordinary files may be sent", () => {
  expect(refuseToSend(join(home, "work", "report.pdf"), state, home)).toBeNull();
});
test("secrets are never sent, also through a link", () => {
  expect(refuseToSend(join(state, "bot.env"), state, home)).toBe("private folder");
  expect(refuseToSend(join(home, ".ssh", "id_ed25519"), state, home)).toBe("private folder");
  expect(refuseToSend(join(home, "work", ".env"), state, home)).toBe("looks like a secret");
  expect(refuseToSend(join(home, "work", "server.key"), state, home)).toBe("looks like a secret");
  expect(refuseToSend(join(home, "work", "innocent.txt"), state, home)).toBe("private folder");
  expect(refuseToSend(join(home, "work", "..", ".ssh", "id_ed25519"), state, home)).toBe("private folder");
});
test("missing files and folders are refused", () => {
  expect(refuseToSend(join(home, "nope"), state, home)).toBe("file not found");
  expect(refuseToSend(join(home, "work"), state, home)).toBe("not a file");
});
