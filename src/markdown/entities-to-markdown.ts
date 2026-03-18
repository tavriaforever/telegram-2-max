import type { TextEntity } from "../types.js";

/** Экранирование для фрагментов вне спец-разметки */
export function escapeMarkdownPlain(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/([*_`\[\]])/g, "\\$1");
}

function escapeForBold(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
}

function escapeForItalic(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_");
}

function escapeLinkLabel(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
}

/**
 * Собирает markdown из text_entities дампа Telegram (поле text не используется).
 */
export function entitiesToMarkdown(entities: TextEntity[] | undefined): string {
  if (!entities?.length) {
    return "";
  }

  const parts: string[] = [];

  for (const e of entities) {
    const t = e.text ?? "";
    switch (e.type) {
      case "plain":
        parts.push(escapeMarkdownPlain(t));
        break;
      case "bold":
        parts.push(`**${escapeForBold(t)}**`);
        break;
      case "italic":
        parts.push(`*${escapeForItalic(t)}*`);
        break;
      case "text_link": {
        const href = e.href ?? "";
        parts.push(`[${escapeLinkLabel(t)}](${href})`);
        break;
      }
      case "email":
        parts.push(`[${escapeLinkLabel(t)}](mailto:${encodeURIComponent(t)})`);
        break;
      case "code":
        parts.push("`" + t.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`");
        break;
      case "pre":
      case "pre_language":
        parts.push("```\n" + t + "\n```");
        break;
      case "underline":
        parts.push(escapeMarkdownPlain(t));
        break;
      case "strikethrough":
        parts.push(`~~${escapeMarkdownPlain(t)}~~`);
        break;
      case "spoiler":
        parts.push(`||${escapeMarkdownPlain(t)}||`);
        break;
      case "blockquote":
        parts.push(
          t.split("\n")
            .map((line) => `> ${escapeMarkdownPlain(line)}`)
            .join("\n"),
        );
        break;
      default:
        parts.push(escapeMarkdownPlain(t));
    }
  }

  return parts.join("");
}

const MAX_TEXT = 4000;

export function formatPostBody(dateIso: string, entitiesMd: string): string {
  const d = new Date(dateIso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const header = `Дата публикации: ${dd}.${mm}.${yyyy}`;
  const body = entitiesMd.trim();
  const full = body ? `${header}\n\n${body}` : header;

  if (full.length <= MAX_TEXT) {
    return full;
  }

  const truncated = full.slice(0, MAX_TEXT - 20) + "\n\n…(обрезано)";
  return truncated;
}
