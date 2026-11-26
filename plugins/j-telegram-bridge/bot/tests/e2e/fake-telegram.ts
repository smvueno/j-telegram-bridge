/** A fake Telegram Bot API server for attack tests: serves queued updates, records every call. */
export type Call = { method: string; params: Record<string, unknown> };

export class FakeTelegram {
  calls: Call[] = [];
  deletedTopics = new Set<number>();
  private queue: unknown[] = [];
  private nextUpdate = 1;
  private nextMessage = 1000;
  private nextTopic = 500;
  private server!: ReturnType<typeof Bun.serve>;
  readonly token = "123456:TEST";

  get url() {
    return `http://127.0.0.1:${this.server.port}`;
  }

  start() {
    this.server = Bun.serve({ port: 0, fetch: (req) => this.handle(req) });
    return this;
  }

  stop() {
    this.server.stop(true);
  }

  /** Queue an update (message, callback_query, edited_message, ...). */
  push(update: Record<string, unknown>) {
    this.queue.push({ update_id: this.nextUpdate++, ...update });
  }

  of(method: string) {
    return this.calls.filter((c) => c.method === method);
  }

  private async params(req: Request): Promise<Record<string, unknown>> {
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("application/json")) return (await req.json()) as Record<string, unknown>;
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const out: Record<string, unknown> = {};
      for (const [k, v] of form.entries()) out[k] = typeof v === "string" ? v : `<file ${(v as File).name}>`;
      return out;
    }
    return {};
  }

  private ok(result: unknown) {
    return Response.json({ ok: true, result });
  }

  private fail(code: number, description: string) {
    return Response.json({ ok: false, error_code: code, description });
  }

  private async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith(`/file/bot${this.token}/`)) return new Response("file-bytes");
    const m = url.pathname.match(/^\/bot([^/]+)\/(\w+)$/);
    if (!m || m[1] !== this.token) return this.fail(401, "Unauthorized");
    const method = m[2]!;
    const params = await this.params(req);
    if (method !== "getUpdates") this.calls.push({ method, params });
    const thread = Number(params.message_thread_id ?? 0);
    const chat = { id: Number(params.chat_id ?? 0), type: "private" };
    switch (method) {
      case "getMe":
        return this.ok({ id: 999, is_bot: true, first_name: "Test", username: "test_bot" });
      case "getUpdates": {
        const offset = Number(params.offset ?? 0);
        this.queue = this.queue.filter((u) => (u as { update_id: number }).update_id >= offset);
        if (this.queue.length === 0) await Bun.sleep(150);
        return this.ok(this.queue.slice(0, 50));
      }
      case "sendMessage":
      case "sendPhoto":
      case "sendDocument":
        if (thread && this.deletedTopics.has(thread)) return this.fail(400, "Bad Request: message thread not found");
        return this.ok({ message_id: this.nextMessage++, date: 0, chat, text: params.text, message_thread_id: thread || undefined });
      case "createForumTopic":
        return this.ok({ message_thread_id: this.nextTopic++, name: params.name, icon_color: 0 });
      case "editForumTopic":
        if (this.deletedTopics.has(thread)) return this.fail(400, "Bad Request: TOPIC_ID_INVALID");
        return this.ok(true);
      case "getFile":
        return this.ok({ file_id: params.file_id, file_unique_id: "u", file_path: "documents/f.bin", file_size: 10 });
      case "editMessageText":
        return this.ok({ message_id: Number(params.message_id), date: 0, chat, text: params.text });
      default:
        return this.ok(true); // deleteMessage, sendChatAction, setMyCommands, answerCallbackQuery, ...
    }
  }
}
