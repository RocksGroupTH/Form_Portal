/**
 * Everything the image-reading routes must do before they spend money, in one
 * place: two of them now (AP-1's receipt amount, AP-17's ID-card check) and
 * they must not drift apart, because each step here is either a cost control
 * or an upload guard.
 *
 * Order matters and is the point:
 *
 *   1. no key → 503 before anything else, so a deploy that has not configured
 *      this degrades instead of erroring in a way callers try to interpret;
 *   2. rate limit → **before the body is read**, so a refused caller costs
 *      nothing at all — not bandwidth, not a decode, certainly not a call;
 *   3. `checkAttachment` → the same magic-byte allowlist the real uploads use,
 *      so a renamed `.exe` is refused rather than paid for. `File.type` is a
 *      hint and is never trusted;
 *   4. narrow again to the four media types the Messages API actually takes —
 *      `allowedKinds: ["image"]` also admits HEIC, which every client here
 *      re-encodes away but a direct caller could still post.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { checkAttachment } from "@/lib/acc/attachment-guard";
import { consumeRateLimit } from "@/lib/rate-limit";
import { resolveApiKey } from "@/lib/api-keys/service";

/** The image media types the Messages API accepts. */
export const SUPPORTED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export function isSupportedImageType(contentType: string): contentType is SupportedImageType {
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).indexOf(contentType) >= 0;
}

/** Generous for real work; a stuck retry loop hits it in seconds. */
export const VISION_RATE_LIMIT = { limit: 40, windowMs: 10 * 60 * 1000 };

/** A read is a convenience — never make the requester wait on a slow one. */
export const VISION_TIMEOUT_MS = 30_000;

export type VisionGuardResult =
  | { ok: true; bytes: Buffer; mediaType: SupportedImageType; client: Anthropic }
  | { ok: false; response: NextResponse };

export async function guardVisionRequest(
  req: NextRequest,
  opts: { userId: string | number; purpose: string; unavailableError: string },
): Promise<VisionGuardResult> {
  // Settings → API Keys, then the old stores, then `.env`. Resolved per request
  // rather than read once at import, so replacing an expired key on the settings
  // page takes effect immediately instead of at the next deploy.
  const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: opts.unavailableError }, { status: 503 }),
    };
  }

  const gate = consumeRateLimit(`${opts.purpose}:${opts.userId}`, VISION_RATE_LIMIT);
  if (!gate.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "อ่านรูปถี่เกินไป กรุณารอสักครู่แล้วลองใหม่" },
        { status: 429, headers: { "Retry-After": String(gate.retryAfterSeconds) } },
      ),
    };
  }

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: "ไม่พบไฟล์" }, { status: 400 }),
      };
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const check = checkAttachment({
      fileName: file.name,
      declaredType: file.type,
      bytes,
      allowedKinds: ["image"],
    });
    if (!check.ok) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: check.error }, { status: check.status }),
      };
    }
    if (!isSupportedImageType(check.type.contentType)) {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: "รองรับเฉพาะไฟล์ PNG, JPEG, GIF หรือ WEBP" },
          { status: 400 },
        ),
      };
    }

    return {
      ok: true,
      bytes,
      mediaType: check.type.contentType,
      client: new Anthropic({
        apiKey,
        timeout: VISION_TIMEOUT_MS,
        maxRetries: 1,
      }),
    };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "อ่านไฟล์ไม่สำเร็จ" }, { status: 400 }),
    };
  }
}

/** The image content block for a guarded request's bytes. */
export function visionImageBlock(bytes: Buffer, mediaType: SupportedImageType) {
  return {
    type: "image" as const,
    source: { type: "base64" as const, media_type: mediaType, data: bytes.toString("base64") },
  };
}
