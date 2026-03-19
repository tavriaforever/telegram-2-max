import { access } from "node:fs/promises";
import path from "node:path";
import cliProgress from "cli-progress";
import { loadTelegramDump, resolveMediaPath } from "../sources/telegram-dump.js";
import {
  defaultStatePath,
  loadMigrationState,
  mergeStateWithDump,
  saveMigrationStateAtomic,
} from "../state/migration-state.js";
import { MaxUploadClient } from "../max/upload-client.js";
import type { MediaKind, MigrationStateFile } from "../types.js";

function countPendingSlots(
  state: MigrationStateFile,
  onlyMessageIds?: Set<number>,
): number {
  let n = 0;
  for (const [key, m] of Object.entries(state.messages)) {
    const id = Number(key);
    if (onlyMessageIds && !onlyMessageIds.has(id)) continue;
    for (const kind of ["image", "video", "file"] as MediaKind[]) {
      const slot = m.upload[kind];
      if (slot?.status === "pending") n++;
    }
  }
  return n;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export interface UploadCmdOptions {
  token: string;
  dumpDir: string;
  statePath?: string;
  strict?: boolean;
  dry?: boolean;
  /** Upload media only for these dump message ids */
  onlyMessageIds?: Set<number>;
  /** Reset status error → pending (retry after fixing code / API) */
  resetFailed?: boolean;
}

export async function runUpload(opts: UploadCmdOptions): Promise<void> {
  const { dumpDir, token } = opts;
  const statePath = opts.statePath ?? defaultStatePath(dumpDir);

  const { resultPath, messages } = await loadTelegramDump(dumpDir);
  const existing = await loadMigrationState(statePath);
  let state = mergeStateWithDump(existing, dumpDir, resultPath, messages);

  if (opts.resetFailed) {
    for (const [key, entry] of Object.entries(state.messages)) {
      const id = Number(key);
      if (opts.onlyMessageIds && !opts.onlyMessageIds.has(id)) continue;
      for (const kind of ["image", "video", "file"] as MediaKind[]) {
        const slot = entry.upload[kind];
        if (slot?.status === "error") {
          entry.upload[kind] = {
            relativePath: slot.relativePath,
            status: "pending",
          };
        }
      }
    }
  }

  await saveMigrationStateAtomic(statePath, state);

  const only = opts.onlyMessageIds;
  const pendingTotal = countPendingSlots(state, only);
  if (pendingTotal === 0) {
    if (only?.size) {
      console.log(
        "No files in pending status for the given --only-messages (already uploaded or no media for these ids).",
      );
    } else {
      console.log("Nothing to upload (all done or no media).");
    }
    return;
  }

  if (opts.dry) {
    const filterNote = only?.size
      ? ` (only ids: ${[...only].sort((a, b) => a - b).join(", ")})`
      : "";
    console.log(`[--dry] Dry run${filterNote}. Slots to upload: ${pendingTotal}`);
    const messageIds = Object.keys(state.messages)
      .map(Number)
      .sort((a, b) => a - b);
    for (const id of messageIds) {
      if (only && !only.has(id)) continue;
      const entry = state.messages[String(id)];
      if (!entry) continue;
      for (const kind of ["image", "video", "file"] as MediaKind[]) {
        const slot = entry.upload[kind];
        if (!slot || slot.status !== "pending") continue;
        const abs = resolveMediaPath(state.dumpPath, slot.relativePath);
        console.log(`  msg ${id} | ${kind} | ${slot.relativePath} -> ${abs}`);
      }
    }
    console.log("State written:", statePath);
    return;
  }

  console.log(`Slots to upload: ${pendingTotal}`);

  const bar = new cliProgress.SingleBar(
    {
      format: "Upload [{bar}] {percentage}% | {value}/{total} | msg {msgId} | {kind}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    },
    cliProgress.Presets.shades_classic,
  );
  bar.start(pendingTotal, 0, { msgId: "-", kind: "-" });

  let done = 0;
  const client = new MaxUploadClient(token);

  const messageIds = Object.keys(state.messages)
    .map(Number)
    .sort((a, b) => a - b);

  for (const id of messageIds) {
    if (only && !only.has(id)) continue;
    const key = String(id);
    const entry = state.messages[key];
    if (!entry) continue;

    for (const kind of ["image", "video", "file"] as MediaKind[]) {
      const slot = entry.upload[kind];
      if (!slot || slot.status !== "pending") continue;

      const abs = resolveMediaPath(state.dumpPath, slot.relativePath);
      bar.update(done, { msgId: String(id), kind });

      if (!(await fileExists(abs))) {
        slot.status = "error";
        slot.error = `File not found: ${abs}`;
        await saveMigrationStateAtomic(statePath, state);
        done++;
        bar.increment();
        if (opts.strict) {
          bar.stop();
          throw new Error(slot.error);
        }
        continue;
      }

      try {
        const { payload } = await client.uploadFile(abs, kind);
        slot.status = "ok";
        slot.payload = payload;
        slot.error = undefined;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        slot.status = "error";
        slot.error = msg;
        await saveMigrationStateAtomic(statePath, state);
        done++;
        bar.increment();
        if (opts.strict) {
          bar.stop();
          throw e;
        }
        continue;
      }

      await saveMigrationStateAtomic(statePath, state);
      done++;
      bar.increment();

      // attachment.not.ready does not apply at upload; brief pause after large files
      const sizeKind = kind === "video" ? 2000 : 500;
      await new Promise((r) => setTimeout(r, sizeKind));
    }
  }

  bar.stop();
  console.log("Upload finished. State:", statePath);
}
