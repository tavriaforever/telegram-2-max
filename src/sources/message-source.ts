import type { NormalizedMessage } from "../types.js";

/**
 * Общий контракт источника сообщений для миграции и будущего кросспостинга (Telegram API).
 */
export interface MessageSource {
  readonly dumpDir: string;
  loadMessages(): Promise<NormalizedMessage[]>;
}
