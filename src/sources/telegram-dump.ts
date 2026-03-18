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

/**
 * Определяет вложения сообщения для загрузки в Max.
 * Расширяемо: позже можно добавить альбомы, voice и т.д.
 */
export function attachmentsFromDumpMessage(msg: TelegramDumpMessage): NormalizedAttachment[] {
  const out: NormalizedAttachment[] = [];

  if (msg.photo) {
    out.push({ kind: "image", relativePath: msg.photo });
  }

  if (msg.file && msg.media_type === "video_file") {
    out.push({ kind: "video", relativePath: msg.file });
  } else if (msg.file && !msg.photo) {
    // Документ (pdf, docx, …), не видео-сообщение
    out.push({ kind: "file", relativePath: msg.file });
  }

  return out;
}

export function normalizeDumpMessage(msg: TelegramDumpMessage): NormalizedMessage | null {
  if (msg.type !== "message" || typeof msg.id !== "number") {
    return null;
  }
  const attachments = attachmentsFromDumpMessage(msg);
  return {
    id: msg.id,
    date: msg.date ?? "",
    text_entities: Array.isArray(msg.text_entities) ? msg.text_entities : [],
    attachments,
  };
}

export async function loadTelegramDump(
  dumpDir: string,
): Promise<{ dumpDir: string; resultPath: string; messages: NormalizedMessage[] }> {
  const resultPath = path.join(dumpDir, "result.json");
  const raw = await readFile(resultPath, "utf-8");
  const data = JSON.parse(raw) as TelegramDumpResult;
  if (!Array.isArray(data.messages)) {
    throw new Error(`Нет массива messages в ${resultPath}`);
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

/** Реализация {@link MessageSource} для дампа Telegram Desktop */
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
