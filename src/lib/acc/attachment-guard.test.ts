import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  attachmentResponseHeaders,
  checkAttachment,
  checkAttachmentBatch,
  looksLikeSvg,
  sanitizeDownloadName,
  sniffAttachment,
} from "./attachment-guard";

/* ── Fixtures ── */

function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") for (const c of p) out.push(c.charCodeAt(0));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

/** Padding so every fixture clears the 12-byte floor `sniffAttachment` needs. */
const PAD = new Array(24).fill(0);

const PNG_BYTES = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], PAD);
const JPEG_BYTES = bytes([0xff, 0xd8, 0xff, 0xe0], PAD);
const GIF_BYTES = bytes("GIF89a", PAD);
const WEBP_BYTES = bytes("RIFF", [0, 0, 0, 0], "WEBP", PAD);
const HEIC_BYTES = bytes([0, 0, 0, 0x18], "ftyp", "heic", PAD);
const PDF_BYTES = bytes("%PDF-1.7", PAD);

/**
 * The payload the review asked to be refused: it declares `image/svg+xml`,
 * which the old `file.type.startsWith("image/")` gate accepted, and its body is
 * a document that runs script on whatever origin serves it.
 */
const SVG_BYTES = bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const HTML_BYTES = bytes("<!DOCTYPE html><html><body><script>alert(1)</script></body></html>");

/* ── Sniffing ── */

test("every allowed format is recognised from its signature alone", () => {
  assert.equal(sniffAttachment(PNG_BYTES)?.contentType, "image/png");
  assert.equal(sniffAttachment(JPEG_BYTES)?.contentType, "image/jpeg");
  assert.equal(sniffAttachment(GIF_BYTES)?.contentType, "image/gif");
  assert.equal(sniffAttachment(WEBP_BYTES)?.contentType, "image/webp");
  assert.equal(sniffAttachment(HEIC_BYTES)?.contentType, "image/heic");
  assert.equal(sniffAttachment(PDF_BYTES)?.contentType, "application/pdf");
});

test("SVG and HTML are not any allowed format", () => {
  assert.equal(sniffAttachment(SVG_BYTES), null);
  assert.equal(sniffAttachment(HTML_BYTES), null);
  assert.equal(looksLikeSvg(SVG_BYTES), true);
  assert.equal(looksLikeSvg(HTML_BYTES), true);
  assert.equal(looksLikeSvg(PNG_BYTES), false);
});

test("only raster images are safe to render inline on the app origin", () => {
  assert.equal(sniffAttachment(PNG_BYTES)?.inlineSafe, true);
  assert.equal(sniffAttachment(JPEG_BYTES)?.inlineSafe, true);
  // A PDF can carry script and HEIC cannot be rendered anyway — both download.
  assert.equal(sniffAttachment(PDF_BYTES)?.inlineSafe, false);
  assert.equal(sniffAttachment(HEIC_BYTES)?.inlineSafe, false);
});

/* ── Upload admission ── */

test("an SVG declaring image/svg+xml is refused, and says why", () => {
  const result = checkAttachment({
    fileName: "receipt.svg",
    declaredType: "image/svg+xml",
    bytes: SVG_BYTES,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
  assert.match(result.ok === false ? result.error : "", /SVG/);
});

test("renaming the SVG to .png and declaring image/png changes nothing", () => {
  // The whole point of sniffing: neither the extension nor the declared type
  // is consulted, so the two values a caller controls cannot open the gate.
  const result = checkAttachment({
    fileName: "receipt.png",
    declaredType: "image/png",
    bytes: SVG_BYTES,
  });
  assert.equal(result.ok, false);
});

test("a real PNG declaring a nonsense type is still accepted, as its true type", () => {
  const result = checkAttachment({
    fileName: "x",
    declaredType: "application/x-whatever",
    bytes: PNG_BYTES,
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.type.contentType, "image/png");
});

test("AP-1 takes photos only — a PDF is refused there and accepted for AP-17", () => {
  const ap1 = checkAttachment({ fileName: "a.pdf", bytes: PDF_BYTES, allowedKinds: ["image"] });
  assert.equal(ap1.ok, false);

  const ap17 = checkAttachment({ fileName: "a.pdf", bytes: PDF_BYTES, allowedKinds: ["image", "pdf"] });
  assert.equal(ap17.ok, true);
});

test("a zero-byte file is refused rather than stored as an empty attachment", () => {
  const result = checkAttachment({ fileName: "empty.png", bytes: new Uint8Array(0) });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
});

test("an oversize file is refused with 413, not 400", () => {
  const big = new Uint8Array(MAX_ATTACHMENT_BYTES + 1);
  big.set(PNG_BYTES.subarray(0, 8), 0);
  const result = checkAttachment({ fileName: "huge.png", bytes: big });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 413);
});

test("too many files in one post is refused before any of them is stored", () => {
  const many = new Array(MAX_ATTACHMENT_COUNT + 1).fill({ size: 1024 });
  const rejection = checkAttachmentBatch(many);
  assert.notEqual(rejection, null);
  assert.equal(rejection?.status, 400);
});

test("a batch within both limits passes", () => {
  assert.equal(checkAttachmentBatch([{ size: 1024 }, { size: 2048 }]), null);
});

test("aggregate size is capped even when each file is individually fine", () => {
  const rejection = checkAttachmentBatch(new Array(20).fill({ size: MAX_ATTACHMENT_BYTES - 1 }));
  assert.equal(rejection?.status, 413);
});

/* ── Download ── */

test("a stored SVG from before this guard is served as an opaque download", () => {
  // Rows written by the old routes carry whatever the uploader declared, so
  // the type is re-derived from the bytes on the way out too.
  const headers = attachmentResponseHeaders({ bytes: SVG_BYTES, fileName: "old.svg" });
  assert.equal(headers["Content-Type"], "application/octet-stream");
  assert.match(headers["Content-Disposition"], /^attachment;/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.match(headers["Content-Security-Policy"], /sandbox/);
});

test("a real image still renders inline, which the previews depend on", () => {
  const headers = attachmentResponseHeaders({ bytes: JPEG_BYTES, fileName: "receipt.jpg" });
  assert.equal(headers["Content-Type"], "image/jpeg");
  assert.match(headers["Content-Disposition"], /^inline;/);
});

test("a PDF downloads rather than rendering on the app origin", () => {
  const headers = attachmentResponseHeaders({ bytes: PDF_BYTES, fileName: "booking.pdf" });
  assert.equal(headers["Content-Type"], "application/pdf");
  assert.match(headers["Content-Disposition"], /^attachment;/);
});

test("a file name cannot break out of the Content-Disposition header", () => {
  const hostile = 'a"; filename="evil.html\r\nX-Injected: 1';
  const headers = attachmentResponseHeaders({ bytes: PNG_BYTES, fileName: hostile });
  const disposition = headers["Content-Disposition"];
  assert.equal(disposition.includes("\r"), false);
  assert.equal(disposition.includes("\n"), false);
  // The injected text survives as inert characters inside the one filename
  // value, which is the point — it is no longer a header of its own.
  assert.equal((disposition.match(/"/g) ?? []).length, 2);
  assert.equal(disposition.split("filename=").length - 1, 2);
});

test("a name made entirely of stripped characters falls back to a usable one", () => {
  assert.equal(sanitizeDownloadName('///', "png"), "attachment.png");
  assert.equal(sanitizeDownloadName("..", "pdf"), "attachment.pdf");
  assert.equal(sanitizeDownloadName(null, "jpg"), "attachment.jpg");
});

test("an ordinary Thai file name survives intact", () => {
  assert.equal(sanitizeDownloadName("ใบเสร็จ 2026.jpg", "jpg"), "ใบเสร็จ 2026.jpg");
});
