import { getPostMessageDelayMs, MAX_PLATFORM_API, MAX_RPS_DELAY_MS } from "./constants.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function walkMid(obj: unknown, depth: number): string | undefined {
  if (depth > 8 || obj == null || typeof obj !== "object") return undefined;
  const o = obj as Record<string, unknown>;
  for (const k of ["mid", "message_id"]) {
    const v = o[k];
    if (typeof v === "string" || typeof v === "number") return String(v);
  }
  for (const v of Object.values(o)) {
    const r = walkMid(v, depth + 1);
    if (r) return r;
  }
  return undefined;
}

/** Message id in Max from POST /messages response */
export function extractMaxMessageId(parsed: Record<string, unknown>): string | undefined {
  for (const key of ["message", "data", "result"]) {
    const root = parsed[key];
    if (root && typeof root === "object") {
      const w = walkMid(root, 0);
      if (w) return w;
      const m = root as Record<string, unknown>;
      const id = m.id;
      if (typeof id === "string" || typeof id === "number") return String(id);
    }
  }
  return undefined;
}

function midFromMessageNode(node: unknown): string | undefined {
  if (node == null || typeof node !== "object") return undefined;
  const o = node as Record<string, unknown>;
  if (o.mid != null && (typeof o.mid === "string" || typeof o.mid === "number")) {
    return String(o.mid);
  }
  const body = o.body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (b.mid != null && (typeof b.mid === "string" || typeof b.mid === "number")) {
      return String(b.mid);
    }
    if (b.message_id != null) return String(b.message_id);
  }
  return undefined;
}

/** Parse raw POST /messages JSON when the shape is non-standard */
export function extractMidFromResponseRawJson(raw: string): string | undefined {
  if (!raw?.trim()) return undefined;
  const tryPat = (re: RegExp): string | undefined => {
    const m = raw.match(re);
    return m?.[1] ? String(m[1]) : undefined;
  };
  const midQ = tryPat(/"mid"\s*:\s*"([^"]+)"/);
  if (midQ && midQ.length >= 2) return midQ;
  const midN = tryPat(/"mid"\s*:\s*(-?\d+)/);
  if (midN) return midN;
  return tryPat(/"message_id"\s*:\s*"([^"]+)"/) ?? tryPat(/"message_id"\s*:\s*(-?\d+)/);
}

/**
 * Extract mid after successful POST /messages (several possible Max response shapes).
 */
export function extractPostMessageMid(
  parsed: Record<string, unknown>,
  rawText: string,
): string | undefined {
  const roots: unknown[] = [
    parsed.message,
    parsed.data,
    parsed.result,
    (parsed.data as Record<string, unknown> | undefined)?.message,
    (parsed.result as Record<string, unknown> | undefined)?.message,
  ];
  for (const r of roots) {
    const m = midFromMessageNode(r);
    if (m) return m;
    if (r && typeof r === "object") {
      const inner = (r as Record<string, unknown>).message;
      const m2 = midFromMessageNode(inner);
      if (m2) return m2;
    }
  }
  const w = walkMid(parsed, 0);
  if (w && w.length >= 2) return w;
  return extractMidFromResponseRawJson(rawText) ?? extractMaxMessageId(parsed);
}

export interface SendMessageOptions {
  chatId: number;
  text: string;
  format?: "markdown" | "html";
  attachments?: Array<{ type: string; payload: Record<string, unknown> }>;
}

export class MaxMessagesClient {
  /** Time of last successful POST /messages (gap between chat messages) */
  private lastChatSendOkAt = 0;

  constructor(
    private readonly token: string,
    private readonly onRequest?: () => void,
  ) {}

  private async throttle(): Promise<void> {
    await sleep(MAX_RPS_DELAY_MS);
  }

  private async throttleBeforeChatSend(): Promise<void> {
    const gap = getPostMessageDelayMs();
    if (this.lastChatSendOkAt > 0) {
      const wait = gap - (Date.now() - this.lastChatSendOkAt);
      if (wait > 0) {
        await sleep(wait);
      }
    }
  }

  async sendMessage(
    opts: SendMessageOptions,
  ): Promise<{ parsed: Record<string, unknown>; rawText: string }> {
    await this.throttleBeforeChatSend();
    this.onRequest?.();

    const url = new URL(`${MAX_PLATFORM_API}/messages`);
    url.searchParams.set("chat_id", String(opts.chatId));

    const body: Record<string, unknown> = {
      text: opts.text,
    };
    if (opts.format) body.format = opts.format;
    if (opts.attachments?.length) body.attachments = opts.attachments;

    const res = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const rawText = await res.text();
    if (!res.ok) {
      const err = new Error(`messages ${res.status}: ${rawText.slice(0, 800)}`) as Error & {
        status: number;
        body: string;
      };
      err.status = res.status;
      err.body = rawText;
      throw err;
    }

    this.lastChatSendOkAt = Date.now();

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      /* raw body still in rawText for regex mid */
    }
    return { parsed, rawText };
  }

  /**
   * Edit message — {@link https://dev.max.ru/docs-api/methods/PUT/messages PUT /messages}.
   * Query: `message_id` (string). Body: `text`, `format`, `attachments` (empty list removes all attachments).
   * Editing may be limited to messages newer than ~24h (per Max rules).
   */
  async editMessage(
    messageId: string,
    opts: {
      text: string;
      format?: "markdown" | "html";
      attachments?: Array<{ type: string; payload: Record<string, unknown> }>;
    },
  ): Promise<Record<string, unknown>> {
    await this.throttle();
    this.onRequest?.();

    const url = new URL(`${MAX_PLATFORM_API}/messages`);
    url.searchParams.set("message_id", String(messageId));

    const body: Record<string, unknown> = { text: opts.text };
    if (opts.format) body.format = opts.format;
    if (opts.attachments?.length) body.attachments = opts.attachments;

    const res = await fetch(url.toString(), {
      method: "PUT",
      headers: {
        Authorization: this.token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not JSON */
    }

    if (!res.ok) {
      const err = new Error(`edit PUT /messages ${res.status}: ${text.slice(0, 800)}`) as Error & {
        status: number;
        body: string;
      };
      err.status = res.status;
      err.body = text;
      throw err;
    }

    if (parsed.success === false) {
      const msg = typeof parsed.message === "string" ? parsed.message : text;
      throw new Error(`edit PUT /messages: success=false: ${msg}`);
    }

    return parsed;
  }

  static isAttachmentNotReady(err: unknown): boolean {
    if (err && typeof err === "object" && "body" in err) {
      const b = String((err as { body: string }).body);
      return b.includes("attachment.not.ready") || b.includes("file.not.processed");
    }
    return false;
  }

  /** 429 / too many chat send requests */
  static isTooManyChatRequests(err: unknown): boolean {
    if (err && typeof err === "object" && "status" in err) {
      const status = (err as { status: number }).status;
      if (status === 429) return true;
    }
    if (err && typeof err === "object" && "body" in err) {
      const b = String((err as { body: string }).body).toLowerCase();
      return (
        b.includes("too.many.requests") ||
        b.includes("too-many-chat-messages") ||
        b.includes("too_many")
      );
    }
    return false;
  }
}
