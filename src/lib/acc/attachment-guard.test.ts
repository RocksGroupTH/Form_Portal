import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  attachmentResponseHeaders,
  checkAttachment,
  checkAttachmentBatch,
  looksLikeEncryptedWorkbook,
  looksLikeMacroWorkbook,
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

/* ── Container fixtures (AP-4's workbook slot) ──
   Both formats keep their part / stream names in the clear, so a fixture only
   needs the signature plus the name the sniffer looks for. */

/** UTF-16LE, the encoding OLE2 stores directory entry names in. */
function utf16(text: string): number[] {
  const out: number[] = [];
  for (const c of text) {
    out.push(c.charCodeAt(0) & 0xff, c.charCodeAt(0) >> 8);
  }
  return out;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE2 = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const XLSX_BYTES = bytes(ZIP, PAD, "[Content_Types].xml", PAD, "xl/workbook.xml", PAD);
const XLSM_BYTES = bytes(ZIP, PAD, "xl/workbook.xml", PAD, "xl/vbaProject.bin", PAD);
const DOCX_BYTES = bytes(ZIP, PAD, "word/document.xml", PAD);
const ZIP_BYTES = bytes(ZIP, PAD, "holiday-photos/DSC0001.JPG", PAD);
const XLS_BYTES = bytes(OLE2, PAD, utf16("Workbook"), PAD);
const XLS_MACRO_BYTES = bytes(OLE2, PAD, utf16("Workbook"), PAD, utf16("_VBA_PROJECT"), PAD);
const DOC_BYTES = bytes(OLE2, PAD, utf16("WordDocument"), PAD);
/**
 * A password-protected `.xlsx`: the OOXML package is encrypted whole and
 * wrapped in a CFB container, so the only stream names in the clear are the
 * wrapper's own. Nothing about it says "workbook" to a byte search.
 */
const ENCRYPTED_XLSX_BYTES = bytes(
  OLE2,
  PAD,
  utf16("EncryptionInfo"),
  PAD,
  utf16("EncryptedPackage"),
  PAD,
);

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

/* ── AP-4's workbook slot ── */

test("a workbook is recognised by its part name, not by its container signature", () => {
  assert.equal(
    sniffAttachment(XLSX_BYTES)?.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(sniffAttachment(XLS_BYTES)?.contentType, "application/vnd.ms-excel");
  // Same ZIP / OLE2 signature, no workbook inside: still nothing on the list.
  assert.equal(sniffAttachment(DOCX_BYTES), null);
  assert.equal(sniffAttachment(ZIP_BYTES), null);
  assert.equal(sniffAttachment(DOC_BYTES), null);
});

test("a workbook never renders inline on the app origin", () => {
  assert.equal(sniffAttachment(XLSX_BYTES)?.inlineSafe, false);
  assert.equal(sniffAttachment(XLS_BYTES)?.inlineSafe, false);
  const headers = attachmentResponseHeaders({ bytes: XLSX_BYTES, fileName: "AP-4.1.xlsx" });
  assert.match(headers["Content-Disposition"], /^attachment;/);
});

test("a macro workbook is accepted, and typed as one", () => {
  // Reversed on 2026-08-19 by the controller, on the same fixtures that pinned
  // the refusal: `AccReimburse.ExcelFileId` is an unconditional AP-4 submit
  // gate, so refusing `.xlsm` costs the entire form if that is the format the
  // AP-4.1 template ships in. The detection did not change — only what it
  // decides did, from "refuse" to "which type is this".
  assert.equal(looksLikeMacroWorkbook(XLSM_BYTES), true);
  assert.equal(looksLikeMacroWorkbook(XLS_MACRO_BYTES), true);
  assert.equal(looksLikeMacroWorkbook(XLSX_BYTES), false);

  assert.equal(
    sniffAttachment(XLSM_BYTES)?.contentType,
    "application/vnd.ms-excel.sheet.macroEnabled.12",
  );
  assert.equal(sniffAttachment(XLSM_BYTES)?.extension, "xlsm");
  assert.equal(sniffAttachment(XLSM_BYTES)?.kind, "spreadsheet");
  // Legacy `.xls` has one extension whether or not it carries macros.
  assert.equal(sniffAttachment(XLS_MACRO_BYTES)?.contentType, "application/vnd.ms-excel");

  const result = checkAttachment({
    fileName: "summary.xlsm",
    bytes: XLSM_BYTES,
    allowedKinds: ["spreadsheet"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.type.extension, "xlsm");
});

test("accepting macros widened one slot's file list, not the guard", () => {
  // It still never renders on the app origin, and it is still admitted nowhere
  // that does not name `spreadsheet` — AP-1's and AP-17's slots included.
  assert.equal(sniffAttachment(XLSM_BYTES)?.inlineSafe, false);
  const headers = attachmentResponseHeaders({ bytes: XLSM_BYTES, fileName: "AP-4.1.xlsm" });
  assert.match(headers["Content-Disposition"], /^attachment;/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");

  assert.equal(
    checkAttachment({ fileName: "m.xlsm", bytes: XLSM_BYTES, allowedKinds: ["image", "pdf"] }).ok,
    false,
  );
  assert.equal(
    checkAttachment({ fileName: "m.xlsm", bytes: XLSM_BYTES, allowedKinds: ["image"] }).ok,
    false,
  );
  assert.equal(checkAttachment({ fileName: "m.xlsm", bytes: XLSM_BYTES }).ok, false);
});

test("a password-protected workbook is told it is protected, not that it is not Excel", () => {
  // The generic message would deny that an Excel file is Excel: the package is
  // encrypted whole, so no part name is in the clear for the sniffer to find.
  assert.equal(sniffAttachment(ENCRYPTED_XLSX_BYTES), null);
  assert.equal(looksLikeEncryptedWorkbook(ENCRYPTED_XLSX_BYTES), true);
  assert.equal(looksLikeEncryptedWorkbook(XLSX_BYTES), false);
  assert.equal(looksLikeEncryptedWorkbook(XLS_BYTES), false);
  assert.equal(looksLikeEncryptedWorkbook(PDF_BYTES), false);

  const result = checkAttachment({
    fileName: "protected.xlsx",
    bytes: ENCRYPTED_XLSX_BYTES,
    allowedKinds: ["spreadsheet"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 400);
  assert.match(result.ok === false ? result.error : "", /รหัสผ่าน/);
});

test("the workbook slot does not widen the receipt slot, and vice versa", () => {
  // The whole point of adding a kind rather than loosening the sniffer: each
  // AP-4 slot names what it takes, and neither can be posted the other's file.
  const workbookToReceipts = checkAttachment({
    fileName: "AP-4.1.xlsx",
    declaredType: "application/vnd.ms-excel",
    bytes: XLSX_BYTES,
    allowedKinds: ["image", "pdf"],
  });
  assert.equal(workbookToReceipts.ok, false);

  const receiptToWorkbook = checkAttachment({
    fileName: "receipt.jpg",
    bytes: JPEG_BYTES,
    allowedKinds: ["spreadsheet"],
  });
  assert.equal(receiptToWorkbook.ok, false);
  assert.match(receiptToWorkbook.ok === false ? receiptToWorkbook.error : "", /Excel/);

  const workbookToItsOwnSlot = checkAttachment({
    fileName: "AP-4.1.xlsx",
    bytes: XLSX_BYTES,
    allowedKinds: ["spreadsheet"],
  });
  assert.equal(workbookToItsOwnSlot.ok, true);
});

test("omitting allowedKinds still means images and PDFs only", () => {
  // AP-1 and AP-17 were not widened by AP-4's kind existing.
  assert.equal(checkAttachment({ fileName: "a.xlsx", bytes: XLSX_BYTES }).ok, false);
  assert.equal(checkAttachment({ fileName: "a.png", bytes: PNG_BYTES }).ok, true);
  assert.equal(checkAttachment({ fileName: "a.pdf", bytes: PDF_BYTES }).ok, true);
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

/* ── A workbook Excel actually wrote ────────────────────────────────────────
   Every other container fixture above is hand-built, and each one encodes the
   same assumption the detector makes: that the marker appears as a plain
   substring. A change that broke real workbooks — a scan window, an offset
   anchor, a case slip, reading the central directory instead of the local
   headers — would pass all of them. This one cannot be wrong about the format
   because nobody here chose the format: it is an empty workbook saved by
   Excel 16.0 as .xlsx, verbatim, with personal information removed (Excel's
   own "Remove Personal Information" — the creator and last-modified-by fields
   are empty by that switch, everything else is Excel's own output).

   8,336 bytes: [Content_Types].xml, _rels/.rels, docProps/app.xml,
   docProps/core.xml, xl/workbook.xml, xl/_rels/workbook.xml.rels,
   xl/styles.xml, xl/theme/theme1.xml, xl/worksheets/sheet1.xml. */

const REAL_XLSX_BASE64 = [
"UEsDBBQABgAIAAAAIQCkU8XPTgEAAAgEAAATAAgCW0NvbnRlbnRfVHlwZXNdLnhtbCCiBAIooAACAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACsk8tOwzAQRfdI/EPkLYrdskAINe2CxxK6KB9g4kli",
  "1S953NL+PRP3sUChFWo3sWLP3HM9M57MNtYUa4iovavYmI9YAa72Sru2Yp+Lt/KRFZikU9J4BxXbArLZ9PZmstgGwIKyHVasSyk8",
  "CYF1B1Yi9wEcnTQ+WpnoN7YiyHopWxD3o9GDqL1L4FKZeg02nbxAI1cmFa8b2t45iWCQFc+7wJ5VMRmC0bVM5FSsnfpFKfcETpk5",
  "Bjsd8I5sMDFI6E/+BuzzPqg0USso5jKmd2nJhtgY8e3j8sv7JT8tMuDSN42uQfl6ZakCHEMEqbADSNbwvHIrtTv4PsHPwSjyMr6y",
  "kf5+WfiMj0T9BpG/l1vIMmeAmLYG8Nplz6KnyNSvefQBaXIj/J9+GM0+uwwkBDFpOA7nUJOPRJr6i68L/btSoAbYIr/j6Q8AAAD/",
  "/wMAUEsDBBQABgAIAAAAIQC1VTAj9AAAAEwCAAALAAgCX3JlbHMvLnJlbHMgogQCKKAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAArJJNT8MwDIbvSPyHyPfV3ZAQQkt3QUi7IVR+gEncD7WNoyQb",
  "3b8nHBBUGoMDR3+9fvzK2908jerIIfbiNKyLEhQ7I7Z3rYaX+nF1ByomcpZGcazhxBF21fXV9plHSnkodr2PKqu4qKFLyd8jRtPx",
  "RLEQzy5XGgkTpRyGFj2ZgVrGTVneYviuAdVCU+2thrC3N6Dqk8+bf9eWpukNP4g5TOzSmRXIc2Jn2a58yGwh9fkaVVNoOWmwYp5y",
  "OiJ5X2RswPNEm78T/XwtTpzIUiI0Evgyz0fHJaD1f1q0NPHLnXnENwnDq8jwyYKLH6jeAQAA//8DAFBLAwQUAAYACAAAACEAiOPG",
  "W2QDAAB1CAAADwAAAHhsL3dvcmtib29rLnhtbKxWW2+jOBR+X2n/A+LdxQabm5qOIIC2Ujuq2mw7+zRywWmscomMc6mq+e9zTELS",
  "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",
  "AD4CAAA8HgAAAAA=",
].join("");

const REAL_XLSX_BYTES = Uint8Array.from(Buffer.from(REAL_XLSX_BASE64, "base64"));

test("a workbook Excel actually wrote sniffs as XLSX and passes the workbook slot", () => {
  assert.equal(REAL_XLSX_BYTES.length, 8336);
  assert.equal(
    sniffAttachment(REAL_XLSX_BYTES)?.contentType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(sniffAttachment(REAL_XLSX_BYTES)?.extension, "xlsx");
  // No VBA project in it, so it is an .xlsx and not an .xlsm.
  assert.equal(looksLikeMacroWorkbook(REAL_XLSX_BYTES), false);
  assert.equal(looksLikeEncryptedWorkbook(REAL_XLSX_BYTES), false);

  const result = checkAttachment({
    fileName: "AP-4.1.xlsx",
    // What a browser sends for an .xlsx, which the guard treats as a hint only.
    declaredType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: REAL_XLSX_BYTES,
    allowedKinds: ["spreadsheet"],
  });
  assert.equal(result.ok, true);
  assert.equal(result.ok === true && result.type.kind, "spreadsheet");

  // And it is still not a receipt, nor anything AP-1 or AP-17 will take.
  assert.equal(
    checkAttachment({ fileName: "AP-4.1.xlsx", bytes: REAL_XLSX_BYTES, allowedKinds: ["image", "pdf"] }).ok,
    false,
  );
  assert.equal(checkAttachment({ fileName: "AP-4.1.xlsx", bytes: REAL_XLSX_BYTES }).ok, false);

  // Served back: a forced download, never inline on the app origin.
  const headers = attachmentResponseHeaders({ bytes: REAL_XLSX_BYTES, fileName: "AP-4.1.xlsx" });
  assert.match(headers["Content-Disposition"], /^attachment;/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});

/* ── `allowedKinds: "any"` — the unrestricted slot ──
 *
 * AP-1 was widened to accept any file on 2026-08-26. The allowlist is what
 * stops that being dangerous everywhere *else*, so these tests pin the two
 * halves of the bargain: the kind check is the only thing "any" switches off,
 * and nothing it lets through is ever marked safe to render inline.
 */

test('"any" accepts bytes no sniffer recognises, as an opaque download', () => {
  const check = checkAttachment({
    fileName: "notes.docx",
    bytes: DOCX_BYTES,
    allowedKinds: "any",
  });
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.type.contentType, "application/octet-stream");
  assert.equal(check.type.inlineSafe, false);
});

test('"any" still recognises a real image, so photos keep their preview', () => {
  const check = checkAttachment({ fileName: "receipt.jpg", bytes: JPEG_BYTES, allowedKinds: "any" });
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.type.contentType, "image/jpeg");
  assert.equal(check.type.inlineSafe, true);
});

test('"any" accepts an SVG but never marks it inline-safe', () => {
  const check = checkAttachment({ fileName: "logo.svg", bytes: SVG_BYTES, allowedKinds: "any" });
  assert.equal(check.ok, true);
  if (!check.ok) return;
  assert.equal(check.type.inlineSafe, false);
  // The download path re-sniffs and reaches the same verdict, which is what
  // actually stops it executing on our origin.
  const headers = attachmentResponseHeaders({ bytes: SVG_BYTES, fileName: "logo.svg" });
  assert.match(headers["Content-Disposition"], /^attachment;/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
});

test('"any" still refuses an empty file', () => {
  const check = checkAttachment({ fileName: "empty.bin", bytes: new Uint8Array(0), allowedKinds: "any" });
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.status, 400);
});

test('"any" still enforces the size cap', () => {
  const check = checkAttachment({
    fileName: "huge.bin",
    bytes: new Uint8Array(MAX_ATTACHMENT_BYTES + 1),
    allowedKinds: "any",
  });
  assert.equal(check.ok, false);
  if (check.ok) return;
  assert.equal(check.status, 413);
});
