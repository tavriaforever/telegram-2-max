# CLI миграция Telegram → Max (дорожная карта)

Краткое описание реализации; детали запуска — в [README.md](../README.md).

## Этапы

1. **Скелет** — `package.json`, `src/cli.ts`, команды `upload` / `post`.
2. **Дамп + состояние** — парсинг `result.json`, `migration-state.json`, merge при повторном запуске.
3. **Markdown** — `text_entities` → Max markdown (`src/markdown/entities-to-markdown.ts`).
4. **Upload** — `POST /uploads`, multipart на CDN, сохранение payload в state.
5. **Post** — `POST /messages?chat_id=`, ретраи, `messagePosted`.

## Схема `migration-state.json`

- `version`, `dumpPath`, `resultJsonPath`, `updatedAt`
- `messages.<telegramId>`:
  - `date`, `text_entities`
  - `expectedMedia`: какие слоты (`image` | `video` | `file`) и относительный путь
  - `upload.<kind>`: `status` (`pending` | `ok` | `error`), `payload`, `error`
  - `messagePosted`, `maxMessageId`, `lastError`

## Архитектура

```
TelegramDumpSource → нормализованные сообщения → MaxUploadClient / MaxMessagesClient
```

Дальше: отдельный `TelegramApiSource` с тем же контрактом нормализации.
