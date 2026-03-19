export const MAX_PLATFORM_API = "https://platform-api.max.ru";

/** Suggested RPS throttle for platform-api (upload, GET, PUT, etc.) */
export const MAX_RPS_DELAY_MS = Math.ceil(1000 / 25);

/**
 * Minimum gap between successful POST /messages to the same chat.
 * Max enforces a separate “too many chat send message requests” limit (429).
 * Override: env MAX_POST_MESSAGE_DELAY_MS (ms), e.g. 3000.
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
