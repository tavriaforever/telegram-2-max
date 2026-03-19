import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MediaKind,
  MessageMigrationState,
  MigrationStateFile,
  NormalizedMessage,
  UploadSlotState,
} from "../types.js";

const STATE_VERSION = 1 as const;

function emptyUploadSlot(relativePath: string): UploadSlotState {
  return { relativePath, status: "pending" };
}

export function messageToStateEntry(msg: NormalizedMessage): MessageMigrationState {
  const expectedMedia: MessageMigrationState["expectedMedia"] = {};
  const upload: MessageMigrationState["upload"] = {};

  for (const a of msg.attachments) {
    expectedMedia[a.kind] = { relativePath: a.relativePath };
    upload[a.kind] = emptyUploadSlot(a.relativePath);
  }

  return {
    date: msg.date,
    text_entities: msg.text_entities,
    ...(msg.author ? { author: msg.author } : {}),
    expectedMedia,
    upload,
    messagePosted: false,
  };
}

/** Слияние: сохраняем upload ok/error и messagePosted из существующего состояния */
export function mergeStateWithDump(
  existing: MigrationStateFile | null,
  dumpPath: string,
  resultJsonPath: string,
  normalized: NormalizedMessage[],
): MigrationStateFile {
  const messages: Record<string, MessageMigrationState> = {};
  const prev = existing?.messages ?? {};

  for (const msg of normalized) {
    const key = String(msg.id);
    const fresh = messageToStateEntry(msg);
    const old = prev[key];

    if (old) {
      fresh.messagePosted = old.messagePosted;
      fresh.maxMessageId = old.maxMessageId;
      fresh.attachmentsApplied = old.attachmentsApplied;
      fresh.lastError = undefined;

      for (const kind of ["image", "video", "file"] as MediaKind[]) {
        const exp = fresh.expectedMedia[kind];
        const oldExp = old.expectedMedia[kind];
        const oldSlot = old.upload[kind];

        if (!exp) {
          continue;
        }

        if (
          oldSlot &&
          oldExp?.relativePath === exp.relativePath &&
          oldSlot.status === "ok" &&
          oldSlot.payload
        ) {
          fresh.upload[kind] = { ...oldSlot };
        } else if (
          oldSlot &&
          oldExp?.relativePath === exp.relativePath &&
          oldSlot.status === "error"
        ) {
          fresh.upload[kind] = {
            relativePath: exp.relativePath,
            status: "error",
            error: oldSlot.error,
          };
        }
      }
    }

    messages[key] = fresh;
  }

  return {
    version: STATE_VERSION,
    dumpPath: path.resolve(dumpPath),
    resultJsonPath: path.resolve(resultJsonPath),
    updatedAt: new Date().toISOString(),
    messages,
  };
}

export async function loadMigrationState(statePath: string): Promise<MigrationStateFile | null> {
  try {
    const raw = await readFile(statePath, "utf-8");
    const data = JSON.parse(raw) as MigrationStateFile;
    if (data.version !== 1 || typeof data.messages !== "object") {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function saveMigrationStateAtomic(
  statePath: string,
  state: MigrationStateFile,
): Promise<void> {
  const dir = path.dirname(statePath);
  await mkdir(dir, { recursive: true });
  state.updatedAt = new Date().toISOString();
  const tmp = `${statePath}.${process.pid}.tmp`;
  const json = JSON.stringify(state, null, 2);
  await writeFile(tmp, json, "utf-8");
  await rename(tmp, statePath);
}

export function defaultStatePath(dumpDir: string): string {
  return path.join(path.resolve(dumpDir), "migration-state.json");
}
