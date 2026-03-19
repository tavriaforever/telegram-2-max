# CLI migration Telegram → Max (roadmap)

Short implementation notes; run details are in [README.md](../README.md).

## Phases

1. **Skeleton** — `package.json`, `src/cli.ts`, `upload` / `post` commands.
2. **Dump + state** — parse `result.json`, `migration-state.json`, merge on re-run.
3. **Markdown** — `text_entities` → Max markdown (`src/markdown/entities-to-markdown.ts`).
4. **Upload** — `POST /uploads`, multipart to CDN, store payload in state.
5. **Post** — `POST /messages?chat_id=`, retries, `messagePosted`.

## `migration-state.json` shape

- `version`, `dumpPath`, `resultJsonPath`, `updatedAt`
- `messages.<telegramId>`:
  - `date`, `text_entities`
  - `expectedMedia`: which slots (`image` | `video` | `file`) and relative path
  - `upload.<kind>`: `status` (`pending` | `ok` | `error`), `payload`, `error`
  - `messagePosted`, `maxMessageId`, `lastError`

## Architecture

```
TelegramDumpSource → normalized messages → MaxUploadClient / MaxMessagesClient
```

Next: a separate `TelegramApiSource` with the same normalization contract.
