import { entitiesToMarkdown, formatPostBody } from "../markdown/entities-to-markdown.js";
import {
  defaultStatePath,
  loadMigrationState,
  saveMigrationStateAtomic,
} from "../state/migration-state.js";
import { lookupMidAfterPost } from "../max/chat-messages.js";
import { extractPostMessageMid, MaxMessagesClient } from "../max/messages-client.js";
import type { MediaKind, MessageMigrationState, MigrationStateFile } from "../types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function buildAttachments(entry: MessageMigrationState): Array<{
  type: string;
  payload: Record<string, unknown>;
}> {
  const order: MediaKind[] = ["image", "video", "file"];
  const out: Array<{ type: string; payload: Record<string, unknown> }> = [];
  for (const kind of order) {
    const slot = entry.upload[kind];
    if (slot?.status === "ok" && slot.payload && Object.keys(slot.payload).length > 0) {
      out.push({ type: kind, payload: slot.payload });
    }
  }
  return out;
}

/**
 * Для --dry: всегда показываем массив attachments в формате API;
 * если файл ещё не загружен — плейсхолдер вместо token.
 */
export function buildAttachmentsForDryPreview(
  messageId: number,
  entry: MessageMigrationState,
): Array<{ type: string; payload: Record<string, unknown> }> {
  const order: MediaKind[] = ["image", "video", "file"];
  const out: Array<{ type: string; payload: Record<string, unknown> }> = [];
  for (const kind of order) {
    if (!entry.expectedMedia[kind]) continue;
    const slot = entry.upload[kind];
    if (slot?.status === "ok" && slot.payload && Object.keys(slot.payload).length > 0) {
      out.push({ type: kind, payload: { ...slot.payload } });
    } else {
      out.push({
        type: kind,
        payload: {
          token: `<загрузите: npx tsx src/cli.ts upload --only-messages ${messageId}>`,
        },
      });
    }
  }
  return out;
}

function mediaMissing(entry: MessageMigrationState): boolean {
  for (const kind of ["image", "video", "file"] as MediaKind[]) {
    if (!entry.expectedMedia[kind]) continue;
    const slot = entry.upload[kind];
    if (!slot || slot.status !== "ok") return true;
  }
  return false;
}

async function sendWithRetries(
  client: MaxMessagesClient,
  params: {
    chatId: number;
    text: string;
    attachments: Array<{ type: string; payload: Record<string, unknown> }>;
  },
): Promise<{ parsed: Record<string, unknown>; rawText: string }> {
  const body = {
    chatId: params.chatId,
    text: params.text,
    format: "markdown" as const,
    attachments: params.attachments.length ? params.attachments : undefined,
  };

  const trySend = () => client.sendMessage(body);

  try {
    return await trySend();
  } catch (e1) {
    if (MaxMessagesClient.isAttachmentNotReady(e1)) {
      const backoff = [2000, 4000, 8000, 16000, 32000];
      for (const ms of backoff) {
        console.warn(`  Вложение не готово (attachment.not.ready), ждём ${ms / 1000} с…`);
        await sleep(ms);
        try {
          return await trySend();
        } catch (e2) {
          if (!MaxMessagesClient.isAttachmentNotReady(e2)) {
            throw e2;
          }
        }
      }
      throw e1;
    }

    console.warn("  Ошибка отправки, повтор через 1.5 с…");
    await sleep(1500);
    return await trySend();
  }
}

export interface PostCmdOptions {
  token: string;
  chatId: number;
  dumpDir: string;
  statePath?: string;
  skipIfMediaMissing?: boolean;
  dry?: boolean;
  /** Только эти id сообщений из дампа (точечная публикация) */
  onlyMessageIds?: Set<number>;
}

export async function runPost(opts: PostCmdOptions): Promise<void> {
  const statePath = opts.statePath ?? defaultStatePath(opts.dumpDir);
  const state = await loadMigrationState(statePath);
  if (!state) {
    throw new Error(`Нет файла состояния: ${statePath}. Сначала выполните upload.`);
  }

  const ids = Object.keys(state.messages)
    .map(Number)
    .sort((a, b) => a - b);

  if (opts.dry) {
    const baseUrl = "https://platform-api.max.ru";
    let wouldPost = 0;
    const filterNote = opts.onlyMessageIds?.size
      ? ` (только id: ${[...opts.onlyMessageIds].sort((a, b) => a - b).join(", ")})`
      : "";
    console.log(`[--dry] Тестовый режим${filterNote}.\n`);
    console.log(
      "Вложения: если upload ещё не делали — token в payload показан как плейсхолдер; после upload подставятся реальные данные из API.\n",
    );
    for (const id of ids) {
      if (opts.onlyMessageIds && !opts.onlyMessageIds.has(id)) continue;
      const entry = state.messages[String(id)];
      if (!entry) continue;
      if (entry.messagePosted) continue;
      if (opts.skipIfMediaMissing && mediaMissing(entry)) continue;
      wouldPost++;
      const md = entitiesToMarkdown(entry.text_entities);
      const text = formatPostBody(entry.date, md);
      const dryAttachments = buildAttachmentsForDryPreview(id, entry);

      const body: Record<string, unknown> = { text };
      body.format = "markdown";
      if (dryAttachments.length > 0) {
        body.attachments = dryAttachments;
      }

      const url = `${baseUrl}/messages?chat_id=${opts.chatId}`;

      console.log("─".repeat(60));
      console.log(`Сообщение #${id} (id в дампе)`);
      console.log("─".repeat(60));
      console.log("Полный текст:");
      console.log(text);
      console.log("");
      console.log("Запрос, который был бы выполнен:");
      console.log("  URL:    ", url);
      console.log("  Method: POST");
      console.log("  Headers:");
      console.log("    Authorization: <token>");
      console.log("    Content-Type:  application/json");
      console.log("  Body (JSON) — формат как в POST /messages:");
      console.log(JSON.stringify(body, null, 2));
      console.log("");
    }
    console.log("─".repeat(60));
    console.log(`Всего к отправке: ${wouldPost}`);
    return;
  }

  const client = new MaxMessagesClient(opts.token);
  let posted = 0;
  let skipped = 0;

  for (const id of ids) {
    if (opts.onlyMessageIds && !opts.onlyMessageIds.has(id)) continue;
    const key = String(id);
    const entry = state.messages[key];
    if (!entry) continue;

    if (entry.messagePosted) {
      skipped++;
      continue;
    }

    if (opts.skipIfMediaMissing && mediaMissing(entry)) {
      entry.lastError = "Пропуск: не все медиа загружены (--skip-if-media-missing)";
      await saveMigrationStateAtomic(statePath, state);
      console.log(`#${id} пропуск (нет медиа)`);
      skipped++;
      continue;
    }

    const md = entitiesToMarkdown(entry.text_entities);
    const text = formatPostBody(entry.date, md);
    const attachments = buildAttachments(entry);

    console.log(`Публикация сообщения id=${id}…`);

    try {
      const { parsed, rawText } = await sendWithRetries(client, {
        chatId: opts.chatId,
        text,
        attachments,
      });
      entry.messagePosted = true;
      entry.lastError = undefined;
      let mid = extractPostMessageMid(parsed, rawText);
      let midViaLookup = false;
      if (mid == null) {
        console.warn(`#${id}: mid нет в ответе POST → GET /messages…`);
        mid = await lookupMidAfterPost(opts.token, opts.chatId, text);
        midViaLookup = mid != null;
      }
      if (mid != null) {
        entry.maxMessageId = mid;
        if (midViaLookup) {
          console.log(`#${id}: maxMessageId=${mid} (по тексту в чате)`);
        }
      } else {
        console.warn(
          `#${id}: mid не удалось получить — reattach с --mid или sync-mids. Ответ POST: ${rawText.slice(0, 350)}…`,
        );
      }
      await saveMigrationStateAtomic(statePath, state);
      posted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      entry.lastError = msg;
      await saveMigrationStateAtomic(statePath, state);
      console.error(`Ошибка для id=${id}:`, msg);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`Готово. Опубликовано: ${posted}, пропущено (уже было): ${skipped}`);
}
