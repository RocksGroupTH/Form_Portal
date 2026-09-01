import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReceiptDocs } from "./ai-receipt-core";

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
