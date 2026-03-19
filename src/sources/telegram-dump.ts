import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  MediaKind,
  NormalizedAttachment,
  NormalizedMessage,
  TelegramDumpMessage,
  TextEntity,
} from "../types.js";
import type { MessageSource } from "./message-source.js";

export interface TelegramDumpResult {
  name?: string;
  type?: string;
  id?: number;
  messages: TelegramDumpMessage[];
}

/** Telegram export placeholders when media was not included in the archive */
const DUMP_PATH_PLACEHOLDER_MARKERS = [
  "file not included",
  "change data exporting settings",
] as const;

/**
 * Dump path points at a real file under the export directory (not a placeholder string).
 */
export function isUsableDumpMediaPath(relativePath: string | undefined): relativePath is string {
  if (relativePath == null || typeof relativePath !== "string") {
    return false;
  }
  const s = relativePath.trim();
  if (!s || s.startsWith("(")) {
    return false;
  }
  const lower = s.toLowerCase();
  for (const m of DUMP_PATH_PLACEHOLDER_MARKERS) {
    if (lower.includes(m)) {
      return false;
    }
  }
  if (s.includes("\0")) {
    return false;
  }
  return true;
}

/**
 * Resolve message attachments to upload to Max.
 * Extensible: albums, voice, etc. later.
 */
export function attachmentsFromDumpMessage(msg: TelegramDumpMessage): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = [];

  if (isUsableDumpMediaPath(msg.photo)) {
    out.push({ kind: "image", relativePath: msg.photo });
  }

  if (isUsableDumpMediaPath(msg.file)) {
    if (msg.media_type === "video_file") {
      out.push({ kind: "video", relativePath: msg.file });
    } else if (!msg.photo) {
      // Document (pdf, docx, …), not a video message; stickers without a file are skipped
      out.push({ kind: "file", relativePath: msg.file });
    }
  }

  return out;
}

export function normalizeDumpMessage(msg: TelegramDumpMessage): NormalizedMessage | null {
  if (msg.type !== "message" || typeof msg.id !== "number") {
    return null;
  }
  const attachments = attachmentsFromDumpMessage(msg);
  const from = typeof msg.from === "string" ? msg.from.trim() : "";
  return {
    id: msg.id,
    date: msg.date ?? "",
    text_entities: Array.isArray(msg.text_entities) ? msg.text_entities : [],
    attachments,
    ...(from ? { author: from } : {}),
  };
}

export async function loadTelegramDump(
  dumpDir: string,
): Promise<{ dumpDir: string; resultPath: string; messages: NormalizedMessage[] }> {
  const resultPath = path.join(dumpDir, "result.json");
  const raw = await readFile(resultPath, "utf-8");
  const data = JSON.parse(raw) as TelegramDumpResult;
  if (!Array.isArray(data.messages)) {
    throw new Error(`No messages array in ${resultPath}`);
  }
  const messages: NormalizedMessage[] = [];
  for (const m of data.messages) {
    const n = normalizeDumpMessage(m);
    if (n) messages.push(n);
  }
  messages.sort((a, b) => a.id - b.id);
  return { dumpDir: path.resolve(dumpDir), resultPath, messages };
}

export function resolveMediaPath(dumpDir: string, relativePath: string): string {
  return path.join(dumpDir, relativePath);
}

export function cloneEntities(entities: TextEntity[]): TextEntity[] {
  return entities.map((e) => ({ ...e }));
}

/** {@link MessageSource} for Telegram Desktop export */
export class TelegramDumpSource implements MessageSource {
  readonly dumpDir: string;

  constructor(dumpDir: string) {
    this.dumpDir = path.resolve(dumpDir);
  }

  async loadMessages(): Promise<NormalizedMessage[]> {
    const { messages } = await loadTelegramDump(this.dumpDir);
    return messages;
  }
}
