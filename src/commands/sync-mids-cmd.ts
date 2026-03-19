import { messageToPostText } from "../markdown/entities-to-markdown.js";
import { loadTelegramDump } from "../sources/telegram-dump.js";
import {
  defaultStatePath,
  loadMigrationState,
  saveMigrationStateAtomic,
} from "../state/migration-state.js";
import { fetchAllChatMessages } from "../max/chat-messages.js";
import type { MessageMigrationState } from "../types.js";

/** Упростить текст для сравнения (Max может отдавать без markdown) */
function simplify(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[_`#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function wordOverlapRatio(a: string, b: string): number {
  const wa = new Set(
    a
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((w) => w.length > 1),
  );
  const wb = new Set(
    b
      .split(/\s+/)
      .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
      .filter((w) => w.length > 1),
  );
  if (wa.size === 0) return 0;
  let hit = 0;
  for (const w of wa) if (wb.has(w)) hit++;
  return hit / wa.size;
}

function dateFilterSubstring(expectedFullText: string): string {
  const classic = expectedFullText.match(/Дата публикации:\s*(\d{1,2}\.\d{1,2}\.\d{4})/i);
  if (classic) {
    return `дата публикации: ${classic[1]}`.toLowerCase();
  }
  const authorLine = expectedFullText.match(/·\s*(\d{1,2}\.\d{1,2}\.\d{4})\s+\d{1,2}:\d{1,2}/);
  if (authorLine) {
    return authorLine[1].toLowerCase();
  }
  return "";
}

export interface SyncMidsOptions {
  token: string;
  chatId: number;
  dumpDir: string;
  statePath?: string;
  onlyMessageIds?: Set<number>;
  /** Перезаписать maxMessageId даже если уже есть */
  force?: boolean;
  dry?: boolean;
  maxPages?: number;
  /** Должен совпадать с тем, как делали post (заголовок с автором) */
  chatAuthorMode?: boolean;
}

/**
 * Сопоставляет посты в чате (GET /messages) с записями state по тексту.
 * Отдельного поиска по тексту в API Max нет.
 */
export async function runSyncMids(opts: SyncMidsOptions): Promise<void> {
  const statePath = opts.statePath ?? defaultStatePath(opts.dumpDir);
  const state = await loadMigrationState(statePath);
  if (!state) throw new Error(`Нет state: ${statePath}`);

  let authorById: Map<number, string> | undefined;
  if (opts.chatAuthorMode) {
    const { messages } = await loadTelegramDump(opts.dumpDir);
    authorById = new Map();
    for (const m of messages) {
      if (m.author) authorById.set(m.id, m.author);
    }
  }

  console.log("Загрузка сообщений чата через GET /messages…");
  const chatRows = await fetchAllChatMessages(opts.token, opts.chatId, {
    maxPages: opts.maxPages,
    onProgress: (n, p) => {
      process.stdout.write(`\r  загружено сообщений: ${n}, страниц: ${p}   `);
    },
  });
  console.log(`\nВсего уникальных сообщений из API: ${chatRows.length}`);

  const candidates = chatRows.map((r) => ({
    mid: r.mid,
    simple: simplify(r.text),
    rawLen: r.text.length,
  }));

  let matched = 0;
  let ambiguous = 0;
  let skipped = 0;
  const usedMids = new Set<string>();

  const sortedIds = Object.keys(state.messages)
    .map(Number)
    .sort((a, b) => a - b);
  for (const dumpId of sortedIds) {
    const entry = state.messages[String(dumpId)];
    if (!entry) continue;
    if (opts.onlyMessageIds && !opts.onlyMessageIds.has(dumpId)) continue;
    if (!entry.messagePosted) {
      skipped++;
      continue;
    }
    if (entry.maxMessageId != null && !opts.force) {
      skipped++;
      continue;
    }

    const exp = messageToPostText(entry, dumpId, !!opts.chatAuthorMode, authorById);
    const expS = simplify(exp);
    if (expS.length < 15) {
      console.warn(`#${dumpId} слишком короткий текст — пропуск сопоставления`);
      continue;
    }

    const dateKey = dateFilterSubstring(exp);
    const pool =
      dateKey.length > 0
        ? candidates.filter((c) => c.simple.includes(dateKey))
        : [];

    const searchIn = pool.length > 0 ? pool : candidates;

    const scored: Array<{ mid: string; score: number }> = [];
    for (const c of searchIn) {
      if (usedMids.has(c.mid)) continue;
      if (c.rawLen < 5) continue;
      const r = wordOverlapRatio(expS, c.simple);
      const prefix =
        c.simple.length >= 40 && expS.length >= 40
          ? c.simple.slice(0, 50) === expS.slice(0, 50)
            ? 0.15
            : 0
          : 0;
      const score = r + prefix;
      if (r >= 0.55 || expS.slice(0, 80) === c.simple.slice(0, 80)) {
        scored.push({ mid: c.mid, score: score + (r >= 0.85 ? 0.2 : 0) });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const second = scored[1];

    if (!best || best.score < 0.5) {
      console.warn(`#${dumpId} не найдено совпадения по тексту (порог)`);
      continue;
    }
    if (second && second.score > 0 && best.score - second.score < 0.08) {
      console.warn(`#${dumpId} неоднозначно (${best.mid} vs ${second.mid}), пропуск`);
      ambiguous++;
      continue;
    }

    if (opts.dry) {
      console.log(`[dry] #${dumpId} (дамп) → mid=${best.mid} (score≈${best.score.toFixed(2)})`);
      matched++;
      continue;
    }

    entry.maxMessageId = best.mid;
    usedMids.add(best.mid);
    await saveMigrationStateAtomic(statePath, state);
    console.log(`#${dumpId} → maxMessageId=${best.mid}`);
    matched++;
  }

  console.log(
    `Готово: сопоставлено ${matched}, пропущено (уже есть mid / не постили) ${skipped}, неоднозначно ${ambiguous}`,
  );
}
