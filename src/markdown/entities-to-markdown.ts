import type { MessageMigrationState, TextEntity } from "../types.js";

/** Escape plain fragments (outside special markdown) */
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
 * Build markdown from Telegram dump `text_entities` (the `text` field is not used).
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

/** Prefix for channel-style posts (must stay in sync with sync-mids date matching). */
export const PUBLICATION_DATE_PREFIX = "Publication date:" as const;

export interface FormatPostBodyOptions {
  /** Chat mode: first line «Name · DD.MM.YYYY HH:MM» */
  chatAuthorMode?: boolean;
  author?: string;
}

function formatHeaderLine(
  dateIso: string,
  opts: FormatPostBodyOptions | undefined,
): string {
  const d = new Date(dateIso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");

  const author = opts?.author?.trim();
  if (opts?.chatAuthorMode && author) {
    return `${author} · ${dd}.${mm}.${yyyy} ${hh}:${min}`;
  }
  return `${PUBLICATION_DATE_PREFIX} ${dd}.${mm}.${yyyy}`;
}

export function formatPostBody(
  dateIso: string,
  entitiesMd: string,
  opts?: FormatPostBodyOptions,
): string {
  const header = formatHeaderLine(dateIso, opts);
  const body = entitiesMd.trim();
  const full = body ? `${header}\n\n${body}` : header;

  if (full.length <= MAX_TEXT) {
    return full;
  }

  const truncated = full.slice(0, MAX_TEXT - 20) + "\n\n...(truncated)";
  return truncated;
}

/**
 * Full post text as used by post / reattach / sync-mids (markdown + header).
 */
export function messageToPostText(
  entry: MessageMigrationState,
  dumpMessageId: number,
  chatAuthorMode: boolean,
  authorById?: Map<number, string>,
): string {
  const fromMap = authorById?.get(dumpMessageId);
  const author = (entry.author ?? fromMap)?.trim();
  return formatPostBody(entry.date, entitiesToMarkdown(entry.text_entities), {
    chatAuthorMode,
    author: author && author.length > 0 ? author : undefined,
  });
}
