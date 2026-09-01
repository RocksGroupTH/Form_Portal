import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RECEIPT_SYSTEM,
  buildGlSuggestUserText,
  parseReceiptDocs,
  pickSuggestedGl,
  toDate,
} from "./ai-receipt-core";

/** Most tests only care about the rows; the skip count has its own tests. */
const docsOf = (raw: string) => parseReceiptDocs(raw).docs;

const TWO_DOCS = `[
  {"date":"2026-08-04","description":"ค่าแท็กซี่","docNo":"INV-001","amountBeforeVat":"1,000","vat":70,"wht":null,
   "taxId":"0105512345678","payeeName":"บจก. เอ","payeeAddress":"กรุงเทพฯ"},
  {"date":"2026-08-05","description":"ค่าอาหาร","docNo":"INV-002","amountBeforeVat":500,"vat":35,"wht":15,
   "taxId":null,"payeeName":"บจก. บี","payeeAddress":null}
]`;

test("two documents in one image -> two rows, each with its own invoice number", () => {
  const docs = docsOf(TWO_DOCS);
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.docNo), ["INV-001", "INV-002"]);
  assert.equal(docs[0].beforeVat, 1000);
  assert.equal(docs[0].vat, 70);
  assert.equal(docs[0].total, 1070);
  assert.equal(docs[0].taxId, "0105512345678");
  assert.equal(docs[1].wht, 15);
  assert.equal(docs[1].payeeAddress, null);
});

test("a single-invoice image still yields a one-element array", () => {
  const docs = docsOf('{"date":"2026-08-04","docNo":"A1","amountBeforeVat":100,"vat":7}');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].docNo, "A1");
  assert.equal(docs[0].total, 107);
});

test("markdown fences and surrounding prose are tolerated", () => {
  const docs = docsOf('Here you go:\n```json\n[{"docNo":"B2","amountBeforeVat":50}]\n```\n');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].docNo, "B2");
});

test("entries with nothing usable are dropped", () => {
  const docs = docsOf('[{"docNo":"C3","amountBeforeVat":10},{"date":null,"docNo":null,"description":null,"amountBeforeVat":null,"payeeName":null}]');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].docNo, "C3");
});

test("unparseable output yields no rows rather than throwing", () => {
  assert.deepEqual(docsOf("I cannot read this image."), []);
  assert.deepEqual(docsOf("[{oops}]"), []);
  assert.deepEqual(docsOf(""), []);
});

test("each document carries the kind the model classified it as", () => {
  const docs = docsOf(`[
    {"kind":"slip","date":"2026-01-06","amountBeforeVat":8969,"docNo":"016006114139DTF04569"},
    {"kind":"receipt","docNo":"EBYC25120005297","amountBeforeVat":1031}
  ]`);
  assert.deepEqual(docs.map((d) => d.kind), ["slip", "receipt"]);
});

test("only receipts and slips become rows — anything else is counted, not listed", () => {
  // The AP-3 sample bundle: a BC voucher, a handwritten summary, a slip, a receipt.
  const read = parseReceiptDocs(`[
    {"kind":"other","pages":1},
    {"kind":"other","pages":1},
    {"kind":"slip","date":"2026-01-06","amountBeforeVat":8969,"docNo":"016006114139DTF04569"},
    {"kind":"receipt","docNo":"EBYC25120005297","pages":4,"amountBeforeVat":1031}
  ]`);
  assert.deepEqual(read.docs.map((d) => d.docNo), ["016006114139DTF04569", "EBYC25120005297"]);
  assert.equal(read.skippedPages, 2);
});

test("an invented description on a skipped page never reaches a row", () => {
  const read = parseReceiptDocs(
    '[{"kind":"other","pages":2,"description":"บริการเช่าห้อง - ธนง","amountBeforeVat":5000}]',
  );
  assert.deepEqual(read.docs, []);
  assert.equal(read.skippedPages, 2);
});

test("a skipped entry with no page count still counts as one page", () => {
  assert.equal(parseReceiptDocs('[{"kind":"other"}]').skippedPages, 1);
  assert.equal(parseReceiptDocs('[{"kind":"other","pages":0}]').skippedPages, 1);
  // A nonsense page count cannot inflate the message past a plausible upload.
  assert.equal(parseReceiptDocs('[{"kind":"other","pages":9999}]').skippedPages, 50);
});

test("nothing skipped when every page was readable", () => {
  assert.equal(parseReceiptDocs(TWO_DOCS).skippedPages, 0);
  assert.equal(parseReceiptDocs("I cannot read this image.").skippedPages, 0);
});

test("an unlabelled or unknown kind falls back to receipt", () => {
  assert.equal(docsOf('[{"docNo":"A1","amountBeforeVat":10}]')[0].kind, "receipt");
  assert.equal(docsOf('[{"kind":"invoice","docNo":"A1","amountBeforeVat":10}]')[0].kind, "receipt");
});

test("one invoice printed across four pages collapses to one row", () => {
  // The KEX receipt in the AP-3 sample bundle: the same number on every page.
  const page = (n: number) =>
    `{"kind":"receipt","docNo":"EBYC25120005297","description":"Transportation .1KG","amountBeforeVat":${n}}`;
  const docs = docsOf(`[${page(19)},${page(19)},${page(19)},${page(1031)}]`);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].beforeVat, 19);
});

const NOW = new Date("2026-09-01T00:00:00Z");

test("a date the model already converted is kept as it is", () => {
  // The K+ slip in the AP-3 sample: "โอนเงินสำเร็จ 6 ม.ค. 69" = 6 January 2026.
  assert.equal(toDate("2026-01-06", NOW), "2026-01-06");
  assert.equal(toDate("2025-12-23", NOW), "2025-12-23");
});

test("a Buddhist year the model forgot to convert is finished off", () => {
  assert.equal(toDate("2569-01-06", NOW), "2026-01-06");
  assert.equal(toDate("2568-12-23", NOW), "2025-12-23");
});

test("a date that cannot exist is refused rather than rolled over", () => {
  assert.equal(toDate("2026-02-30", NOW), null);
  assert.equal(toDate("2026-13-01", NOW), null);
  assert.equal(toDate("2026-00-10", NOW), null);
  assert.equal(toDate("2026-01-32", NOW), null);
});

test("a date more than a year out is a misread, not a document date", () => {
  assert.equal(toDate("2027-08-31", NOW), "2027-08-31");
  assert.equal(toDate("2028-01-06", NOW), null);
});

test("anything that is not an ISO date is refused", () => {
  assert.equal(toDate("6 ม.ค. 69", NOW), null);
  assert.equal(toDate("06/01/2569", NOW), null);
  assert.equal(toDate("", NOW), null);
  assert.equal(toDate(null, NOW), null);
  assert.equal(toDate(20260106, NOW), null);
});

test("a document keeps only a date that survived the guard", () => {
  const docs = docsOf('[{"docNo":"A1","date":"2569-01-06","amountBeforeVat":10}]');
  assert.equal(docs[0].date, "2026-01-06");
  const bad = docsOf('[{"docNo":"A2","date":"2026-02-30","amountBeforeVat":10}]');
  assert.equal(bad[0].date, null);
});

test("the prompt spells out the Thai day-month-year order", () => {
  assert.ok(RECEIPT_SYSTEM.includes("DAY month YEAR"));
  assert.ok(RECEIPT_SYSTEM.includes("ม.ค.=01"));
  assert.ok(RECEIPT_SYSTEM.includes("ธ.ค.=12"));
  assert.ok(RECEIPT_SYSTEM.includes("subtract 543"));
});

const ALLOWED = ["610322005", "610101001", "115030"];

test("a suggestion from the candidate list is kept", () => {
  assert.equal(pickSuggestedGl("610322005", ALLOWED), "610322005");
  assert.equal(pickSuggestedGl("610322005 — ค่าเดินทาง\n", ALLOWED), "610322005");
});

test("a suggestion outside the candidate list is discarded", () => {
  assert.equal(pickSuggestedGl("610999999", ALLOWED), "");
  // Not a prefix/substring match either — a longer number is a different account.
  assert.equal(pickSuggestedGl("6103220050", ALLOWED), "");
  assert.equal(pickSuggestedGl("ไม่มีบัญชีที่ตรง", ALLOWED), "");
  assert.equal(pickSuggestedGl("", ALLOWED), "");
});

test("the prompt lists exactly the accounts the branch allows", () => {
  const text = buildGlSuggestUserText("ค่าแท็กซี่", [
    { glAccountNo: "610322005", nameTh: "ค่าเดินทาง", nameEn: null },
    { glAccountNo: "115030", nameTh: null, nameEn: "VAT" },
  ]);
  assert.ok(text.includes("610322005 = ค่าเดินทาง"));
  assert.ok(text.includes("115030 = VAT"));
  assert.ok(text.includes("ค่าแท็กซี่"));
});
