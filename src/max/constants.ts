export const MAX_PLATFORM_API = "https://platform-api.max.ru";

/** Рекомендуемый лимит RPS для platform-api (upload, GET, PUT и т.д.) */
export const MAX_RPS_DELAY_MS = Math.ceil(1000 / 25);

/**
 * Минимальный интервал между успешными POST /messages в один чат.
 * У Max отдельный лимит «too many chat send message requests» (429).
 * Переопределение: переменная окружения MAX_POST_MESSAGE_DELAY_MS (мс), например 3000.
 */
export function getPostMessageDelayMs(): number {
  const raw = process.env.MAX_POST_MESSAGE_DELAY_MS;
  if (raw) {
    const n = parseInt(String(raw).trim(), 10);
    if (Number.isFinite(n) && n >= 300 && n <= 120_000) {
      return n;
    }
  }
  return 2500;
}
