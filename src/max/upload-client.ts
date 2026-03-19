import { openAsBlob } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { MAX_PLATFORM_API, MAX_RPS_DELAY_MS } from "./constants.js";
import type { MediaKind } from "../types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isVideoCdnSuccess(httpOk: boolean, raw: string): boolean {
  if (!httpOk) return false;
  const t = raw.trim();
  if (t.includes("<retval>")) return true;
  if (t.startsWith("{")) {
    try {
      JSON.parse(t);
      return true;
    } catch {
      return false;
    }
  }
  return t.length === 0;
}

export class MaxUploadClient {
  constructor(
    private readonly token: string,
    private readonly onRequest?: () => void,
  ) {}

  private async throttle(): Promise<void> {
    await sleep(MAX_RPS_DELAY_MS);
  }

  /**
   * Video/audio (POST /uploads docs):
   * 1) POST /uploads?type=video → { url, token? }
   * 2) Multipart to url — in Max’s example **no** Authorization on CDN, JSON { token }
   * 3) Message: attachments[].payload = object from step 2 (usually { token })
   *
   * On XML `retval`: CDN may return XML after upload; then use token from step 1.
   */
  async uploadFile(
    absolutePath: string,
    maxType: MediaKind,
  ): Promise<{ payload: Record<string, unknown> }> {
    await access(absolutePath);
    const fileName = path.basename(absolutePath);

    await this.throttle();
    this.onRequest?.();

    const initRes = await fetch(`${MAX_PLATFORM_API}/uploads?type=${maxType}`, {
      method: "POST",
      headers: { Authorization: this.token },
    });

    if (!initRes.ok) {
      const t = await initRes.text();
      throw new Error(`uploads init ${initRes.status}: ${t.slice(0, 500)}`);
    }

    const initJson = (await initRes.json()) as { url: string; token?: string };

    if (!initJson.url) {
      throw new Error("uploads response missing url");
    }

    const makeForm = async () => {
      const blob = await openAsBlob(absolutePath);
      const form = new FormData();
      form.append("data", blob, fileName);
      return form;
    };

    await this.throttle();
    this.onRequest?.();

    let upRes: Response;
    let rawBody: string;

    if (maxType === "video") {
      // As in docs: curl to UPLOAD_URL with multipart only, no Authorization
      upRes = await fetch(initJson.url, {
        method: "POST",
        body: await makeForm(),
      });
      rawBody = await upRes.text();

      if (!upRes.ok && (upRes.status === 401 || upRes.status === 403)) {
        await this.throttle();
        this.onRequest?.();
        upRes = await fetch(initJson.url, {
          method: "POST",
          headers: { Authorization: this.token },
          body: await makeForm(),
        });
        rawBody = await upRes.text();
      }

      if (!upRes.ok) {
        throw new Error(`upload video to CDN ${upRes.status}: ${rawBody.slice(0, 500)}`);
      }

      try {
        const j = JSON.parse(rawBody) as Record<string, unknown>;
        if (Object.keys(j).length > 0) {
          return { payload: j };
        }
      } catch {
        /* not JSON — retval + token from /uploads below */
      }

      if (isVideoCdnSuccess(true, rawBody) && typeof initJson.token === "string") {
        return { payload: { token: initJson.token } };
      }

      throw new Error(
        `Video: no JSON with token from CDN. Body: ${rawBody.slice(0, 400)}. ` +
          (initJson.token
            ? ""
            : "No token in POST /uploads?type=video response — check API."),
      );
    }

    upRes = await fetch(initJson.url, {
      method: "POST",
      headers: { Authorization: this.token },
      body: await makeForm(),
    });
    rawBody = await upRes.text();

    if (!upRes.ok) {
      throw new Error(`upload to CDN ${upRes.status}: ${rawBody.slice(0, 500)}`);
    }

    let upJson: Record<string, unknown> = {};
    try {
      upJson = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      throw new Error(
        `CDN response not JSON (expected token for ${maxType}): ${rawBody.slice(0, 200)}`,
      );
    }

    if (typeof upJson.token === "string") {
      return { payload: { token: upJson.token } };
    }

    if (Object.keys(upJson).length > 0) {
      return { payload: upJson as Record<string, unknown> };
    }

    throw new Error("Empty response after file upload");
  }

  static isAttachmentNotReady(err: unknown): boolean {
    if (err && typeof err === "object" && "body" in err) {
      const b = (err as { body: string }).body;
      return b.includes("attachment.not.ready") || b.includes("file.not.processed");
    }
    return false;
  }
}
