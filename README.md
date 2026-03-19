# max-migrate

CLI для переноса архива канала Telegram (экспорт Telegram Desktop: `result.json` + файлы) в мессенджер **Max**.

## Требования

- Node.js **22+**
- Токен бота Max и ID группового чата, куда бот добавлен

## Установка

```bash
npm install
```

## Переменные окружения

| Переменная       | Описание                          |
| ---------------- | --------------------------------- |
| `MAX_BOT_TOKEN`  | Токен бота (можно вместо `--token`) |
| `MAX_CHAT_ID`    | ID чата для команды `post`        |
| `MAX_POST_MESSAGE_DELAY_MS` | Пауза между успешными POST /messages в один чат (по умолчанию 2500 мс; при 429 можно увеличить, например 4000) |

## Полный сценарий: как запускать

1. **Экспорт в Telegram Desktop** — папка с `result.json` и каталогами `photos/`, `video_files/` и т.д. (путь к папке дальше называем **каталог дампа**).
2. **Переменные** (удобно в shell):
   ```bash
   export MAX_BOT_TOKEN="…"
   export MAX_CHAT_ID="…"   # ID чата Max, куда добавлен бот
   ```
3. **Проверка без API** — создаётся/обновляется `migration-state.json`, видно, какие файлы пойдут в upload:
   ```bash
   npx tsx src/cli.ts upload --dump путь/к/дампу --dry
   ```
4. **Загрузка медиа** в Max (долго на больших чатах):
   ```bash
   npx tsx src/cli.ts upload --dump путь/к/дампу
   ```
5. **Проверка постов** (текст + тело запроса):
   ```bash
   npx tsx src/cli.ts post --dump путь/к/дампу --dry
   ```
6. **Публикация**:
   ```bash
   npx tsx src/cli.ts post --dump путь/к/дампу
   ```

**Пример** для каталога `kids-dump` в корне проекта:

```bash
npx tsx src/cli.ts upload --dump kids-dump --dry
npx tsx src/cli.ts upload --dump kids-dump
npx tsx src/cli.ts post --dump kids-dump --dry
npx tsx src/cli.ts post --dump kids-dump
```

**Большие чаты** (тысячи сообщений): один прогон может занять часы; периодически бэкапьте `migration-state.json`. Точечно: `--only-messages 3,7,12` у `upload` и `post`.

**Групповой чат / имя автора в посте:** добавьте **`--chat-author-mode`** к `post` — первая строка будет вида `Имя из поля from · ДД.ММ.ГГГГ ЧЧ:ММ`, затем текст. Тот же флаг нужен для **`reattach`** и **`sync-mids`**, если посты уже ушли в этом режиме (иначе текст для PUT и сопоставление не совпадут).

**Медиа не попало в экспорт** (в JSON путь вида «File not included…»): для таких сообщений **слот загрузки не создаётся** — в Max уйдёт текст (и строка даты), без вложения; отдельно включайте медиа в настройках экспорта Telegram, если нужны файлы.

## Команды

### 1. Загрузка медиа в Max

Создаёт/обновляет `migration-state.json` в каталоге дампа, загружает фото, видео и файлы. Повторный запуск пропускает уже успешно загруженные слоты.

```bash
npm run migrate:upload -- --token "<токен>" --dump telegram-dump
# или
npx tsx src/cli.ts upload --dump telegram-dump
```

Опции:

- `--state <path>` — свой путь к JSON состояния
- `--strict` — остановка при первой ошибке загрузки
- `--dry` — тестовый режим: создать/обновить state и вывести список файлов, которые были бы загружены (без вызова API)
- `--only-messages 3,7,12` — загрузить медиа **только** у этих id сообщений из дампа; в state по-прежнему пишутся только обработанные слоты, повторный запуск не дублирует уже `ok`

Пути-заглушки из экспорта (`(File not included…)`, «Change data exporting…») **игнорируются** — для них нет слотов в state и попытки загрузки не выполняются.

**Точечная проверка:** сначала `upload --only-messages 3`, затем `post --only-messages 3`; потом полный `upload` и `post` без фильтра — уже готовые сообщения пропускаются.

**Видео** ([документация](https://dev.max.ru/docs-api/methods/POST/uploads)): загрузка на CDN — **без** заголовка `Authorization` (как в примере с `vu.mycdn.me`); токен для `POST /messages` — из **JSON-ответа CDN** `{ "token": "…" }`. Если CDN вернул XML `retval`, используется опциональный `token` из первого ответа `POST /uploads?type=video`. При старой ошибке в state — `--reset-failed` и повторный `upload`:

```bash
npx tsx src/cli.ts upload --token "$T" --dump telegram-dump --reset-failed --only-messages 7
```

### 2. Публикация сообщений

По очереди (по возрастанию `id` сообщения в дампе) отправляет сообщения в чат: по умолчанию в начале строка `Дата публикации: dd.mm.yyyy`, далее markdown из `text_entities`. С флагом **`--chat-author-mode`** — `Имя автора · dd.mm.yyyy hh:mm` (поле **`from`** в `result.json`); если `from` нет, остаётся формат с «Дата публикации».

```bash
npm run migrate:post -- --token "<токен>" --chat-id 123456789 --dump telegram-dump
# группа / чат с именами:
npx tsx src/cli.ts post --token "$T" --chat-id "$MAX_CHAT_ID" --dump kids-dump --chat-author-mode
```

Опции:

- `--chat-author-mode` — заголовок с автором и временем (см. выше)
- `--skip-if-media-missing` — не отправлять посты, у которых не все вложения загружены
- `--dry` — тестовый режим: полный текст и тело запроса `POST /messages` (включая массив `attachments` в формате API; если файл ещё не загружен — в `payload.token` показан плейсхолдер)
- `--only-messages 3,7` — опубликовать **только** эти id; остальные не трогаются (`messagePosted` не меняется)

При ошибке `attachment.not.ready` скрипт делает паузы и повторяет отправку. При **429** (слишком частая отправка в чат) — паузы **35–120 с** и до четырёх повторов. Между **успешными** сообщениями в чат по умолчанию пауза **2,5 с** (отдельный лимит Max); можно задать **`MAX_POST_MESSAGE_DELAY_MS`** (мс), например `4000` для более спокойного режима.

### 3. `reattach` — добавить вложения к уже отправленному посту

Если пост ушёл **без видео** (старая ошибка загрузки), а текст уже в чате: заново загрузите видео (`upload` + `--reset-failed` при необходимости), затем:

```bash
npx tsx src/cli.ts reattach --token "$T" --dump telegram-dump --only-messages 7
# если посты с --chat-author-mode:
npx tsx src/cli.ts reattach --token "$T" --dump kids-dump --only-messages 7 --chat-author-mode
```

Если в `migration-state.json` нет **`maxMessageId`** (ответ API при `post` не распознан), укажите id сообщения в чате Max вручную:

```bash
npx tsx src/cli.ts reattach --token "$T" --dump telegram-dump --only-messages 58 --mid "123456789"
```

Команда вызывает **PUT** [`/messages`](https://dev.max.ru/docs-api/methods/PUT/messages) с тем же текстом и массивом `attachments`. Редактирование может быть ограничено по времени (например, 24 ч) — смотрите правила Max.

### 4. `sync-mids` — подставить `maxMessageId` из чата

Отдельного API «найти сообщение по тексту» в Max нет. Можно выгрузить историю чата через [**GET /messages**](https://dev.max.ru/docs-api/methods/GET/messages) (`chat_id`, окна `from`/`to`, до 100 сообщений за запрос) и **сопоставить** с записями в state по тексту (строка «Дата публикации: …» + совпадение слов).

```bash
npx tsx src/cli.ts sync-mids --token "$T" --chat-id <id> --dump telegram-dump
```

Опции: `--dry` (без записи), `--only-messages 58,60`, `--force` (перезаписать уже заданный mid), `--max-pages 500` (лимит пачек загрузки), **`--chat-author-mode`** (если постили с этим флагом).

После успешного `sync-mids` можно вызывать `reattach` без ручного `--mid`.

## Состояние (`migration-state.json`)

Для каждого `id` сообщения хранятся: ожидаемые файлы, результат загрузки (`token` / payload), флаг `messagePosted` и при необходимости `maxMessageId`.

## Почему не @maxhub/max-bot-api

Библиотека [@maxhub/max-bot-api](https://github.com/max-messenger/max-bot-api-client-ts) рассчитана на **долгоживущего бота** (получение обновлений, `bot.on('message_created')`, `bot.start()`). Этот CLI делает разовую миграцию: чтение дампа → загрузка файлов → отправка сообщений. Токен и вызовы к `platform-api.max.ru` полностью контролируются кодом (повторы, лимиты RPS, атомарное состояние), без зависимости от слоя библиотеки. Для кросспостинга и миграции текущий подход удобнее.

## Документация Max

- [Загрузка файлов](https://dev.max.ru/docs-api/methods/POST/uploads)
- [Отправка сообщений](https://dev.max.ru/docs-api/methods/POST/messages)

## Тесты

```bash
npm test
```

## Расширение

Источник сообщений вынесен в [`src/sources/telegram-dump.ts`](src/sources/telegram-dump.ts) (`loadTelegramDump`, `normalizeDumpMessage`). Позже можно добавить источник из Bot API Telegram с тем же нормализованным форматом сообщений.
