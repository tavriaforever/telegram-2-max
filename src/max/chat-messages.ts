import { MAX_PLATFORM_API, MAX_RPS_DELAY_MS } from "./constants.js";
import { walkMid } from "./messages-client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Message text from a Message object in GET /messages response */
export function extractApiMessageText(msg: unknown): string {
  if (msg == null || typeof msg !== "object") return "";
  const o = msg as Record<string, unknown>;
  if (typeof o.text === "string") return o.text;
  const body = o.body;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.text === "string") return b.text;
    const markup = b.markup;
    if (markup && typeof markup === "object") {
      const m = markup as Record<string, unknown>;
      if (typeof m.text === "string") return m.text;
    }
  }
  for (const v of Object.values(o)) {
    if (typeof v === "string" && v.length > 20 && v.includes("Publication date")) return v;
  }
  return "";
}

export function extractApiMessageMid(msg: unknown): string | undefined {
  const id = walkMid(msg, 0);
  return id ? String(id) : undefined;
}

function compactNorm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Fallback: after POST, if mid was not parsed — GET /messages (recent) and match by text.
 */
export async function lookupMidAfterPost(
  token: string,
  chatId: number,
  postedText: string,
): Promise<string | undefined> {
  await sleep(MAX_RPS_DELAY_MS);
  const url = new URL(`${MAX_PLATFORM_API}/messages`);
  url.searchParams.set("chat_id", String(chatId));
  url.searchParams.set("count", "35");
  const res = await fetch(url.toString(), {
    headers: { Authorization: token },
  });
  if (!res.ok) return undefined;
  let data: { messages?: unknown[] } = {};
  try {
    data = (await res.json()) as { messages?: unknown[] };
  } catch {
    return undefined;
  }
  const messages = Array.isArray(data.messages) ? data.messages : [];
  const target = compactNorm(postedText);
  const head = target.slice(0, Math.min(120, target.length));

  for (const m of messages) {
    const t = compactNorm(extractApiMessageText(m));
    if (t.length < 8) continue;
    if (t === target) return extractApiMessageMid(m);
    if (
      head.length >= 25 &&
      (t.startsWith(head.slice(0, 80)) || target.startsWith(t.slice(0, Math.min(90, t.length))))
    ) {
      return extractApiMessageMid(m);
    }
  }
  return undefined;
}

function extractUnixTs(msg: unknown): number | undefined {
  if (msg == null || typeof msg !== "object") return undefined;
  const o = msg as Record<string, unknown>;
  for (const k of ["timestamp", "time", "date"]) {
    const v = o[k];
    if (typeof v === "number" && v > 1e9 && v < 2e10) return Math.floor(v);
    if (typeof v === "string" && /^\d{10,13}$/.test(v)) return Math.floor(parseInt(v, 10) / (v.length > 10 ? 1 : 1));
  }
  const body = o.body as Record<string, unknown> | undefined;
  if (body) {
    for (const k of ["timestamp", "time"]) {
      const v = body[k];
      if (typeof v === "number" && v > 1e9) return Math.floor(v);
    }
  }
  return undefined;
}

export interface ChatMessageRow {
  mid: string;
  text: string;
  raw: unknown;
}

/**
 * Fetch chat history in batches — {@link https://dev.max.ru/docs-api/methods/GET/messages GET /messages}.
 * `from`/`to` unix params, count up to 100. Walks backward in time.
 */
export async function fetchAllChatMessages(
  token: string,
  chatId: number,
  options?: { maxPages?: number; onProgress?: (loaded: number, page: number) => void },
): Promise<ChatMessageRow[]> {
  const maxPages = options?.maxPages ?? 800;
  const seenMid = new Set<string>();
  const rows: ChatMessageRow[] = [];
  const now = Math.floor(Date.now() / 1000);
  let toBound = now + 3600;
  const fromMin = 1546300800; // 2019-01-01
  let emptyStreak = 0;

  for (let page = 0; page < maxPages; page++) {
    await sleep(MAX_RPS_DELAY_MS);

    const fromBound = Math.max(fromMin, toBound - 14 * 86400);
    const url = new URL(`${MAX_PLATFORM_API}/messages`);
    url.searchParams.set("chat_id", String(chatId));
    url.searchParams.set("count", "100");
    url.searchParams.set("from", String(fromBound));
    url.searchParams.set("to", String(toBound));

    const res = await fetch(url.toString(), {
      headers: { Authorization: token },
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`GET /messages ${res.status}: ${raw.slice(0, 600)}`);
    }

    let data: { messages?: unknown[] } = {};
    try {
      data = JSON.parse(raw) as { messages?: unknown[] };
    } catch {
      throw new Error(`GET /messages: not JSON — ${raw.slice(0, 200)}`);
    }

    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (messages.length === 0) {
      emptyStreak++;
      toBound = fromBound - 1;
      if (emptyStreak >= 30 || toBound < fromMin) break;
      continue;
    }
    emptyStreak = 0;

    let minTs = toBound;
    for (const m of messages) {
      const mid = extractApiMessageMid(m);
      const text = extractApiMessageText(m);
      const ts = extractUnixTs(m);
      if (mid && !seenMid.has(mid)) {
        seenMid.add(mid);
        rows.push({ mid, text, raw: m });
      }
      if (ts != null && ts < minTs) minTs = ts;
    }

    options?.onProgress?.(rows.length, page + 1);

    const nextTo = minTs - 1;
    if (nextTo >= toBound - 60) {
      toBound = fromBound - 1;
    } else {
      toBound = nextTo;
    }
    if (toBound < fromMin) break;
  }

  return rows;
}
