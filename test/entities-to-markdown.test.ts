import { describe, expect, it } from "vitest";
import {
  entitiesToMarkdown,
  escapeMarkdownPlain,
  formatPostBody,
} from "../src/markdown/entities-to-markdown.js";
import type { TextEntity } from "../src/types.js";

describe("entitiesToMarkdown", () => {
  it("bold, italic, link как в дампе id=3", () => {
    const entities: TextEntity[] = [
      { type: "bold", text: "Заголовок" },
      { type: "plain", text: "\n" },
      { type: "italic", text: "дата" },
      { type: "plain", text: "\n\nтекст " },
      {
        type: "text_link",
        text: "ссылка",
        href: "https://example.com",
      },
      { type: "plain", text: "" },
    ];
    const md = entitiesToMarkdown(entities);
    expect(md).toContain("**Заголовок**");
    expect(md).toContain("*дата*");
    expect(md).toContain("[ссылка](https://example.com)");
  });

  it("email entity", () => {
    const md = entitiesToMarkdown([
      { type: "plain", text: "пишите на " },
      { type: "email", text: "a@b.ru" },
    ]);
    expect(md).toContain("mailto:");
    expect(md).toContain("a@b.ru");
  });

  it("пустые entities", () => {
    expect(entitiesToMarkdown([])).toBe("");
    expect(entitiesToMarkdown(undefined)).toBe("");
  });
});

describe("escapeMarkdownPlain", () => {
  it("экранирует спецсимволы", () => {
    expect(escapeMarkdownPlain("a*b[c]")).toMatch(/\*/);
  });
});

describe("formatPostBody", () => {
  it("добавляет строку даты", () => {
    const s = formatPostBody("2024-11-22T14:39:07", "**x**");
    expect(s.startsWith("Дата публикации: 22.11.2024")).toBe(true);
    expect(s).toContain("**x**");
  });
});
