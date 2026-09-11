import { test } from "node:test";
import assert from "node:assert/strict";
import { countPdfPageObjects } from "./pdf-page-count";

/* A page count read off the bytes, used only to catch a loader that claims
   fewer pages than are plainly in the file — which is what a nine-page bundle
   did inside the Next server on 2026-09-11 while a plain Node process on the
   same bytes read nine. */

test("counts the page objects a classic PDF declares", () => {
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type /Page /Parent 2 0 R>>endobj\n"
    + "3 0 obj<</Type /Page /Parent 2 0 R>>endobj\n", "latin1");
  assert.equal(countPdfPageObjects(pdf), 2);
});

test("the page tree node is not a page", () => {
  const pdf = Buffer.from("%PDF-1.4\n2 0 obj<</Type /Pages /Count 9>>endobj\n", "latin1");
  assert.equal(countPdfPageObjects(pdf), 0);
});

test("a file that hides its page tree answers zero rather than guessing", () => {
  assert.equal(countPdfPageObjects(Buffer.from("%PDF-1.7\n<compressed object streams>", "latin1")), 0);
});

test("spacing between the key and the value does not hide a page", () => {
  const pdf = Buffer.from("<</Type/Page /X 1>> <</Type  /Page /Y 2>>", "latin1");
  assert.equal(countPdfPageObjects(pdf), 2);
});
