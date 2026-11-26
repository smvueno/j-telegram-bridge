import { mkdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Bot, GrammyError, InlineKeyboard, InputFile, type Api } from "grammy";
import { loadConfig } from "./config";
import { State } from "./state";
import { splitMessage, extractSendFiles } from "./text";
import { TopicTracker, topicNameFor } from "./topics";
import { TopicQueue } from "./queue";
import { systemNote } from "./prompt";
import { loadToken } from "./token";
// The token is not in ~/.claude/channels/telegram: Anthropic's official telegram plugin reads
// that file and would start polling the same bot inside every claude run (409 conflict).
import { HEARTBEAT_FILE, INBOX_DIR, STATE_DIR, STATE_FILE } from "./paths";
import { WarmClaude } from "./warm-claude";
import { pickEvict } from "./pool";
import { planUsageFrom, serverLines, usageLine, whenLabel, type PlanUsage } from "./server-status";
import { resolveTimeZone, zoneShort } from "./timezone";
import {
  EFFORT_LEVELS,
  MODEL_CHOICES,
  MODEL_INFO,
  effortLabel,
  modelLabel,
  normalizeEffort,
  normalizeModel,
} from "./models";

const TELEGRAM_FILE_MAX = 20 * 1024 * 1024;
const PAIR_REPLY_COOLDOWN_MS = 10 * 60 * 1000;
const TYPING_INTERVAL_MS = 4000;

const NO_CONVERSATION_PREFIX =
  "(Started a new conversation, the old one was not found.)";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function log(line: string): void {
  console.log(`[bot] ${line}`);
}

function logErr(line: string): void {
  console.error(`[bot] ${line}`);
}

function parseKey(key: string): { chatId: number; threadId: number } {
  const [chat, thread] = key.split(":");
  return { chatId: Number(chat), threadId: Number(thread ?? "0") };
}

function threadExtra(threadId: number): { message_thread_id?: number } {
  return threadId !== 0 ? { message_thread_id: threadId } : {};
}

function parseCommand(
  text: string | undefined,
): { cmd: string; arg: string } | null {
  if (!text) return null;
  const m = text.trim().match(/^\/(new|stop|status|model|thinking|timezone)(@\w+)?(?:\s+(.*))?$/is);
  return m ? { cmd: m[1]!.toLowerCase(), arg: (m[3] ?? "").trim() } : null;
}

function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return IMAGE_EXT.has(path.slice(dot).toLowerCase());
}

function isNotModified(err: unknown): boolean {
  return (
    err instanceof GrammyError &&
    err.description.toLowerCase().includes("message is not modified")
  );
}

function safeFilename(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file";
}

async function downloadTelegramFile(
  api: Api,
  token: string,
  fileId: string,
  destPath: string,
): Promise<void> {
  const f = await api.getFile(fileId);
  if (!f.file_path) throw new Error("getFile returned no path");
  const res = await fetch(
    `https://api.telegram.org/file/bot${token}/${f.file_path}`,
  );
  if (!res.ok) throw new Error(`file download http ${res.status}`);
  await Bun.write(destPath, res);
}

async function sendPlain(
  api: Api,
  chatId: number,
  threadId: number,
  text: string,
): Promise<void> {
  const parts = splitMessage(text);
  for (const part of parts) {
    await api.sendMessage(chatId, part, threadExtra(threadId));
  }
}

async function sendClaudeOutput(
  api: Api,
  chatId: number,
  threadId: number,
  rawText: string,
): Promise<void> {
  const { text, files } = extractSendFiles(rawText);
  await sendPlain(api, chatId, threadId, text);
  for (const path of files) {
    try {
      const extra = threadExtra(threadId);
      if (isImagePath(path)) {
        await api.sendPhoto(chatId, new InputFile(path), extra);
      } else {
        await api.sendDocument(chatId, new InputFile(path), extra);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send file failed";
      logErr(`send_file key=${chatId}:${threadId} err=${msg.slice(0, 80)}`);
    }
  }
}

async function main(): Promise<void> {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const config = await loadConfig(STATE_DIR);
  await mkdir(INBOX_DIR, { recursive: true, mode: 0o700 });

  const token = await loadToken();
  const state = new State(STATE_FILE);
  const tracker = new TopicTracker(config.newTopicGraceMs);
  const queue = new TopicQueue(config.maxParallel);
  const abortByKey = new Map<string, AbortController>();
  const pairReplyAt = new Map<number, number>();

  type PoolEntry = {
    claude: WarmClaude;
    idle?: ReturnType<typeof setTimeout>;
    lastUsed: number;
    model: string;
    effort: string;
  };

  const modelOf = (key: string): string => state.modelFor(key) ?? config.defaultModel;
  const effortOf = (key: string): string => state.effortFor(key) ?? config.defaultEffort;
  /** "Sonnet 5.5": the alias with the version it last ran as */
  const showModel = (model: string): string => modelLabel(model, state.modelIdFor(model));
  const pool = new Map<string, PoolEntry>();

  const clearIdle = (entry: PoolEntry): void => {
    if (entry.idle !== undefined) {
      clearTimeout(entry.idle);
      entry.idle = undefined;
    }
  };

  const dropPoolEntry = (key: string): void => {
    const entry = pool.get(key);
    if (!entry) return;
    clearIdle(entry);
    entry.claude.close();
    pool.delete(key);
  };

  const scheduleIdle = (key: string, entry: PoolEntry): void => {
    clearIdle(entry);
    if (!entry.claude.alive) return;
    entry.idle = setTimeout(() => {
      log(`idle_close key=${key}`);
      entry.claude.close();
      const cur = pool.get(key);
      if (cur === entry) pool.delete(key);
    }, config.idleMinutes * 60_000);
    entry.idle.unref?.();
  };

  const createWarm = (key: string, sessionId: string, resume: boolean): WarmClaude => {
    const model = modelOf(key);
    const effort = effortOf(key);
    const claude = new WarmClaude({
      bin: config.claudeBin,
      sessionId,
      resume,
      cwd: config.workDir,
      systemNote: systemNote(config.ownerName),
      model,
      effort,
      onRateLimit: (ev) => {
        const u = planUsageFrom(ev, Date.now());
        if (u) state.setPlanUsage(u);
      },
      onModel: (id) => {
        if (/^[a-z]+$/.test(model)) state.noteModelId(model, id);
      },
      onExit: () => {
        const cur = pool.get(key);
        if (cur?.claude === claude) {
          clearIdle(cur);
          pool.delete(key);
        }
      },
    });
    pool.set(key, { claude, lastUsed: Date.now(), model, effort });
    log(`warm_start key=${key} resume=${resume} model=${model} effort=${effort}`);
    return claude;
  };

  const getWarm = (key: string): WarmClaude => {
    const existing = pool.get(key);
    if (existing?.claude.alive && existing.model === modelOf(key) && existing.effort === effortOf(key)) {
      return existing.claude;
    }
    // gone, or the topic switched model or thinking level: start again on the same conversation
    if (existing) dropPoolEntry(key);

    // Hard limit: close the quiet topic used longest ago (its conversation stays saved).
    const evict = pickEvict(
      [...pool].map(([k, e]) => ({ key: k, lastUsed: e.lastUsed, busy: e.claude.busy })),
      config.maxWarm,
    );
    if (evict) {
      log(`limit_close key=${evict} max=${config.maxWarm}`);
      dropPoolEntry(evict);
    }

    let sessionId = state.sessionFor(key);
    let resume = true;
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      state.setSession(key, sessionId);
      resume = false;
    }
    return createWarm(key, sessionId, resume);
  };

  const bot = new Bot(token);

  const writeHeartbeat = async (): Promise<void> => {
    try {
      await writeFile(HEARTBEAT_FILE, String(Date.now()), "utf8");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "heartbeat write failed";
      logErr(`heartbeat err=${msg}`);
    }
  };
  void writeHeartbeat();
  setInterval(() => void writeHeartbeat(), config.heartbeatSeconds * 1000).unref?.();

  const timeoutMs = config.timeoutMinutes * 60_000;

  async function runTopicJob(
    key: string,
    chatId: number,
    threadId: number,
    prompt: string,
  ): Promise<void> {
    const started = Date.now();
    log(`run_start key=${key} prompt_len=${prompt.length}`);

    const ac = new AbortController();
    abortByKey.set(key, ac);

    const typingExtra = threadExtra(threadId);
    const typingTimer = setInterval(() => {
      void bot.api.sendChatAction(chatId, "typing", typingExtra).catch(() => {});
    }, TYPING_INTERVAL_MS);
    void bot.api.sendChatAction(chatId, "typing", typingExtra).catch(() => {});

    let workingMsgId: number | undefined;
    const steps: string[] = [];
    let lastEditAt = 0;
    let editInFlight = false;
    let pendingEdit = false;
    let editTimer: ReturnType<typeof setTimeout> | undefined;

    const workingBody = (): string => {
      if (steps.length === 0) return "working…";
      return `working…\n${steps.map((s) => `• ${s}`).join("\n")}`;
    };

    const flushEdit = async (): Promise<void> => {
      if (workingMsgId === undefined || editInFlight) {
        pendingEdit = true;
        return;
      }
      const now = Date.now();
      const wait = config.editEveryMs - (now - lastEditAt);
      if (wait > 0) {
        if (!editTimer) {
          editTimer = setTimeout(() => {
            editTimer = undefined;
            void flushEdit();
          }, wait);
        }
        return;
      }
      editInFlight = true;
      pendingEdit = false;
      try {
        await bot.api.editMessageText(
          chatId,
          workingMsgId,
          workingBody(),
        );
        lastEditAt = Date.now();
      } catch (e) {
        if (!isNotModified(e)) {
          const msg = e instanceof Error ? e.message : "edit failed";
          logErr(`working_edit key=${key} err=${msg.slice(0, 80)}`);
        }
      } finally {
        editInFlight = false;
        if (pendingEdit) void flushEdit();
      }
    };

    const onStep = (label: string): void => {
      steps.push(label);
      if (steps.length > 5) steps.shift();
      void flushEdit();
    };

    const poolEntry = pool.get(key);
    if (poolEntry) {
      clearIdle(poolEntry);
      poolEntry.lastUsed = Date.now();
    }

    // Send the answer the moment Claude has written it (the final "result" comes ~1.5 s later).
    // earlySent is set before any await so the result path can never send it a second time.
    let earlySent = false;
    let earlySending: Promise<void> = Promise.resolve();
    const onEarlyAnswer = (text: string): void => {
      if (earlySent) return;
      earlySent = true;
      earlySending = (async () => {
        if (workingMsgId !== undefined) {
          const id = workingMsgId;
          workingMsgId = undefined;
          try {
            await bot.api.deleteMessage(chatId, id);
          } catch {
            /* ignore */
          }
        }
        await sendClaudeOutput(bot.api, chatId, threadId, text);
      })().catch((e) => {
        const msg = e instanceof Error ? e.message : "early send failed";
        logErr(`early_send key=${key} err=${msg.slice(0, 80)}`);
      });
    };

    try {
      const sent = await bot.api.sendMessage(
        chatId,
        "working…",
        threadExtra(threadId),
      );
      workingMsgId = sent.message_id;

      let wc = getWarm(key);
      let result = await wc.ask({
        prompt,
        timeoutMs,
        onStep,
        onEarlyAnswer,
        signal: ac.signal,
      });

      if (
        !result.ok &&
        (result.stderr?.includes("No conversation found") ?? false)
      ) {
        dropPoolEntry(key);
        const sessionId = crypto.randomUUID();
        state.setSession(key, sessionId);
        wc = createWarm(key, sessionId, false);
        result = await wc.ask({
          prompt,
          timeoutMs,
          onStep,
          onEarlyAnswer,
          signal: ac.signal,
        });
        if (result.ok) {
          result.text = `${NO_CONVERSATION_PREFIX}\n${result.text}`;
        }
      }

      if (workingMsgId !== undefined) {
        try {
          await bot.api.deleteMessage(chatId, workingMsgId);
        } catch {
          /* ignore */
        }
        workingMsgId = undefined;
      }

      await earlySending;

      if (!result.ok) {
        const errLine = result.error || result.text || "Something went wrong";
        if (!(earlySent && errLine === "Stopped")) {
          await sendPlain(bot.api, chatId, threadId, `⚠️ ${errLine}`);
        }
        log(
          `run_end key=${key} ok=false ms=${Date.now() - started} err_len=${errLine.length}`,
        );
        return;
      }

      if (!earlySent) {
        await sendClaudeOutput(bot.api, chatId, threadId, result.text);
      }
      log(
        `run_end key=${key} ok=true ms=${Date.now() - started} answer_len=${result.text.length}`,
      );
    } catch (e) {
      if (workingMsgId !== undefined) {
        try {
          await bot.api.deleteMessage(chatId, workingMsgId);
        } catch {
          /* ignore */
        }
      }
      const msg = e instanceof Error ? e.message : "job failed";
      logErr(`run_fail key=${key} ms=${Date.now() - started} err=${msg.slice(0, 120)}`);
      try {
        await sendPlain(bot.api, chatId, threadId, `⚠️ ${msg.slice(0, 500)}`);
      } catch {
        /* ignore */
      }
    } finally {
      clearInterval(typingTimer);
      if (editTimer) clearTimeout(editTimer);
      workingMsgId = undefined;
      const entry = pool.get(key);
      if (entry?.claude.alive) scheduleIdle(key, entry);
    }
  }

  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") return;
    await next();
  });

  const modelKeyboard = (current: string): InlineKeyboard => {
    const kb = new InlineKeyboard();
    for (const m of MODEL_CHOICES) {
      kb.text(m === current ? `✓ ${showModel(m)}` : showModel(m), `model:${m}`).row();
    }
    return kb.text("✕ Close", "menu:close");
  };

  const thinkingKeyboard = (current: string): InlineKeyboard => {
    const kb = new InlineKeyboard();
    EFFORT_LEVELS.forEach((lvl, i) => {
      kb.text(lvl === current ? `✓ ${effortLabel(lvl)}` : effortLabel(lvl), `effort:${lvl}`);
      if (i === 2) kb.row();
    });
    return kb.row().text("✕ Close", "menu:close");
  };

  /** Step 2 of /model: thinking level for the model just tapped (callback "pick:<model>:<level>"). */
  const pickKeyboard = (model: string, currentEffort: string): InlineKeyboard => {
    const kb = new InlineKeyboard();
    EFFORT_LEVELS.forEach((lvl, i) => {
      const label = lvl === currentEffort ? `✓ ${effortLabel(lvl)}` : effortLabel(lvl);
      kb.text(label, `pick:${model}:${lvl}`);
      if (i === 2) kb.row();
    });
    return kb.row().text("← Back", "model:back").text("✕ Close", "menu:close");
  };

  const zoneOf = (): string => state.timeZone() ?? config.timeZone;

  /** /status, also shown after /model: Claude, plan usage, server, services. */
  const statusText = async (key: string): Promise<string> => {
    const busy = queue.running(key);
    const waiting = queue.waiting(key);
    const sessionId = state.sessionFor(key);
    const now = Date.now();
    const lines = [
      "🤖 Claude",
      `Model: ${showModel(modelOf(key))}`,
      `Thinking: ${effortLabel(effortOf(key))}`,
      `This topic: ${busy ? "answering" : "idle"}${waiting ? `, ${waiting} waiting` : ""}`,
    ];
    if (sessionId) {
      lines.push(`Conversation: ${sessionId}`, `On the server: cd ${config.workDir} && claude --resume ${sessionId}`);
    }
    const u = state.planUsage() as PlanUsage | undefined;
    lines.push("", "📊 Plan usage");
    if (u?.fiveHour || u?.week) {
      const tz = zoneOf();
      if (u.fiveHour) lines.push(`5 hours: ${usageLine(u.fiveHour, now, tz)}`);
      if (u.week) lines.push(`Week: ${usageLine(u.week, now, tz)}`);
      lines.push(`As of ${whenLabel(u.at / 1000, now, tz)} (updates with each reply)`);
    } else {
      lines.push("Not known yet (shows after the next reply)");
    }
    try {
      const sv = await serverLines(`${pool.size} of ${config.maxWarm} Claudes running`);
      lines.push("", "🖥 Server", ...sv.server);
      lines.push("", "🔥 Top CPU (right now)", ...sv.topCpu);
      lines.push("", "🧠 Top memory", ...sv.topMem);
    } catch (e) {
      lines.push("", "🖥 Server", `Could not read: ${e instanceof Error ? e.message.slice(0, 60) : "?"}`);
    }
    return lines.join("\n");
  };

  /** Text above the /model buttons, like the Claude app's picker. */
  const modelText = (key: string): string =>
    [
      `Model in this topic: ${showModel(modelOf(key))} (thinking: ${effortLabel(effortOf(key))})`,
      "",
      ...MODEL_CHOICES.map((m) => `${showModel(m)}: ${MODEL_INFO[m]}`),
    ].join("\n");

  const thinkingText = (key: string): string =>
    `Thinking in this topic: ${effortLabel(effortOf(key))} (model: ${showModel(modelOf(key))}).\nMore thinking is slower and uses more of your plan.`;

  /** A topic's running Claude is closed now if quiet (else at its next message) so the change applies. */
  const restartIfQuiet = (key: string): void => {
    const entry = pool.get(key);
    if (
      entry &&
      (entry.model !== modelOf(key) || entry.effort !== effortOf(key)) &&
      !entry.claude.busy
    ) {
      dropPoolEntry(key);
    }
  };

  const setTopicModel = (key: string, model: string): void => {
    state.setModel(key, model);
    restartIfQuiet(key);
    log(`model key=${key} model=${model}`);
  };

  const setTopicEffort = (key: string, level: string): void => {
    state.setEffort(key, level);
    restartIfQuiet(key);
    log(`effort key=${key} effort=${level}`);
  };

  type Reply = (text: string, extra?: { reply_markup?: InlineKeyboard }) => Promise<unknown>;

  const handleModelCommand = async (key: string, arg: string, reply: Reply): Promise<void> => {
    if (!arg) {
      await reply(modelText(key), { reply_markup: modelKeyboard(modelOf(key)) });
      return;
    }
    const model = normalizeModel(arg);
    if (!model) {
      await reply(
        `Unknown model. Use ${MODEL_CHOICES.map((m) => showModel(m)).join(", ")} or a full id like claude-sonnet-5-5.`,
      );
      return;
    }
    setTopicModel(key, model);
    await reply(`Model in this topic: ${showModel(model)}. Same conversation continues.`);
  };

  const handleThinkingCommand = async (key: string, arg: string, reply: Reply): Promise<void> => {
    if (!arg) {
      await reply(thinkingText(key), { reply_markup: thinkingKeyboard(effortOf(key)) });
      return;
    }
    const level = normalizeEffort(arg);
    if (!level) {
      await reply(`Unknown level. Use ${EFFORT_LEVELS.map(effortLabel).join(", ")}.`);
      return;
    }
    setTopicEffort(key, level);
    await reply(`Thinking in this topic: ${effortLabel(level)}. Same conversation continues.`);
  };

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;
    if (chatId === undefined || !state.isAllowed(ctx.from.id)) {
      await ctx.answerCallbackQuery().catch(() => {});
      return;
    }
    const key = tracker.keyFor(chatId, ctx.callbackQuery.message?.message_thread_id, Date.now());
    if (data === "menu:close") {
      await ctx.answerCallbackQuery().catch(() => {});
      // remove the menu; if Telegram refuses (old message), at least drop its buttons
      await ctx.deleteMessage().catch(() => ctx.editMessageReplyMarkup().catch(() => {}));
      return;
    }
    if (data === "model:back") {
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx
        .editMessageText(modelText(key), { reply_markup: modelKeyboard(modelOf(key)) })
        .catch(() => {});
      return;
    }
    if (data.startsWith("model:")) {
      const model = normalizeModel(data.slice("model:".length));
      if (model) {
        // nothing changes yet: ask the thinking level first, then apply both at once
        await ctx.answerCallbackQuery().catch(() => {});
        await ctx
          .editMessageText(`${showModel(model)}: how much thinking?`, {
            reply_markup: pickKeyboard(model, effortOf(key)),
          })
          .catch(() => {});
        return;
      }
    }
    if (data.startsWith("pick:")) {
      const [, rawModel, rawLevel] = data.split(":");
      const model = normalizeModel(rawModel ?? "");
      const level = normalizeEffort(rawLevel ?? "");
      if (model && level) {
        state.setModel(key, model);
        state.setEffort(key, level);
        restartIfQuiet(key);
        log(`model key=${key} model=${model} effort=${level}`);
        await ctx
          .answerCallbackQuery({ text: `${showModel(model)}, ${effortLabel(level)}` })
          .catch(() => {});
        // close the menu, then show the status so the change can be checked
        await ctx.deleteMessage().catch(() => {});
        const thread = ctx.callbackQuery.message?.message_thread_id ?? 0;
        await bot.api
          .sendMessage(chatId, await statusText(key), threadExtra(thread))
          .catch(() => {});
        return;
      }
    }
    if (data.startsWith("effort:")) {
      const level = normalizeEffort(data.slice("effort:".length));
      if (level) {
        setTopicEffort(key, level);
        await ctx.answerCallbackQuery({ text: `Thinking: ${effortLabel(level)}` }).catch(() => {});
        await ctx.deleteMessage().catch(() => {});
        const thread = ctx.callbackQuery.message?.message_thread_id ?? 0;
        await bot.api
          .sendMessage(chatId, await statusText(key), threadExtra(thread))
          .catch(() => {});
        return;
      }
    }
    await ctx.answerCallbackQuery().catch(() => {});
  });

  bot.on("message:forum_topic_created", async (ctx) => {
    const chatId = ctx.chat!.id;
    const threadId = ctx.message.message_thread_id;
    if (threadId !== undefined) {
      tracker.noteNewTopic(chatId, threadId, Date.now());
      log(`topic_created key=${chatId}:${threadId}`);
    }
  });

  bot.on("message", async (ctx) => {
    const chatId = ctx.chat!.id;
    const userId = ctx.from?.id;
    if (userId === undefined) return;

    if (!state.isAllowed(userId)) {
      const now = Date.now();
      const last = pairReplyAt.get(userId) ?? 0;
      if (now - last >= PAIR_REPLY_COOLDOWN_MS) {
        const code = state.newPairCode(userId);
        pairReplyAt.set(userId, now);
        const threadId = ctx.message.message_thread_id ?? 0;
        await ctx.reply(
          `Not paired. On the server run: claude-telegram allow ${code}`,
          threadExtra(threadId),
        );
        log(`pair_prompt user=${userId}`);
      }
      return;
    }

    const now = Date.now();
    const threadId = ctx.message.message_thread_id;
    let key = tracker.keyFor(chatId, threadId, now);
    let { threadId: parsedThread } = parseKey(key);

    const parsed = parseCommand(ctx.message.text ?? ctx.message.caption);
    const cmd = parsed?.cmd ?? null;
    if (cmd === "timezone") {
      const arg = parsed!.arg;
      const reply = (t: string) => ctx.reply(t, threadExtra(parsedThread));
      if (!arg) {
        const z = zoneOf();
        await reply(
          `Times are shown in ${z} (${zoneShort(z, Date.now())}).\nTo change: /timezone Copenhagen, /timezone Bangkok, /timezone Tokyo, or a zone like Europe/Copenhagen.`,
        );
        return;
      }
      const zone = resolveTimeZone(arg);
      if (!zone) {
        await reply("I don't know that place. Try a big city near you (Copenhagen, London, Bangkok) or a zone like Europe/Copenhagen.");
        return;
      }
      state.setTimeZone(zone);
      log(`timezone ${zone}`);
      await reply(`Times are now shown in ${zone} (${zoneShort(zone, Date.now())}).`);
      return;
    }
    if (cmd === "thinking") {
      await handleThinkingCommand(key, parsed!.arg, (text, extra) =>
        ctx.reply(text, { ...threadExtra(parsedThread), ...extra }),
      );
      return;
    }
    if (cmd === "model") {
      await handleModelCommand(key, parsed!.arg, (text, extra) =>
        ctx.reply(text, { ...threadExtra(parsedThread), ...extra }),
      );
      return;
    }
    if (cmd === "new") {
      const ac = abortByKey.get(key);
      if (ac) ac.abort();
      dropPoolEntry(key);
      state.clearSession(key);
      const dropped = queue.drop(key);
      await ctx.reply(
        "New conversation in this topic.",
        threadExtra(parsedThread),
      );
      log(`cmd_new key=${key} dropped=${dropped}`);
      return;
    }
    if (cmd === "stop") {
      const running = queue.running(key);
      const ac = abortByKey.get(key);
      if (running && ac && !ac.signal.aborted) {
        ac.abort();
        await ctx.reply("Stopped.", threadExtra(parsedThread));
        log(`cmd_stop key=${key} stopped=true`);
      } else {
        await ctx.reply("Nothing running.", threadExtra(parsedThread));
        log(`cmd_stop key=${key} stopped=false`);
      }
      return;
    }
    if (cmd === "status") {
      await ctx.reply(await statusText(key), threadExtra(parsedThread));
      return;
    }

    if (ctx.message.forum_topic_created) return;

    let prompt = (ctx.message.text ?? ctx.message.caption ?? "").trim();

    // Replying to one of the bot's messages (e.g. a notification in the Info topic): give Claude
    // that message too. Telegram also sets reply_to_message to the topic's first message for every
    // message in a topic, so skip that one.
    const replied = ctx.message.reply_to_message;
    const quoted =
      replied &&
      replied.from?.is_bot &&
      replied.message_id !== ctx.message.message_thread_id &&
      !replied.forum_topic_created
        ? (replied.text ?? replied.caption ?? "").trim().slice(0, 2000)
        : "";

    // 📣 Info stays for notifications only: anything written there moves to a new topic of its
    // own (named after the notification it replies to), and the conversation continues there.
    let moveOutOfInfo = false;
    const infoThread = state.infoThreadFor(userId);
    if (infoThread !== undefined && parsedThread === infoThread) {
      try {
        const topic = await bot.api.createForumTopic(chatId, topicNameFor(prompt, quoted || undefined));
        const wrote = prompt || "(a file)";
        const header = quoted
          ? `Moved here from ${config.infoTopicName}. You replied to:\n${quoted}\n\nYou wrote:\n${wrote}`
          : `Moved here from ${config.infoTopicName}. You wrote:\n${wrote}`;
        await sendPlain(bot.api, chatId, topic.message_thread_id, header);
        key = `${chatId}:${topic.message_thread_id}`;
        parsedThread = topic.message_thread_id;
        moveOutOfInfo = true;
        log(`info_moved key=${key}`);
      } catch (e) {
        // topics unavailable: answer in Info as before
        logErr(`info_move err=${e instanceof Error ? e.message.slice(0, 80) : "?"}`);
      }
    }

    if (quoted) prompt = `[Replying to this earlier bot message:\n${quoted}\n]\n\n${prompt}`;
    const fileLines: string[] = [];

    const tooBigReply = async (): Promise<void> => {
      await ctx.reply(
        "Too big for Telegram bots (20 MB)",
        threadExtra(parsedThread),
      );
    };

    const saveInbox = async (
      fileId: string,
      size: number | undefined,
      name: string,
    ): Promise<string | null> => {
      if (size !== undefined && size > TELEGRAM_FILE_MAX) {
        await tooBigReply();
        return null;
      }
      const dest = join(INBOX_DIR, `${Date.now()}-${safeFilename(name)}`);
      try {
        await downloadTelegramFile(bot.api, token, fileId, dest);
        return dest;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "download failed";
        logErr(`download key=${key} err=${msg.slice(0, 80)}`);
        await ctx.reply(`⚠️ Could not save file.`, threadExtra(parsedThread));
        return null;
      }
    };

    const photos = ctx.message.photo;
    if (photos && photos.length > 0) {
      const largest = photos[photos.length - 1]!;
      const path = await saveInbox(
        largest.file_id,
        largest.file_size,
        "photo.jpg",
      );
      if (path) fileLines.push(`[file saved at ${path}]`);
    }

    const doc = ctx.message.document;
    if (doc) {
      const path = await saveInbox(
        doc.file_id,
        doc.file_size,
        doc.file_name ?? "document",
      );
      if (path) fileLines.push(`[file saved at ${path}]`);
    }

    const voice = ctx.message.voice;
    if (voice) {
      const path = await saveInbox(
        voice.file_id,
        voice.file_size,
        "voice.ogg",
      );
      if (path) fileLines.push(`[file saved at ${path}]`);
    }

    const video = ctx.message.video;
    if (video) {
      const path = await saveInbox(
        video.file_id,
        video.file_size,
        video.file_name ?? "video.mp4",
      );
      if (path) fileLines.push(`[file saved at ${path}]`);
    }

    if (fileLines.length > 0) {
      prompt = prompt
        ? `${prompt}\n${fileLines.join("\n")}`
        : fileLines.join("\n");
    }

    if (!prompt) return;

    // the copy in the new topic is kept; Info keeps only notifications
    if (moveOutOfInfo) await ctx.deleteMessage().catch(() => {});

    log(`enqueue key=${key} prompt_len=${prompt.length}`);
    queue.push(key, () => runTopicJob(key, chatId, parsedThread, prompt));
  });

  bot.catch((err) => {
    const inner = err.error;
    if (inner instanceof GrammyError && inner.error_code === 409) {
      logErr("grammy 409 conflict, exiting");
      process.exit(1);
    }
    const msg =
      inner instanceof Error
        ? inner.message
        : err instanceof Error
          ? err.message
          : "unknown";
    logErr(`handler err=${msg.slice(0, 200)}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    log(`signal ${signal}`);
    for (const [k, entry] of pool) {
      clearIdle(entry);
      entry.claude.close();
      pool.delete(k);
    }
    await bot.stop();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));

  await bot.start({
    onStart: () => {
      log("polling started");
      const commands = [
        { command: "model", description: "Model and thinking" },
        { command: "new", description: "Fresh conversation" },
        { command: "stop", description: "Stop the reply" },
        { command: "status", description: "Model, thinking, what is running" },
        { command: "timezone", description: "Your time zone for times" },
      ];
      // Also the private-chat scope: it wins over the default one in Telegram, and the old
      // official plugin had put its own /start /help /status there.
      for (const scope of [{ type: "default" as const }, { type: "all_private_chats" as const }]) {
        void bot.api
          .setMyCommands(commands, { scope })
          .catch((e) => logErr(`set_commands err=${e instanceof Error ? e.message.slice(0, 80) : "?"}`));
      }
    },
  });
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : "startup failed";
  logErr(`fatal err=${msg}`);
  process.exit(1);
});