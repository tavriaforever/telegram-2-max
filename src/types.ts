/** Слот медиа в Max API */
export type MediaKind = "image" | "video" | "file";

export interface TextEntity {
  type: string;
  text: string;
  href?: string;
}

export interface TelegramDumpMessage {
  id: number;
  type: string;
  date: string;
  date_unixtime?: string;
  /** Имя отправителя (личные чаты / группы / канал как автор) */
  from?: string;
  text_entities?: TextEntity[];
  photo?: string;
  file?: string;
  file_name?: string;
  media_type?: string;
  mime_type?: string;
}

export interface NormalizedAttachment {
  kind: MediaKind;
  relativePath: string;
}

export interface NormalizedMessage {
  id: number;
  date: string;
  text_entities: TextEntity[];
  attachments: NormalizedAttachment[];
  /** Из поля from дампа */
  author?: string;
}

export type UploadSlotStatus = "pending" | "ok" | "error";

export interface UploadSlotState {
  relativePath: string;
  status: UploadSlotStatus;
  /** Полный JSON ответа после загрузки — используется как payload вложения */
  payload?: Record<string, unknown>;
  error?: string;
}

export interface MessageMigrationState {
  date: string;
  text_entities: TextEntity[];
  /** Имя автора из дампа (для --chat-author-mode) */
  author?: string;
  expectedMedia: Partial<Record<MediaKind, { relativePath: string }>>;
  upload: Partial<Record<MediaKind, UploadSlotState>>;
  messagePosted: boolean;
  /** ID сообщения в Max (для PUT /messages?message_id=) */
  maxMessageId?: string | number;
  /** Уже прикрепили вложения через reattach */
  attachmentsApplied?: boolean;
  lastError?: string;
}

export interface MigrationStateFile {
  version: 1;
  dumpPath: string;
  resultJsonPath: string;
  updatedAt: string;
  messages: Record<string, MessageMigrationState>;
}
