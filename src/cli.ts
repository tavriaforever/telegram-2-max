#!/usr/bin/env node
import { Command } from "commander";
import { runUpload } from "./commands/upload-cmd.js";
import { runPost } from "./commands/post-cmd.js";
import { runReattach } from "./commands/reattach-cmd.js";
import { runSyncMids } from "./commands/sync-mids-cmd.js";
import { parseOnlyMessageIds } from "./cli-parse.js";

const program = new Command();

program.name("max-migrate").description("Миграция дампа Telegram → Max");

program
  .command("upload")
  .description("Загрузить медиа в Max и заполнить migration-state.json")
  .option("--token <token>", "Токен бота Max", process.env.MAX_BOT_TOKEN)
  .option("--dump <dir>", "Каталог дампа (где result.json)", "telegram-dump")
  .option("--state <path>", "Путь к migration-state.json (по умолчанию: <dump>/migration-state.json)")
  .option("--strict", "Остановиться при первой ошибке загрузки")
  .option("--dry", "Тестовый режим: только создать/обновить state и показать, что было бы загружено")
  .option(
    "--only-messages <ids>",
    "Только указанные id сообщений из дампа (через запятую), например: 3,7,12",
  )
  .option(
    "--reset-failed",
    "Сбросить ошибки загрузки (error→pending) для повторной попытки",
  )
  .action(
    async (o: {
      token?: string;
      dump: string;
      state?: string;
      strict?: boolean;
      dry?: boolean;
      onlyMessages?: string;
      resetFailed?: boolean;
    }) => {
    const token = o.dry ? "" : (o.token?.trim() ?? "");
    if (!token) {
      if (!o.dry) {
        console.error("Укажите --token или переменную MAX_BOT_TOKEN");
        process.exit(1);
      }
    }
    await runUpload({
      token: token || "dry-run",
      dumpDir: o.dump,
      statePath: o.state,
      strict: o.strict,
      dry: o.dry,
      onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
      resetFailed: o.resetFailed,
    });
  });

program
  .command("reattach")
  .description(
    "Добавить вложения к уже опубликованным постам (PUT /messages), если пост ушёл без видео",
  )
  .option("--token <token>", "Токен бота Max", process.env.MAX_BOT_TOKEN)
  .option("--dump <dir>", "Каталог дампа", "telegram-dump")
  .option("--state <path>", "Путь к migration-state.json")
  .option("--only-messages <ids>", "Только id сообщений дампа (через запятую)")
  .option(
    "--mid <id>",
    "ID сообщения в Max (если в state нет maxMessageId); только с одним id в --only-messages",
  )
  .option("--force", "Повторить reattach даже если уже помечено attachmentsApplied")
  .option("--dry", "Показать тела PUT без вызова API")
  .option(
    "--chat-author-mode",
    "Тот же заголовок текста, что при post --chat-author-mode",
  )
  .action(
    async (o: {
      token?: string;
      dump: string;
      state?: string;
      onlyMessages?: string;
      mid?: string;
      force?: boolean;
      dry?: boolean;
      chatAuthorMode?: boolean;
    }) => {
      const token = o.dry ? "" : (o.token?.trim() ?? "");
      if (!token && !o.dry) {
        console.error("Укажите --token или MAX_BOT_TOKEN");
        process.exit(1);
      }
      await runReattach({
        token: token || "dry",
        dumpDir: o.dump,
        statePath: o.state,
        onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
        mid: o.mid,
        force: o.force,
        dry: o.dry,
        chatAuthorMode: !!o.chatAuthorMode,
      });
    },
  );

program
  .command("sync-mids")
  .description(
    "Заполнить maxMessageId: загрузка истории чата (GET /messages) и сопоставление с постами по тексту",
  )
  .option("--token <token>", "Токен бота Max", process.env.MAX_BOT_TOKEN)
  .option("--chat-id <id>", "ID чата", process.env.MAX_CHAT_ID)
  .option("--dump <dir>", "Каталог дампа", "telegram-dump")
  .option("--state <path>", "Путь к migration-state.json")
  .option("--only-messages <ids>", "Только эти id из дампа")
  .option("--force", "Перезаписать maxMessageId даже если уже задан")
  .option("--dry", "Показать сопоставления без записи в state")
  .option("--max-pages <n>", "Лимит страниц GET /messages", "800")
  .option(
    "--chat-author-mode",
    "Сопоставление как при post --chat-author-mode",
  )
  .action(
    async (o: {
      token?: string;
      chatId: string;
      dump: string;
      state?: string;
      onlyMessages?: string;
      force?: boolean;
      dry?: boolean;
      maxPages?: string;
      chatAuthorMode?: boolean;
    }) => {
      const token = o.token?.trim();
      if (!token && !o.dry) {
        console.error("Укажите --token");
        process.exit(1);
      }
      if (o.chatId == null || o.chatId === "") {
        console.error("Укажите --chat-id или MAX_CHAT_ID");
        process.exit(1);
      }
      const chatId = parseInt(String(o.chatId), 10);
      if (Number.isNaN(chatId)) {
        console.error("Некорректный --chat-id");
        process.exit(1);
      }
      const maxPages = parseInt(o.maxPages ?? "800", 10) || 800;
      await runSyncMids({
        token: token || "",
        chatId,
        dumpDir: o.dump,
        statePath: o.state,
        onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
        force: o.force,
        dry: o.dry,
        maxPages,
        chatAuthorMode: !!o.chatAuthorMode,
      });
    },
  );

program
  .command("post")
  .description("Опубликовать сообщения в групповой чат Max по состоянию")
  .option("--token <token>", "Токен бота Max", process.env.MAX_BOT_TOKEN)
  .option(
    "--chat-id <id>",
    "ID группового чата Max",
    process.env.MAX_CHAT_ID,
  )
  .option("--dump <dir>", "Каталог дампа", "telegram-dump")
  .option("--state <path>", "Путь к migration-state.json")
  .option(
    "--skip-if-media-missing",
    "Не публиковать сообщения, у которых не все файлы загружены",
  )
  .option("--dry", "Тестовый режим: показать, какие сообщения были бы отправлены, без вызова API")
  .option(
    "--only-messages <ids>",
    "Только указанные id сообщений (через запятую), остальные не трогаются",
  )
  .option(
    "--chat-author-mode",
    "Заголовок поста: «Имя · ДД.ММ.ГГГГ ЧЧ:ММ» из поля from дампа",
  )
  .action(
    async (o: {
      token?: string;
      chatId: string;
      dump: string;
      state?: string;
      skipIfMediaMissing?: boolean;
      dry?: boolean;
      onlyMessages?: string;
      chatAuthorMode?: boolean;
    }) => {
      const token = o.dry ? "" : (o.token?.trim() ?? "");
      if (!token && !o.dry) {
        console.error("Укажите --token или MAX_BOT_TOKEN");
        process.exit(1);
      }
      if (o.chatId == null || o.chatId === "") {
        console.error("Укажите --chat-id или переменную MAX_CHAT_ID");
        process.exit(1);
      }
      const chatId = parseInt(String(o.chatId), 10);
      if (Number.isNaN(chatId)) {
        console.error("Некорректный --chat-id");
        process.exit(1);
      }
      await runPost({
        token: token || "dry-run",
        chatId,
        dumpDir: o.dump,
        statePath: o.state,
        skipIfMediaMissing: o.skipIfMediaMissing,
        dry: o.dry,
        onlyMessageIds: parseOnlyMessageIds(o.onlyMessages),
        chatAuthorMode: !!o.chatAuthorMode,
      });
    });

program.parse();
