import { messageToPostText } from "../markdown/entities-to-markdown.js";
import { loadTelegramDump } from "../sources/telegram-dump.js";
import {
  defaultStatePath,
  loadMigrationState,
  saveMigrationStateAtomic,
} from "../state/migration-state.js";
import { MaxMessagesClient } from "../max/messages-client.js";
import { buildAttachments } from "./post-cmd.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function editWithRetries(
  client: MaxMessagesClient,
  messageId: string,
  text: string,
  attachments: Array<{ type: string; payload: Record<string, unknown> }>,
): Promise<void> {
  const run = () =>
    client.editMessage(messageId, {
      text,
      format: "markdown",
      attachments,
    });

  try {
    await run();
  } catch (e1) {
    if (MaxMessagesClient.isAttachmentNotReady(e1)) {
      for (const ms of [2000, 4000, 8000, 16000]) {
        console.warn(`  attachment.not.ready, waiting ${ms / 1000}s…`);
        await sleep(ms);
        try {
          await run();
          return;
        } catch (e2) {
          if (!MaxMessagesClient.isAttachmentNotReady(e2)) throw e2;
        }
      }
    }
    console.warn("  Retry in 1.5s…");
    await sleep(1500);
    await run();
  }
}

export interface ReattachCmdOptions {
  token: string;
  dumpDir: string;
  statePath?: string;
  onlyMessageIds?: Set<number>;
  /** Max message id (if state has no maxMessageId) — only with a single id in --only-messages */
  mid?: string;
  force?: boolean;
  dry?: boolean;
  chatAuthorMode?: boolean;
}

/**
 * PUT /messages — add attachments to an already posted message (same text).
 */
export async function runReattach(opts: ReattachCmdOptions): Promise<void> {
  const statePath = opts.statePath ?? defaultStatePath(opts.dumpDir);
  const state = await loadMigrationState(statePath);
  if (!state) {
    throw new Error(`No state: ${statePath}`);
  }

  let authorById: Map<number, string> | undefined;
  if (opts.chatAuthorMode) {
    const { messages } = await loadTelegramDump(opts.dumpDir);
    authorById = new Map();
    for (const m of messages) {
      if (m.author) authorById.set(m.id, m.author);
    }
  }

  const client = new MaxMessagesClient(opts.token);
  const ids = Object.keys(state.messages)
    .map(Number)
    .sort((a, b) => a - b);

  const only = opts.onlyMessageIds;
  const singleDumpId =
    only && only.size === 1 ? [...only][0]! : undefined;
  const manualMid =
    opts.mid?.trim() && singleDumpId !== undefined ? opts.mid.trim() : undefined;
  if (opts.mid?.trim() && singleDumpId === undefined) {
    console.warn(
      "--mid requires exactly one id in --only-messages (e.g. --only-messages 58 --mid <Max message id>).",
    );
  }

  let done = 0;
  for (const id of ids) {
    if (only && !only.has(id)) continue;
    const entry = state.messages[String(id)];
    if (!entry) continue;

    if (!entry.messagePosted) {
      console.warn(`#${id} skip: message not posted yet (run post).`);
      continue;
    }

    const resolvedMid =
      entry.maxMessageId != null
        ? String(entry.maxMessageId)
        : id === singleDumpId
          ? manualMid
          : undefined;
    if (!resolvedMid) {
      console.warn(
        `#${id} skip: no maxMessageId in state (POST response did not store id). ` +
          `Pass Max message id: --only-messages ${id} --mid "<copy from Max client / logs>"`,
      );
      continue;
    }

    if (entry.attachmentsApplied && !opts.force) {
      console.log(`#${id} skip (already reattached, use --force to redo)`);
      continue;
    }

    const attachments = buildAttachments(entry);
    if (attachments.length === 0) {
      console.warn(`#${id} no uploaded attachments in state — run upload first`);
      continue;
    }

    const text = messageToPostText(entry, id, !!opts.chatAuthorMode, authorById);
    const mid = resolvedMid;

    if (opts.dry) {
      console.log(`[dry] #${id} PUT /messages?message_id=${mid}`);
      console.log(JSON.stringify({ text, format: "markdown", attachments }, null, 2));
      done++;
      continue;
    }

    console.log(`reattach #${id} → message_id=${mid}…`);
    try {
      await editWithRetries(client, mid, text, attachments);
      entry.attachmentsApplied = true;
      entry.lastError = undefined;
      if (entry.maxMessageId == null) {
        entry.maxMessageId = mid;
      }
      await saveMigrationStateAtomic(statePath, state);
      done++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      entry.lastError = `reattach: ${msg}`;
      await saveMigrationStateAtomic(statePath, state);
      console.error(`#${id}:`, msg);
      process.exitCode = 1;
      break;
    }
  }

  console.log(`Done, processed: ${done}`);
}
