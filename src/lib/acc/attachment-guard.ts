/**
 * Server-side attachment rules for the Accounting forms (AP-1 and AP-17).
 *
 * Everything here is a pure function over bytes and strings so it can be tested
 * without a database, a request or SharePoint. The route handlers own the
 * authorization; this module owns "is this actually a receipt photo".
 *
 * ## Why the declared type is not enough
 *
 * Both upload routes used to gate on `File.type` alone — AP-1 on
 * `startsWith("image/")`, AP-17 on that plus `application/pdf`. `File.type`
 * comes from the browser, which takes it from the multipart part header, which
 * the caller writes. `image/svg+xml` passes `startsWith("image/")`, and an SVG
 * is a document that runs script. The download routes then echoed the stored
 * type back with `Content-Disposition: inline`, so the script ran on the
 * application's own origin, with the session cookie attached and no page CSP
 * (the proxy sets `Content-Security-Policy` on page responses only).
 *
 * So the declared type is treated as a hint and the bytes are the authority:
 * `sniffAttachment` matches a magic-byte signature from a fixed allowlist and
 * the result — not the caller's string — is what gets stored and served.
 *
 * ## What is on the list
 *
 * Raster photos (PNG/JPEG/GIF/WEBP/HEIC) and PDF. HEIC is on it because
 * `accept="image/*"` on an iPhone hands back HEIC and always has; it cannot be
 * previewed in most browsers but it stores and downloads, which is the
 * behaviour that existed before this guard and is not this change's to remove.
 * SVG is deliberately absent and has its own rejection message, because it is
 * the one thing a user might reasonably expect to work.
 */

/** Largest single attachment. Receipt photos; a 15 MB phone picture fits. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Largest multi-file upload in one request (AP-17 posts several at once). */
export const MAX_ATTACHMENT_COUNT = 20;

/** Ceiling on one multipart body, so a huge post is refused before buffering. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 60 * 1024 * 1024;

export type AttachmentKind = "image" | "pdf";

export interface AttachmentType {
  /** Canonical MIME type. Never the caller's string. */
  contentType: string;
  /** Canonical extension, leading dot omitted. */
  extension: string;
  kind: AttachmentKind;
  /**
   * Safe to render on the app origin with `Content-Disposition: inline`.
   * True only for raster images — a browser given `image/png` under
   * `X-Content-Type-Options: nosniff` will decode it or fail, never script it.
   */
  inlineSafe: boolean;
}

const PNG: AttachmentType = { contentType: "image/png", extension: "png", kind: "image", inlineSafe: true };
const JPEG: AttachmentType = { contentType: "image/jpeg", extension: "jpg", kind: "image", inlineSafe: true };
const GIF: AttachmentType = { contentType: "image/gif", extension: "gif", kind: "image", inlineSafe: true };
const WEBP: AttachmentType = { contentType: "image/webp", extension: "webp", kind: "image", inlineSafe: true };
const HEIC: AttachmentType = { contentType: "image/heic", extension: "heic", kind: "image", inlineSafe: false };
const PDF: AttachmentType = { contentType: "application/pdf", extension: "pdf", kind: "pdf", inlineSafe: false };

export const ALLOWED_ATTACHMENT_TYPES: readonly AttachmentType[] = [PNG, JPEG, GIF, WEBP, HEIC, PDF];

function startsWith(buf: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

function asciiAt(buf: Uint8Array, offset: number, text: string): boolean {
  return startsWith(buf, Array.from(text, (c) => c.charCodeAt(0)), offset);
}

/**
 * The type these bytes actually are, or null when they are not on the list.
 *
 * Signature-only: no extension and no declared type is consulted, so renaming
 * `payload.svg` to `receipt.png` changes nothing.
 */
export function sniffAttachment(bytes: Uint8Array): AttachmentType | null {
  if (bytes.length < 12) return null;

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (asciiAt(bytes, 0, "GIF87a") || asciiAt(bytes, 0, "GIF89a")) return GIF;
  if (asciiAt(bytes, 0, "RIFF") && asciiAt(bytes, 8, "WEBP")) return WEBP;
  // ISO-BMFF: a 4-byte box length, then "ftyp", then the brand.
  if (asciiAt(bytes, 4, "ftyp")) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (["heic", "heix", "hevc", "heim", "heis", "hevm", "mif1", "msf1"].includes(brand)) return HEIC;
    return null;
  }
  if (asciiAt(bytes, 0, "%PDF-")) return PDF;

  return null;
}

/** True when the bytes look like SVG — an XML or HTML document, not a picture. */
export function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<?xml") || head.startsWith("<svg") || head.startsWith("<!doctype") || head.startsWith("<html");
}

export interface AttachmentRejection {
  ok: false;
  /** HTTP status the caller should answer with. */
  status: 400 | 413;
  /** Thai, user-facing — these surface directly in the upload UI. */
  error: string;
}

export interface AttachmentAcceptance {
  ok: true;
  type: AttachmentType;
}

export type AttachmentCheck = AttachmentAcceptance | AttachmentRejection;

/**
 * Decide whether one uploaded file may be stored.
 *
 * `declaredType` is accepted only so an obviously-wrong claim can be reported
 * with a clearer message; it never widens what is allowed.
 */
export function checkAttachment(input: {
  fileName: string;
  declaredType?: string | null;
  bytes: Uint8Array;
  /** Restrict to a subset — AP-1 stores photos only, AP-17 also takes PDFs. */
  allowedKinds?: readonly AttachmentKind[];
}): AttachmentCheck {
  const { bytes } = input;

  if (bytes.length === 0) {
    return { ok: false, status: 400, error: "ไฟล์ว่างเปล่า" };
  }
  if (bytes.length > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `ไฟล์ใหญ่เกิน ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB`,
    };
  }

  const type = sniffAttachment(bytes);
  if (!type) {
    if (looksLikeSvg(bytes)) {
      return { ok: false, status: 400, error: "ไม่รองรับไฟล์ SVG — กรุณาใช้ไฟล์ภาพถ่ายหรือ PDF" };
    }
    return { ok: false, status: 400, error: "ชนิดไฟล์ไม่ถูกต้อง — รองรับเฉพาะรูปภาพ (PNG/JPG/GIF/WEBP/HEIC) หรือ PDF" };
  }

  const allowedKinds = input.allowedKinds ?? ["image", "pdf"];
  if (!allowedKinds.includes(type.kind)) {
    return {
      ok: false,
      status: 400,
      error: allowedKinds.includes("pdf")
        ? "รองรับเฉพาะไฟล์รูปภาพหรือ PDF"
        : "แนบได้เฉพาะไฟล์รูปภาพเท่านั้น",
    };
  }

  return { ok: true, type };
}

/** Reject a whole multipart batch on count or aggregate size before storing any of it. */
export function checkAttachmentBatch(files: readonly { size: number }[]): AttachmentRejection | null {
  if (files.length > MAX_ATTACHMENT_COUNT) {
    return { ok: false, status: 400, error: `แนบได้ไม่เกิน ${MAX_ATTACHMENT_COUNT} ไฟล์ต่อครั้ง` };
  }
  let total = 0;
  for (const f of files) total += Number.isFinite(f.size) ? f.size : 0;
  if (total > MAX_ATTACHMENT_TOTAL_BYTES) {
    return {
      ok: false,
      status: 413,
      error: `ไฟล์รวมกันใหญ่เกิน ${Math.floor(MAX_ATTACHMENT_TOTAL_BYTES / (1024 * 1024))} MB`,
    };
  }
  return null;
}

/**
 * Strip a stored file name down to something safe to put in a header.
 *
 * The old routes interpolated `FileName` straight into `Content-Disposition`.
 * The column is 500 chars of whatever the browser sent, so a name containing a
 * double quote ends the quoted-string early and one containing CR/LF splits the
 * header — the value is attacker-chosen at upload time and replayed to every
 * later viewer. Quotes, control characters and path separators all go.
 */
const UNSAFE_NAME_CHARS = new RegExp(
  "[\u0000-\u001f\u007f\"'\\/:*?<>|]+",
  "g",
);

export function sanitizeDownloadName(name: string | null | undefined, fallbackExtension: string): string {
  // Control characters, the characters the header quoting uses, and every
  // path separator. What survives is safe in the header and on disk.
  const base = (name ?? "").replace(UNSAFE_NAME_CHARS, "_").trim();
  const trimmed = base.slice(0, 180);
  // `///` and `..` both collapse to something with no content of their own.
  // Anything left that is only separators, dots or spaces is not a name.
  if (!/[^_.\s]/.test(trimmed)) return `attachment.${fallbackExtension}`;
  return trimmed;
}

/**
 * Headers for serving stored bytes back.
 *
 * The type is re-derived from the bytes on every download rather than read from
 * `AccRequestFile.ContentType`, because rows written before this guard existed
 * carry whatever the uploader declared. Anything unrecognised is served as an
 * opaque download; only raster images stay inline, which is what the `<img>`
 * previews in AP-1's expense rows and AP-17's ID-card panel need.
 *
 * `sandbox` in the CSP is the belt to `nosniff`'s braces: the proxy attaches a
 * page CSP to non-API responses only, and these are API responses.
 */
export function attachmentResponseHeaders(input: {
  bytes: Uint8Array;
  fileName: string | null | undefined;
}): Record<string, string> {
  const type = sniffAttachment(input.bytes);
  const contentType = type?.contentType ?? "application/octet-stream";
  const disposition = type?.inlineSafe ? "inline" : "attachment";
  const fileName = sanitizeDownloadName(input.fileName, type?.extension ?? "bin");

  return {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cache-Control": "private, no-store",
  };
}
