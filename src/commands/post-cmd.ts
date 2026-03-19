import { messageToPostText } from "../markdown/entities-to-markdown.js";
import { loadTelegramDump } from "../sources/telegram-dump.js";
import {
  defaultStatePath,
  loadMigrationState,
  saveMigrationStateAtomic,
} from "../state/migration-state.js";
import { lookupMidAfterPost } from "../max/chat-messages.js";
import { extractPostMessageMid, MaxMessagesClient } from "../max/messages-client.js";
import type { MediaKind, MessageMigrationState } from "../types.js";

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
 * For --dry: always show attachments in API shape;
 * if a file is not uploaded yet — placeholder instead of token.
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
          token: `<upload first: npx tsx src/cli.ts upload --only-messages ${messageId}>`,
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
  } catch (firstErr) {
    let err: unknown = firstErr;

    if (MaxMessagesClient.isTooManyChatRequests(err)) {
      const rateWaits = [35_000, 60_000, 90_000, 120_000];
      let attachmentAfter429: unknown | undefined;
      for (const ms of rateWaits) {
        console.warn(
          `  Chat send rate limit (429), waiting ${ms / 1000}s before retry…`,
        );
        await sleep(ms);
        try {
          return await trySend();
        } catch (e2) {
          if (MaxMessagesClient.isTooManyChatRequests(e2)) {
            continue;
          }
          if (MaxMessagesClient.isAttachmentNotReady(e2)) {
            attachmentAfter429 = e2;
            break;
          }
          throw e2;
        }
      }
      if (attachmentAfter429 != null) {
        err = attachmentAfter429;
      } else if (MaxMessagesClient.isTooManyChatRequests(err)) {
        throw err;
      }
    }

    if (MaxMessagesClient.isAttachmentNotReady(err)) {
      const backoff = [2000, 4000, 8000, 16000, 32000];
      for (const ms of backoff) {
        console.warn(`  Attachment not ready (attachment.not.ready), waiting ${ms / 1000}s…`);
        await sleep(ms);
        try {
          return await trySend();
        } catch (e2) {
          if (!MaxMessagesClient.isAttachmentNotReady(e2)) {
            throw e2;
          }
        }
      }
      throw err;
    }

    console.warn("  Send error, retry in 1.5s…");
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
  /** Only these dump message ids (targeted posting) */
  onlyMessageIds?: Set<number>;
  /** «Name · date time» header from dump (groups / chats) */
  chatAuthorMode?: boolean;
}

export async function runPost(opts: PostCmdOptions): Promise<void> {
  const statePath = opts.statePath ?? defaultStatePath(opts.dumpDir);
  const state = await loadMigrationState(statePath);
  if (!state) {
    throw new Error(`No state file: ${statePath}. Run upload first.`);
  }

  let authorById: Map<number, string> | undefined;
  if (opts.chatAuthorMode) {
    const { messages } = await loadTelegramDump(opts.dumpDir);
    authorById = new Map();
    for (const m of messages) {
      if (m.author) authorById.set(m.id, m.author);
    }
  }

  const ids = Object.keys(state.messages)
    .map(Number)
    .sort((a, b) => a - b);

  if (opts.dry) {
    const baseUrl = "https://platform-api.max.ru";
    let wouldPost = 0;
    const filterNote = opts.onlyMessageIds?.size
      ? ` (only ids: ${[...opts.onlyMessageIds].sort((a, b) => a - b).join(", ")})`
      : "";
    console.log(`[--dry] Dry run${filterNote}.\n`);
    console.log(
      "Attachments: if you have not run upload yet, payload token is a placeholder; after upload real API data is used.\n",
    );
    for (const id of ids) {
      if (opts.onlyMessageIds && !opts.onlyMessageIds.has(id)) continue;
      const entry = state.messages[String(id)];
      if (!entry) continue;
      if (entry.messagePosted) continue;
      if (opts.skipIfMediaMissing && mediaMissing(entry)) continue;
      wouldPost++;
      const text = messageToPostText(entry, id, !!opts.chatAuthorMode, authorById);
      const dryAttachments = buildAttachmentsForDryPreview(id, entry);

      const body: Record<string, unknown> = { text };
      body.format = "markdown";
      if (dryAttachments.length > 0) {
        body.attachments = dryAttachments;
      }

      const url = `${baseUrl}/messages?chat_id=${opts.chatId}`;

      console.log("─".repeat(60));
      console.log(`Message #${id} (dump id)`);
      console.log("─".repeat(60));
      console.log("Full text:");
      console.log(text);
      console.log("");
      console.log("Request that would be sent:");
      console.log("  URL:    ", url);
      console.log("  Method: POST");
      console.log("  Headers:");
      console.log("    Authorization: <token>");
      console.log("    Content-Type:  application/json");
      console.log("  Body (JSON) — same shape as POST /messages:");
      console.log(JSON.stringify(body, null, 2));
      console.log("");
    }
    console.log("─".repeat(60));
    console.log(`Would post: ${wouldPost}`);
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
      entry.lastError = "Skipped: not all media uploaded (--skip-if-media-missing)";
      await saveMigrationStateAtomic(statePath, state);
      console.log(`#${id} skip (missing media)`);
      skipped++;
      continue;
    }

    const text = messageToPostText(entry, id, !!opts.chatAuthorMode, authorById);
    const attachments = buildAttachments(entry);

    console.log(`Posting message id=${id}…`);

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
        console.warn(`#${id}: no mid in POST response → GET /messages…`);
        mid = await lookupMidAfterPost(opts.token, opts.chatId, text);
        midViaLookup = mid != null;
      }
      if (mid != null) {
        entry.maxMessageId = mid;
        if (midViaLookup) {
          console.log(`#${id}: maxMessageId=${mid} (matched text in chat)`);
        }
      } else {
        console.warn(
          `#${id}: could not get mid — use reattach --mid or sync-mids. POST body: ${rawText.slice(0, 350)}…`,
        );
      }
      await saveMigrationStateAtomic(statePath, state);
      posted++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      entry.lastError = msg;
      await saveMigrationStateAtomic(statePath, state);
      console.error(`Error for id=${id}:`, msg);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`Done. Posted: ${posted}, skipped (already posted): ${skipped}`);
}
