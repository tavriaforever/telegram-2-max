# max-migrate

CLI to migrate a Telegram channel archive (Telegram Desktop export: `result.json` + files) into the **Max** messenger.

## Requirements

- Node.js **22+**
- A Max bot token and the group chat ID where the bot is added

## Installation

```bash
npm install
```

## Environment variables

| Variable                    | Description                                                                 |
| --------------------------- | --------------------------------------------------------------------------- |
| `MAX_BOT_TOKEN`             | Bot token (alternative to `--token`)                                       |
| `MAX_CHAT_ID`               | Chat ID for the `post` command                                             |
| `MAX_POST_MESSAGE_DELAY_MS` | Delay between successful POST /messages to the same chat (default 2500 ms; increase on 429, e.g. 4000) |

## End-to-end: how to run

1. **Export in Telegram Desktop** — a folder with `result.json` and directories `photos/`, `video_files/`, etc. (we call this path the **dump directory**).
2. **Environment** (convenient in the shell):
   ```bash
   export MAX_BOT_TOKEN="…"
   export MAX_CHAT_ID="…"   # Max chat ID where the bot is added
   ```
3. **Check without API** — creates/updates `migration-state.json`; shows which files would be uploaded:
   ```bash
   npx tsx src/cli.ts upload --dump path/to/dump --dry
   ```
4. **Upload media** to Max (can take a long time on large chats):
   ```bash
   npx tsx src/cli.ts upload --dump path/to/dump
   ```
5. **Dry-run posts** (text + request body):
   ```bash
   npx tsx src/cli.ts post --dump path/to/dump --dry
   ```
6. **Publish**:
   ```bash
   npx tsx src/cli.ts post --dump path/to/dump
   ```

**Example** for a `kids-dump` folder at the project root:

```bash
npx tsx src/cli.ts upload --dump kids-dump --dry
npx tsx src/cli.ts upload --dump kids-dump
npx tsx src/cli.ts post --dump kids-dump --dry
npx tsx src/cli.ts post --dump kids-dump
```

**Large chats** (thousands of messages): one run may take hours; back up `migration-state.json` periodically. Targeted runs: `--only-messages 3,7,12` on `upload` and `post`.

**Group chat / author name in the post:** add **`--chat-author-mode`** to `post` — the first line is **author name** (from the **`from`** field in the dump) **·** **DD.MM.YYYY HH:MM**, then the message body. The same flag is required for **`reattach`** and **`sync-mids`** if posts were already sent in this mode (otherwise PUT text and matching will not align).

**Media missing from export** (JSON path like “File not included…”): for such messages **no upload slot is created** — Max will get the text (and date line) without an attachment; enable media separately in Telegram export settings if you need files.

## Commands

### 1. Upload media to Max

Creates/updates `migration-state.json` in the dump directory; uploads photos, videos, and files. Re-runs skip slots that already uploaded successfully.

```bash
npm run migrate:upload -- --token "<token>" --dump telegram-dump
# or
npx tsx src/cli.ts upload --dump telegram-dump
```

Options:

- `--state <path>` — custom path to the state JSON
- `--strict` — stop on the first upload error
- `--dry` — dry run: create/update state and print files that would be uploaded (no API calls)
- `--only-messages 3,7,12` — upload media **only** for these message IDs from the dump; state still records only processed slots; re-runs do not duplicate already `ok` entries

Placeholder paths from export (`(File not included…)`, “Change data exporting…”) are **ignored** — no slots in state and no upload attempts.

**Spot check:** first `upload --only-messages 3`, then `post --only-messages 3`; then full `upload` and `post` without filter — already completed messages are skipped.

**Video** ([docs](https://dev.max.ru/docs-api/methods/POST/uploads)): CDN upload is **without** the `Authorization` header (as in the `vu.mycdn.me` example); the token for `POST /messages` comes from the **CDN JSON response** `{ "token": "…" }`. If the CDN returns XML `retval`, the optional `token` from the first `POST /uploads?type=video` response is used. For stale errors in state — `--reset-failed` and re-run `upload`:

```bash
npx tsx src/cli.ts upload --token "$T" --dump telegram-dump --reset-failed --only-messages 7
```

### 2. Post messages

In order (ascending message `id` in the dump) sends messages to the chat: by default the first line is `Publication date: dd.mm.yyyy`, then markdown from `text_entities`. With **`--chat-author-mode`** — `Author name · dd.mm.yyyy hh:mm` (the **`from`** field in `result.json`); if `from` is missing, the “Publication date” format remains.

```bash
npm run migrate:post -- --token "<token>" --chat-id 123456789 --dump telegram-dump
# group / chat with names:
npx tsx src/cli.ts post --token "$T" --chat-id "$MAX_CHAT_ID" --dump kids-dump --chat-author-mode
```

Options:

- `--chat-author-mode` — header with author and time (see above)
- `--skip-if-media-missing` — do not send posts whose attachments are not all uploaded
- `--dry` — dry run: full text and `POST /messages` body (including `attachments` in API format; if a file is not uploaded yet, `payload.token` shows a placeholder)
- `--only-messages 3,7` — publish **only** these IDs; others are untouched (`messagePosted` unchanged)

On `attachment.not.ready` the script pauses and retries. On **429** (rate limit for the chat) — pauses **35–120 s** and up to four retries. Between **successful** messages to the chat the default pause is **2.5 s** (Max’s separate limit); set **`MAX_POST_MESSAGE_DELAY_MS`** (ms), e.g. `4000` for a gentler pace.

### 3. `reattach` — add attachments to an already posted message

If a post went out **without video** (old upload error) but the text is already in the chat: re-upload the video (`upload` + `--reset-failed` if needed), then:

```bash
npx tsx src/cli.ts reattach --token "$T" --dump telegram-dump --only-messages 7
# if posts used --chat-author-mode:
npx tsx src/cli.ts reattach --token "$T" --dump kids-dump --only-messages 7 --chat-author-mode
```

If `migration-state.json` has no **`maxMessageId`** (API response on `post` not recognized), pass the Max chat message ID manually:

```bash
npx tsx src/cli.ts reattach --token "$T" --dump telegram-dump --only-messages 58 --mid "123456789"
```

The command calls **PUT** [`/messages`](https://dev.max.ru/docs-api/methods/PUT/messages) with the same text and `attachments` array. Editing may be time-limited (e.g. 24 h) — see Max’s rules.

### 4. `sync-mids` — fill in `maxMessageId` from the chat

There is no separate “find message by text” API in Max. You can pull chat history via [**GET /messages**](https://dev.max.ru/docs-api/methods/GET/messages) (`chat_id`, `from`/`to` windows, up to 100 messages per request) and **match** state entries by text (line “Publication date: …” + word overlap).

```bash
npx tsx src/cli.ts sync-mids --token "$T" --chat-id <id> --dump telegram-dump
```

Options: `--dry` (no writes), `--only-messages 58,60`, `--force` (overwrite existing mid), `--max-pages 500` (batch fetch limit), **`--chat-author-mode`** (if you posted with this flag).

After a successful `sync-mids` you can run `reattach` without manual `--mid`.

## State (`migration-state.json`)

For each message `id` it stores: expected files, upload result (`token` / payload), `messagePosted` flag, and `maxMessageId` when available.

## Why not @maxhub/max-bot-api

The [@maxhub/max-bot-api](https://github.com/max-messenger/max-bot-api-client-ts) library targets a **long-running bot** (updates, `bot.on('message_created')`, `bot.start()`). This CLI is a one-off migration: read dump → upload files → send messages. Token and calls to `platform-api.max.ru` are fully controlled in code (retries, RPS limits, atomic state) without the library layer. For cross-posting and migration this approach is more practical.

## Max documentation

- [File uploads](https://dev.max.ru/docs-api/methods/POST/uploads)
- [Send messages](https://dev.max.ru/docs-api/methods/POST/messages)

## Tests

```bash
npm test
```

## Extending

The message source lives in [`src/sources/telegram-dump.ts`](src/sources/telegram-dump.ts) (`loadTelegramDump`, `normalizeDumpMessage`). Later you can add a Telegram Bot API source with the same normalized message format.
