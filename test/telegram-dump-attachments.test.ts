import { describe, expect, it } from "vitest";
import {
  attachmentsFromDumpMessage,
  isUsableDumpMediaPath,
} from "../src/sources/telegram-dump.js";
import type { TelegramDumpMessage } from "../src/types.js";

describe("isUsableDumpMediaPath", () => {
  it("accepts normal relative paths", () => {
    expect(isUsableDumpMediaPath("photos/photo_1@09-09-2024.jpg")).toBe(true);
    expect(isUsableDumpMediaPath("video_files/foo.mp4")).toBe(true);
  });

  it("rejects Telegram placeholder (file not exported)", () => {
    expect(
      isUsableDumpMediaPath(
        "(File not included. Change data exporting settings to download.)",
      ),
    ).toBe(false);
    expect(isUsableDumpMediaPath("(File not included.)")).toBe(false);
  });

  it("rejects empty and whitespace", () => {
    expect(isUsableDumpMediaPath("")).toBe(false);
    expect(isUsableDumpMediaPath("   ")).toBe(false);
    expect(isUsableDumpMediaPath(undefined)).toBe(false);
  });
});

describe("attachmentsFromDumpMessage", () => {
  it("does not create slot for sticker without file in archive", () => {
    const msg = {
      id: 6,
      type: "message",
      date: "2024-01-01",
      file: "(File not included. Change data exporting settings to download.)",
      file_name: "AnimatedSticker.tgs",
      media_type: "sticker",
      text_entities: [],
    } as TelegramDumpMessage;
    expect(attachmentsFromDumpMessage(msg)).toEqual([]);
  });

  it("creates image for real photo", () => {
    const msg = {
      id: 14,
      type: "message",
      date: "2024-01-01",
      photo: "photos/photo_2@10-09-2024_17-03-04.jpg",
      text_entities: [],
    } as TelegramDumpMessage;
    expect(attachmentsFromDumpMessage(msg)).toEqual([
      { kind: "image", relativePath: "photos/photo_2@10-09-2024_17-03-04.jpg" },
    ]);
  });

  it("does not create slot when photo is placeholder", () => {
    const msg = {
      id: 1,
      type: "message",
      date: "2024-01-01",
      photo: "(File not included. Change data exporting settings to download.)",
      text_entities: [],
    } as TelegramDumpMessage;
    expect(attachmentsFromDumpMessage(msg)).toEqual([]);
  });
});
