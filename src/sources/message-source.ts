import type { NormalizedMessage } from "../types.js";

/**
 * Shared message source contract for migration and future cross-posting (Telegram API).
 */
export interface MessageSource {
  readonly dumpDir: string;
  loadMessages(): Promise<NormalizedMessage[]>;
}
