import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTelegramDump } from "../src/sources/telegram-dump.js";
import { mergeStateWithDump } from "../src/state/migration-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dumpDir = path.join(__dirname, "fixtures", "mini-dump");

describe("migration state", () => {
  it("builds state from result.json", async () => {
    const { resultPath, messages } = await loadTelegramDump(dumpDir);
    const state = mergeStateWithDump(null, dumpDir, resultPath, messages);
    expect(state.version).toBe(1);
    expect(state.messages["3"]).toBeDefined();
    expect(state.messages["3"]!.upload.image?.relativePath).toMatch(/photo/);
    expect(state.messages["7"]!.upload.video).toBeDefined();
    expect(state.messages["12"]!.expectedMedia).toEqual({});
    expect(state.messages["3"]!.author).toContain("Test Association");
  });

  it("preserves successful upload on second merge", async () => {
    const { resultPath, messages } = await loadTelegramDump(dumpDir);
    const first = mergeStateWithDump(null, dumpDir, resultPath, messages);
    first.messages["3"]!.upload.image!.status = "ok";
    first.messages["3"]!.upload.image!.payload = { token: "abc" };
    const second = mergeStateWithDump(first, dumpDir, resultPath, messages);
    expect(second.messages["3"]!.upload.image?.payload).toEqual({ token: "abc" });
  });
});
