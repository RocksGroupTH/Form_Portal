import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGlSuggestUserText, parseReceiptDocs, pickSuggestedGl } from "./ai-receipt-core";

const TWO_DOCS = `[
  {"date":"2026-08-04","description":"ค่าแท็กซี่","docNo":"INV-001","amountBeforeVat":"1,000","vat":70,"wht":null,
   "taxId":"0105512345678","payeeName":"บจก. เอ","payeeAddress":"กรุงเทพฯ"},
  {"date":"2026-08-05","description":"ค่าอาหาร","docNo":"INV-002","amountBeforeVat":500,"vat":35,"wht":15,
   "taxId":null,"payeeName":"บจก. บี","payeeAddress":null}
]`;

test("two documents in one image -> two rows, each with its own invoice number", () => {
  const docs = parseReceiptDocs(TWO_DOCS);
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
  const docs = parseReceiptDocs('{"date":"2026-08-04","docNo":"A1","amountBeforeVat":100,"vat":7}');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].docNo, "A1");
  assert.equal(docs[0].total, 107);
});

test("markdown fences and surrounding prose are tolerated", () => {
  const docs = parseReceiptDocs('Here you go:\n```json\n[{"docNo":"B2","amountBeforeVat":50}]\n```\n');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].docNo, "B2");
});

test("entries with nothing usable are dropped", () => {
  const docs = parseReceiptDocs('[{"docNo":"C3","amountBeforeVat":10},{"date":null,"docNo":null,"description":null,"amountBeforeVat":null,"payeeName":null}]');
  assert.equal(docs.length, 1);
  assert.equal(docs[0].docNo, "C3");
});

test("unparseable output yields no rows rather than throwing", () => {
  assert.deepEqual(parseReceiptDocs("I cannot read this image."), []);
  assert.deepEqual(parseReceiptDocs("[{oops}]"), []);
  assert.deepEqual(parseReceiptDocs(""), []);
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
