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
 *
 * Excel workbooks (`kind: "spreadsheet"` — `.xlsx`, `.xlsm` and legacy `.xls`)
 * were added for AP-4, whose form has a slot for the AP-4.1 summary workbook
 * beside its receipt slot. They are **not in the default `allowedKinds`**, so
 * no existing caller widened: AP-1 passes `["image"]`, AP-17 and AP-4's receipt
 * slot pass `["image", "pdf"]`, and only AP-4's workbook slot passes
 * `["spreadsheet"]`. A workbook posted to a receipt slot now sniffs
 * successfully and is then refused on kind, which is the same 400 it got before
 * and a clearer message.
 *
 * ## Why a workbook needs more than a magic number
 *
 * `.xlsx` is a ZIP and `.xls` is an OLE2 compound file — both container formats
 * shared with things that are not spreadsheets (`.docx`, `.jar`, any `.zip`;
 * `.doc`, `.msi`). The signature alone says only "a container", so each is
 * narrowed by a part/stream name that a workbook carries and that both formats
 * store *uncompressed*: `xl/workbook.xml` in the ZIP entry headers, and the
 * UTF-16LE `Workbook` stream name in the OLE2 directory. No inflating, no FAT
 * walking, no dependency — still pure functions over bytes.
 *
 * **That establishes the right shape, not safety**, exactly as the five-byte
 * `%PDF-` rule above it does. A `.docx` or a bare `.zip` built to contain an
 * `xl/workbook.xml` entry passes, and a `.doc` with an embedded Excel object
 * carries a `Workbook` stream and sniffs as `.xls` without anyone crafting
 * anything. What the check buys is that a photo, an SVG or an arbitrary
 * document does not reach the workbook slot by being renamed — the same thing
 * every other rule here buys. Nothing downstream opens the bytes: they are
 * stored, and served back as a forced download under `nosniff` and a `sandbox`
 * CSP.
 *
 * Macro-enabled workbooks are **accepted** (2026-08-19, controller's ruling).
 * They were refused for one release. `AccReimburse.ExcelFileId` is an
 * unconditional AP-4 submit gate, so if the AP-4.1 template Accounting hands
 * out is an `.xlsm`, refusing it does not cost a marginal risk — it costs the
 * whole form. Excel's own macro protections are what stand between the
 * accountant and a macro either way. A VBA project therefore only changes which
 * type the bytes are (`XLSM` rather than `XLSX`, same kind, same forced
 * download), never whether they are admitted.
 */

/** Largest single attachment. Receipt photos; a 15 MB phone picture fits. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** Largest multi-file upload in one request (AP-17 posts several at once). */
export const MAX_ATTACHMENT_COUNT = 20;

/** Ceiling on one multipart body, so a huge post is refused before buffering. */
export const MAX_ATTACHMENT_TOTAL_BYTES = 60 * 1024 * 1024;

export type AttachmentKind = "image" | "pdf" | "spreadsheet";

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
const XLSX: AttachmentType = {
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  extension: "xlsx",
  kind: "spreadsheet",
  inlineSafe: false,
};
const XLSM: AttachmentType = {
  contentType: "application/vnd.ms-excel.sheet.macroEnabled.12",
  extension: "xlsm",
  kind: "spreadsheet",
  inlineSafe: false,
};
const XLS: AttachmentType = {
  contentType: "application/vnd.ms-excel",
  extension: "xls",
  kind: "spreadsheet",
  inlineSafe: false,
};

export const ALLOWED_ATTACHMENT_TYPES: readonly AttachmentType[] = [
  PNG,
  JPEG,
  GIF,
  WEBP,
  HEIC,
  PDF,
  XLSX,
  XLSM,
  XLS,
];

/** The kinds a caller gets when it does not ask for a subset. Deliberately excludes `spreadsheet`. */
export const DEFAULT_ALLOWED_KINDS: readonly AttachmentKind[] = ["image", "pdf"];

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

/* ── Container formats: ZIP (.xlsx) and OLE2 (.xls) ── */

/** Local file header — the first bytes of every non-empty ZIP, `.xlsx` included. */
const ZIP_LOCAL_HEADER = [0x50, 0x4b, 0x03, 0x04];
/** OLE2 / Compound File Binary header — `.xls`, and also `.doc`, `.ppt`, `.msi`. */
const OLE2_HEADER = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * A `Buffer` over the same memory — no copy. `Buffer.prototype.indexOf` is the
 * only fast substring search available without a dependency, and a 15 MB
 * attachment is not worth copying to get at it.
 */
function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.isBuffer(bytes)
    ? bytes
    : Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function contains(bytes: Uint8Array, needle: Buffer): boolean {
  return asBuffer(bytes).indexOf(needle) !== -1;
}

/**
 * Part and stream names, stored uncompressed in both containers: ZIP keeps
 * every entry name in plaintext in its local headers and central directory,
 * and OLE2 keeps every stream name as UTF-16LE in its directory sectors. So a
 * plain byte search answers "is this a workbook" without decoding either
 * format.
 */
const ZIP_WORKBOOK_PART = Buffer.from("xl/workbook.xml", "latin1");
const ZIP_MACRO_PART = Buffer.from("vbaProject.bin", "latin1");
const OLE_WORKBOOK_STREAM = Buffer.from("Workbook", "utf16le");
const OLE_MACRO_STREAM = Buffer.from("_VBA_PROJECT", "utf16le");
/** The two streams an OOXML file encrypted with a password is wrapped in. */
const OLE_ENCRYPTED_PACKAGE_STREAM = Buffer.from("EncryptedPackage", "utf16le");
const OLE_ENCRYPTION_INFO_STREAM = Buffer.from("EncryptionInfo", "utf16le");

/**
 * True when the bytes are a workbook carrying a VBA project — a macro-enabled
 * `.xlsm`, or a legacy `.xls` with macros.
 *
 * **This is not a refusal** — see the header. It is the one definition of
 * "carries a VBA project", and `sniffAttachment` calls it to decide between
 * `XLSM` and `XLSX` so the two cannot drift apart. Note that a workbook *saved*
 * as `.xlsm` but holding no macro has no `vbaProject.bin` part and is
 * indistinguishable from an `.xlsx` by content; it is typed as one, which is
 * correct — the bytes are what is stored and served, not the name.
 */
export function looksLikeMacroWorkbook(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (startsWith(bytes, ZIP_LOCAL_HEADER)) {
    return contains(bytes, ZIP_MACRO_PART) && contains(bytes, ZIP_WORKBOOK_PART);
  }
  if (startsWith(bytes, OLE2_HEADER)) {
    return contains(bytes, OLE_MACRO_STREAM) && contains(bytes, OLE_WORKBOOK_STREAM);
  }
  return false;
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

  // Containers last: the signature only narrows the field, the part/stream name
  // decides. A `.docx` and a `.zip` share the ZIP header with `.xlsx`; a `.doc`
  // shares the OLE2 header with `.xls`. An ordinary one of either carries no
  // workbook marker and falls through to null. This is a shape test, not a
  // safety test — see the header for what it does and does not buy.
  if (startsWith(bytes, ZIP_LOCAL_HEADER)) {
    if (!contains(bytes, ZIP_WORKBOOK_PART)) return null;
    return looksLikeMacroWorkbook(bytes) ? XLSM : XLSX;
  }
  if (startsWith(bytes, OLE2_HEADER)) {
    // Legacy `.xls` has one extension whether or not it carries macros, so
    // `OLE_MACRO_STREAM` decides nothing here.
    return contains(bytes, OLE_WORKBOOK_STREAM) ? XLS : null;
  }

  return null;
}

/**
 * True when the bytes are a password-protected OOXML file: an OLE2 container
 * holding `EncryptionInfo` / `EncryptedPackage` instead of the workbook itself.
 * The real `.xlsx` is inside, encrypted, so no part name is in the clear and
 * `sniffAttachment` cannot see it — which would otherwise be reported as "only
 * Excel files are supported" to somebody holding an Excel file.
 *
 * A legacy `.xls` protected with a password is *not* this shape: it keeps its
 * plaintext `Workbook` stream and encrypts the records inside it, so it sniffs
 * as `XLS` and is accepted. Nothing here opens it, so that costs nothing beyond
 * a workbook whose reader will be asked for the password.
 */
export function looksLikeEncryptedWorkbook(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  if (!startsWith(bytes, OLE2_HEADER)) return false;
  return (
    contains(bytes, OLE_ENCRYPTED_PACKAGE_STREAM) || contains(bytes, OLE_ENCRYPTION_INFO_STREAM)
  );
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

/** A slot that takes workbooks and nothing else — AP-4's AP-4.1 upload. */
function isWorkbookOnly(allowedKinds: readonly AttachmentKind[]): boolean {
  return allowedKinds.length === 1 && allowedKinds[0] === "spreadsheet";
}

/** "These bytes are not on the list at all", worded for the slot that was posted to. */
function unrecognisedMessage(allowedKinds: readonly AttachmentKind[]): string {
  return isWorkbookOnly(allowedKinds)
    ? "ชนิดไฟล์ไม่ถูกต้อง — รองรับเฉพาะไฟล์ Excel (.xlsx/.xlsm/.xls)"
    : "ชนิดไฟล์ไม่ถูกต้อง — รองรับเฉพาะรูปภาพ (PNG/JPG/GIF/WEBP/HEIC) หรือ PDF";
}

/** "These bytes are a real attachment, but not one this slot takes." */
function wrongKindMessage(allowedKinds: readonly AttachmentKind[]): string {
  if (isWorkbookOnly(allowedKinds)) return "แนบได้เฉพาะไฟล์ Excel (.xlsx/.xlsm/.xls) เท่านั้น";
  return allowedKinds.includes("pdf")
    ? "รองรับเฉพาะไฟล์รูปภาพหรือ PDF"
    : "แนบได้เฉพาะไฟล์รูปภาพเท่านั้น";
}

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
  /**
   * Restrict to a subset — AP-1 stores photos only, AP-17 also takes PDFs, and
   * AP-4's workbook slot takes `["spreadsheet"]` and nothing else. Omitting it
   * means images and PDFs: `spreadsheet` is never allowed by default, so a new
   * caller cannot acquire it by forgetting to say what it wants.
   */
  allowedKinds?: readonly AttachmentKind[];
}): AttachmentCheck {
  const { bytes } = input;
  const allowedKinds = input.allowedKinds ?? DEFAULT_ALLOWED_KINDS;

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
    // Only where a workbook is a legal answer. An encrypted OLE container is
    // also what a password-protected .doc looks like, and telling AP-1's image
    // slot that its *Excel* file is protected names a file type the slot does
    // not take in the first place.
    if (allowedKinds.includes("spreadsheet") && looksLikeEncryptedWorkbook(bytes)) {
      return {
        ok: false,
        status: 400,
        error: "ไฟล์ Excel นี้ถูกตั้งรหัสผ่าน กรุณาบันทึกใหม่โดยไม่ใส่รหัสผ่าน",
      };
    }
    return { ok: false, status: 400, error: unrecognisedMessage(allowedKinds) };
  }

  if (!allowedKinds.includes(type.kind)) {
    return { ok: false, status: 400, error: wrongKindMessage(allowedKinds) };
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
