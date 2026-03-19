import { describe, expect, it } from "vitest";
import {
  entitiesToMarkdown,
  escapeMarkdownPlain,
  formatPostBody,
  messageToPostText,
  PUBLICATION_DATE_PREFIX,
} from "../src/markdown/entities-to-markdown.js";
import type { TextEntity } from "../src/types.js";

describe("entitiesToMarkdown", () => {
  it("bold, italic, link like dump id=3", () => {
    const entities: TextEntity[] = [
      { type: "bold", text: "Heading" },
      { type: "plain", text: "\n" },
      { type: "italic", text: "date" },
      { type: "plain", text: "\n\ntext " },
      {
        type: "text_link",
        text: "link",
        href: "https://example.com",
      },
      { type: "plain", text: "" },
    ];
    const md = entitiesToMarkdown(entities);
    expect(md).toContain("**Heading**");
    expect(md).toContain("*date*");
    expect(md).toContain("[link](https://example.com)");
  });

  it("email entity", () => {
    const md = entitiesToMarkdown([
      { type: "plain", text: "write to " },
      { type: "email", text: "a@b.ru" },
    ]);
    expect(md).toContain("mailto:");
    expect(md).toContain("a@b.ru");
  });

  it("empty entities", () => {
    expect(entitiesToMarkdown([])).toBe("");
    expect(entitiesToMarkdown(undefined)).toBe("");
  });
});

describe("escapeMarkdownPlain", () => {
  it("escapes special chars", () => {
    expect(escapeMarkdownPlain("a*b[c]")).toMatch(/\*/);
  });
});

describe("formatPostBody", () => {
  it("adds publication date line", () => {
    const s = formatPostBody("2024-11-22T14:39:07", "**x**");
    expect(s.startsWith(`${PUBLICATION_DATE_PREFIX} 22.11.2024`)).toBe(true);
    expect(s).toContain("**x**");
  });

  it("chatAuthorMode: name and date-time", () => {
    const s = formatPostBody("2024-09-09T20:49:58", "hello", {
      chatAuthorMode: true,
      author: "Nick",
    });
    expect(s.startsWith("Nick · 09.09.2024 20:49")).toBe(true);
    expect(s).toContain("hello");
  });

  it("chatAuthorMode without author — channel style", () => {
    const s = formatPostBody("2024-11-22T14:39:07", "x", {
      chatAuthorMode: true,
    });
    expect(s.startsWith(PUBLICATION_DATE_PREFIX)).toBe(true);
  });
});

describe("messageToPostText", () => {
  it("takes author from entry or map", () => {
    const entry = {
      date: "2024-01-01T12:00:00",
      text_entities: [{ type: "plain" as const, text: "hi" }],
      expectedMedia: {},
      upload: {},
      messagePosted: false,
      author: "Anna",
    };
    expect(messageToPostText(entry, 1, true, undefined)).toMatch(/^Anna · 01\.01\.2024 12:00/);
    const noAuthor = { ...entry, author: undefined };
    const map = new Map<number, string>([[5, "Boris"]]);
    expect(messageToPostText(noAuthor, 5, true, map)).toMatch(/^Boris ·/);
  });
});
