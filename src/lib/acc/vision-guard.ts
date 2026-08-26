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
import { checkAttachment, type AttachmentKind } from "@/lib/acc/attachment-guard";
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

/**
 * What the guard let through, so the caller knows which reader to run.
 *
 * `mediaType` is set **only** for `kind: "image"` — it is the Messages API's
 * own media type, and a PDF or a workbook has no business carrying one. A
 * caller that wants to send bytes straight to the API therefore has to have
 * checked the kind first, which is the point.
 */
export type GuardedUpload =
  | { kind: "image"; bytes: Buffer; mediaType: SupportedImageType; fileName: string }
  | { kind: "pdf" | "spreadsheet"; bytes: Buffer; fileName: string };

export type VisionGuardResult =
  | ({ ok: true; client: Anthropic } & GuardedUpload)
  | { ok: false; response: NextResponse };

export async function guardVisionRequest(
  req: NextRequest,
  opts: {
    userId: string | number;
    purpose: string;
    unavailableError: string;
    /**
     * What this caller can actually read. **Defaults to images only** — see the
     * comment at the `checkAttachment` call for why widening it here rather
     * than per-caller would be a hole in AP-17's ID-card check.
     */
    allowedKinds?: readonly AttachmentKind[];
  },
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
    // Defaulted to images, not widened for everybody. AP-17's ID-card check
    // must keep refusing a PDF, and it says so by saying nothing — a guard
    // that opened up for every caller because one of them needed more is how
    // that check would quietly start accepting a document it cannot verify.
    const allowedKinds = opts.allowedKinds ?? (["image"] as const);
    const check = checkAttachment({
      fileName: file.name,
      declaredType: file.type,
      bytes,
      allowedKinds: allowedKinds as AttachmentKind[],
    });
    if (!check.ok) {
      return {
        ok: false,
        response: NextResponse.json({ ok: false, error: check.error }, { status: check.status }),
      };
    }

    const client = new Anthropic({ apiKey, timeout: VISION_TIMEOUT_MS, maxRetries: 1 });
    const kind = check.type.kind;

    if (kind === "image") {
      // Narrowed again: `allowedKinds: ["image"]` also admits HEIC, which every
      // client here re-encodes away but a direct caller could still post.
      if (!isSupportedImageType(check.type.contentType)) {
        return {
          ok: false,
          response: NextResponse.json(
            { ok: false, error: "รองรับเฉพาะไฟล์ PNG, JPEG, GIF หรือ WEBP" },
            { status: 400 },
          ),
        };
      }
      return { ok: true, kind, bytes, mediaType: check.type.contentType, fileName: file.name, client };
    }

    // `binary` is what `allowedKinds: "any"` returns for bytes no signature
    // matches. No caller here passes "any" — every vision route names the kinds
    // it can actually send — so this is unreachable today, and it refuses rather
    // than casting because the next route to be widened would otherwise post an
    // unidentified file to the Messages API and get an opaque 400 back.
    if (kind === "binary") {
      return {
        ok: false,
        response: NextResponse.json(
          { ok: false, error: "อ่านไฟล์ชนิดนี้ไม่ได้" },
          { status: 400 },
        ),
      };
    }

    return { ok: true, kind, bytes, fileName: file.name, client };
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
