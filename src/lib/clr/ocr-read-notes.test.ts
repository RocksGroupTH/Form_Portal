import { test } from "node:test";
import assert from "node:assert/strict";
import { ocrReadNotes } from "./ocr-read-notes";

/* What the requester is told after the AI reads their receipts, now that there
   is no confirm screen to read it off. Only things worth acting on: a clean
   read says nothing at all and the rows just appear. */

const row = (patch: Partial<Parameters<typeof ocrReadNotes>[0]["rows"][number]> = {}) => ({
  expenseDate: "2026-09-08",
  dateText: "08 ก.ย. 2026",
  branchClose: false,
  ...patch,
});

test("a clean read says nothing", () => {
  assert.deepEqual(ocrReadNotes({ rows: [row(), row()], fileCount: 2, skippedPages: 0 }), []);
});

test("fewer rows than files is reported, because a receipt that read as nothing is missing money", () => {
  const notes = ocrReadNotes({ rows: [row(), row(), row()], fileCount: 5, skippedPages: 0 });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "count");
  assert.match(notes[0].text, /3/);
  assert.match(notes[0].text, /5/);
});

test("more rows than files is not a problem — one file often holds several receipts", () => {
  assert.deepEqual(ocrReadNotes({ rows: [row(), row(), row()], fileCount: 1, skippedPages: 0 }), []);
});

test("pages that were neither receipt nor slip are reported even when the count adds up", () => {
  const notes = ocrReadNotes({ rows: [row(), row()], fileCount: 2, skippedPages: 1 });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "skipped");
  assert.match(notes[0].text, /1/);
});

test("a printed date that reads as a different day is reported with both", () => {
  // ย read as ค: September became July, and nothing downstream can tell.
  const notes = ocrReadNotes({
    rows: [row(), row({ expenseDate: "2026-09-08", dateText: "08 ก.ค. 2026" })],
    fileCount: 2,
    skippedPages: 0,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "date");
  assert.equal(notes[0].row, 2);
  assert.match(notes[0].text, /ก\.ค\./);
});

test("a printed date that agrees is not reported", () => {
  assert.deepEqual(ocrReadNotes({ rows: [row()], fileCount: 1, skippedPages: 0 }), []);
});

test("a dateText nothing can parse is left alone rather than guessed at", () => {
  const notes = ocrReadNotes({
    rows: [row({ dateText: "ใบเสร็จรับเงิน" })],
    fileCount: 1,
    skippedPages: 0,
  });
  assert.deepEqual(notes, []);
});

test("no dateText at all — the Tesseract path — is not a disagreement", () => {
  assert.deepEqual(
    ocrReadNotes({ rows: [row({ dateText: null })], fileCount: 1, skippedPages: 0 }),
    [],
  );
});

test("a near-tie branch is reported by row", () => {
  const notes = ocrReadNotes({
    rows: [row(), row(), row({ branchClose: true })],
    fileCount: 3,
    skippedPages: 0,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "branch");
  assert.equal(notes[0].row, 3);
});

test("everything at once, counted first and then row by row", () => {
  const notes = ocrReadNotes({
    rows: [row({ branchClose: true }), row({ expenseDate: "2026-09-08", dateText: "08 ก.ค. 2026" })],
    fileCount: 4,
    skippedPages: 2,
  });
  assert.deepEqual(notes.map((n) => n.kind), ["count", "skipped", "branch", "date"]);
});

test("no rows and no files is not worth a dialog", () => {
  assert.deepEqual(ocrReadNotes({ rows: [], fileCount: 0, skippedPages: 0 }), []);
});
