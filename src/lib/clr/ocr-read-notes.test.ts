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

/* The Revenue Department check, back on the requester's page (user,
   2026-09-11). It ran inside the confirm screen and went with it; the seller's
   tax id is not a column the requester has, so the finding is all they get —
   and it is the part that matters, because a name the model invented and a
   number that belongs to nobody both look like perfectly good data. */

const rdRow = (patch: Partial<Parameters<typeof ocrReadNotes>[0]["rows"][number]> = {}) =>
  row({ taxId: "0105560171921", payeeName: "บริษัท เจเนซิส ซัพพลาย เชน จำกัด", ...patch });

const found = (name: string) => ({ state: "found" as const, registeredName: name });

test("a seller the register confirms, spelled the same, says nothing", () => {
  assert.deepEqual(
    ocrReadNotes({
      rows: [rdRow()],
      fileCount: 1,
      skippedPages: 0,
      rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
    }),
    [],
  );
});

test("spacing is not a difference — the register and the invoice space names differently", () => {
  assert.deepEqual(
    ocrReadNotes({
      rows: [rdRow({ payeeName: "บริษัทเจเนซิสซัพพลายเชนจำกัด" })],
      fileCount: 1,
      skippedPages: 0,
      rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
    }),
    [],
  );
});

test("a name that is not the registered one is reported, with the registered one", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ payeeName: "ร้านค้าทั่วไป" })],
    fileCount: 1,
    skippedPages: 0,
    rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "rd-name");
  assert.equal(notes[0].row, 1);
  assert.match(notes[0].text, /บริษัท เจเนซิส ซัพพลาย เชน จำกัด/);
});

test("a tax id the register holds nothing for is reported with the number", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ taxId: "0105560999996" })],
    fileCount: 1,
    skippedPages: 0,
    rd: { "0105560999996": { state: "unregistered" } },
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "rd-unregistered");
  assert.match(notes[0].text, /0105560999996/);
});

test("the registry not answering is silent — it is a failed check, not a finding", () => {
  assert.deepEqual(
    ocrReadNotes({
      rows: [rdRow()],
      fileCount: 1,
      skippedPages: 0,
      rd: { "0105560171921": { state: "unknown" } },
    }),
    [],
  );
});

test("no rd answers at all is silent, the same way", () => {
  assert.deepEqual(ocrReadNotes({ rows: [rdRow()], fileCount: 1, skippedPages: 0 }), []);
});

test("a row with no tax id read is not an rd finding", () => {
  assert.deepEqual(
    ocrReadNotes({ rows: [rdRow({ taxId: "" })], fileCount: 1, skippedPages: 0, rd: {} }),
    [],
  );
});

test("a found registrant whose name the register does not hold is not a mismatch", () => {
  assert.deepEqual(
    ocrReadNotes({
      rows: [rdRow()],
      fileCount: 1,
      skippedPages: 0,
      rd: { "0105560171921": { state: "found", registeredName: null } },
    }),
    [],
  );
});

test("one seller on three receipts is answered once and reported on each row", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ payeeName: "ร้านค้า" }), rdRow({ payeeName: "ร้านค้า" }), rdRow()],
    fileCount: 3,
    skippedPages: 0,
    rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
  });
  assert.deepEqual(
    notes.map((n) => [n.kind, "row" in n ? n.row : null]),
    [["rd-name", 1], ["rd-name", 2]],
  );
});

test("the tax id is matched by its digits, however the reader punctuated it", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ taxId: "0-1055-60171-92-1", payeeName: "ร้านค้า" })],
    fileCount: 1,
    skippedPages: 0,
    rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "rd-name");
});

test("rd findings come after the counts and the row notes they share a dialog with", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ branchClose: true, taxId: "0105560999996" })],
    fileCount: 3,
    skippedPages: 1,
    rd: { "0105560999996": { state: "unregistered" } },
  });
  assert.deepEqual(notes.map((n) => n.kind), ["count", "skipped", "branch", "rd-unregistered"]);
});

/* The seller's branch, when the reader got everything about the seller except
   that (user, 2026-09-11). A Thai tax invoice prints it by law, so a blank one
   means the read missed it — not that it is the head office. Warned rather than
   guessed: sending nothing leaves BC to use the vendor card's branch, which
   somebody maintains, and filling in 00000 would overwrite that with an
   assumption on a tax filing. */

const brRow = (patch: Partial<Parameters<typeof ocrReadNotes>[0]["rows"][number]> = {}) =>
  row({
    taxId: "0105560171921",
    payeeName: "บริษัท เจเนซิส ซัพพลาย เชน จำกัด",
    taxBranchCode: "",
    vatAmount: 121.62,
    ...patch,
  });

test("an empty branch alone is no longer a finding — it is filled and flagged instead", () => {
  assert.deepEqual(ocrReadNotes({ rows: [row(), brRow()], fileCount: 2, skippedPages: 0 }), []);
});

test("the row that was filled is the one reported, by its number", () => {
  const notes = ocrReadNotes({
    rows: [row(), brRow({ taxBranchCode: "00000", taxBranchDefaulted: true })],
    fileCount: 2, skippedPages: 0,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "tax-branch");
  assert.deepEqual(notes[0].rows, [2]);
  assert.match(notes[0].text, /00000/);
});

test("a branch that was read says nothing", () => {
  assert.deepEqual(
    ocrReadNotes({ rows: [brRow({ taxBranchCode: "00000" })], fileCount: 1, skippedPages: 0 }),
    [],
  );
});

test("a real branch number says nothing either", () => {
  assert.deepEqual(
    ocrReadNotes({ rows: [brRow({ taxBranchCode: "00001" })], fileCount: 1, skippedPages: 0 }),
    [],
  );
});

test("no VAT means no tax invoice, so no branch to have missed", () => {
  assert.deepEqual(ocrReadNotes({ rows: [brRow({ vatAmount: 0 })], fileCount: 1, skippedPages: 0 }), []);
});

test("a seller the reader could not identify is a different problem, not this one", () => {
  assert.deepEqual(ocrReadNotes({ rows: [brRow({ taxId: "" })], fileCount: 1, skippedPages: 0 }), []);
  assert.deepEqual(ocrReadNotes({ rows: [brRow({ payeeName: "" })], fileCount: 1, skippedPages: 0 }), []);
});

test("a half-read tax id does not count as having identified the seller", () => {
  assert.deepEqual(ocrReadNotes({ rows: [brRow({ taxId: "010556017" })], fileCount: 1, skippedPages: 0 }), []);
});

test("the branch note comes after the registry's findings about the same seller", () => {
  const notes = ocrReadNotes({
    rows: [brRow({ payeeName: "ร้านค้าทั่วไป", taxBranchCode: "00000", taxBranchDefaulted: true })],
    fileCount: 1,
    skippedPages: 0,
    rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
  });
  assert.deepEqual(notes.map((n) => n.kind), ["rd-name", "tax-branch"]);
});

/* Counting by pages rather than by files, and the summary that says what the
   read actually covered (user, 2026-09-11). A nine-page PDF that produced one
   row said nothing at all: the old rule compared rows against the number of
   files, and one row out of one file reads as a clean read. */

test("pages that became neither a row nor a skip are reported", () => {
  const notes = ocrReadNotes({ rows: [row()], fileCount: 1, skippedPages: 0, pagesRead: 9 });
  const count = notes.find((n) => n.kind === "count");
  assert.ok(count, "expected a count note");
  assert.match(count.text, /9/);
  assert.match(count.text, /1/);
});

test("every page accounted for raises no count note — the skips are their own note", () => {
  const notes = ocrReadNotes({ rows: [row(), row(), row()], fileCount: 1, skippedPages: 6, pagesRead: 9 });
  assert.deepEqual(notes.map((n) => n.kind), ["skipped"]);
});

test("more rows than pages is not a problem — two invoices can share a page", () => {
  assert.deepEqual(
    ocrReadNotes({ rows: [row(), row(), row()], fileCount: 1, skippedPages: 0, pagesRead: 2 }),
    [],
  );
});

test("without a page count it still falls back to counting files", () => {
  const notes = ocrReadNotes({ rows: [row()], fileCount: 4, skippedPages: 0 });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "count");
});

test("a truncated PDF is called out — pages past the cap were never read", () => {
  const notes = ocrReadNotes({
    rows: [row(), row()], fileCount: 1, skippedPages: 0, pagesRead: 15, truncated: true,
  });
  assert.ok(notes.some((n) => n.kind === "truncated"));
});

/* The seller's branch: filled rather than asked about (user, 2026-09-11). */

test("rows whose branch was defaulted are named once, together", () => {
  const notes = ocrReadNotes({
    rows: [
      row({ taxId: "0105560171921", payeeName: "บ.", vatAmount: 7, taxBranchCode: "00000", taxBranchDefaulted: true }),
      row({ taxId: "0105560171921", payeeName: "บ.", vatAmount: 7, taxBranchCode: "00000", taxBranchDefaulted: true }),
      row({ taxId: "0105560171921", payeeName: "บ.", vatAmount: 7, taxBranchCode: "00001" }),
    ],
    fileCount: 1, skippedPages: 0, pagesRead: 3,
  });
  const b = notes.filter((n) => n.kind === "tax-branch");
  assert.equal(b.length, 1, "one note, not one per row");
  assert.match(b[0].text, /1, 2/);
  assert.match(b[0].text, /00000/);
});

test("a branch the reader actually found is not called defaulted", () => {
  assert.deepEqual(
    ocrReadNotes({
      rows: [row({ taxId: "0105560171921", payeeName: "บ.", vatAmount: 7, taxBranchCode: "00000" })],
      fileCount: 1, skippedPages: 0, pagesRead: 1,
    }),
    [],
  );
});

/* The register is the authority on who a tax id belongs to, so the read now
   writes its name onto the row instead of leaving a mismatch for someone to
   reconcile by hand (user, 2026-09-12). The note stops being a complaint and
   becomes a receipt for an edit the form already made — and it quotes BOTH
   names, because a registered name that arrives looking nothing like the one
   on the paper is how a misread tax id shows itself. */

test("a name replaced by the register's is reported as an edit, not a mismatch", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({
      payeeName: "บริษัท เจเนซิส ซัพพลาย เชน จำกัด",
      payeeNameRead: "บริษัท เจนีซิส ซัพพลาย เชน จำกัด",
    })],
    fileCount: 1, skippedPages: 0,
    rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "rd-name");
  assert.match(notes[0].text, /สรรพากร/);
  assert.match(notes[0].text, /บริษัท เจเนซิส ซัพพลาย เชน จำกัด/, "the name now on the row");
  assert.match(notes[0].text, /บริษัท เจนีซิส ซัพพลาย เชน จำกัด/, "and the one the reader gave");
});

test("a reader that already agreed with the register says nothing", () => {
  assert.deepEqual(
    ocrReadNotes({
      rows: [rdRow({
        payeeName: "บริษัท เจเนซิส ซัพพลาย เชน จำกัด",
        payeeNameRead: "บริษัท เจเนซิส ซัพพลาย เชน จำกัด",
      })],
      fileCount: 1, skippedPages: 0,
      rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
    }),
    [],
  );
});

test("without the applied name it is still reported the old way", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ payeeName: "ร้านค้าทั่วไป" })],
    fileCount: 1, skippedPages: 0,
    rd: { "0105560171921": found("บริษัท เจเนซิส ซัพพลาย เชน จำกัด") },
  });
  assert.equal(notes.length, 1);
  assert.match(notes[0].text, /ไม่ตรงกับที่จดทะเบียน/);
});

/* The check digit, said before the registry is asked (user, 2026-09-12). It is
   the finding that needs no network and cannot be wrong: a number that fails it
   was misread, whatever the registry would have said. */

test("a tax id that fails its own check digit is reported as a misread", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ taxId: "0105564122694", payeeName: "บริษัท พีพี แสตมป์ จำกัด" })],
    fileCount: 1, skippedPages: 0,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "tax-id-invalid");
  assert.equal(notes[0].row, 1);
  assert.match(notes[0].text, /0105564122694/);
});

test("a tax id that passes says nothing about its digits", () => {
  assert.deepEqual(
    ocrReadNotes({ rows: [rdRow({ taxId: "0105564122649" })], fileCount: 1, skippedPages: 0 }),
    [],
  );
});

test("a number known wrong is not also reported as unregistered", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({ taxId: "0105564122694" })],
    fileCount: 1, skippedPages: 0,
    rd: { "0105564122694": { state: "unregistered" } },
  });
  assert.deepEqual(notes.map((n) => n.kind), ["tax-id-invalid"]);
});

/* Our own vendor master answers instantly and does not time out, so a seller we
   already trade with gets its registered name from there when the registry is
   silent. */
test("a vendor we know supplies the name the registry did not", () => {
  const notes = ocrReadNotes({
    rows: [rdRow({
      payeeName: "บริษัท พีพี แสตมป์ จำกัด",
      payeeNameRead: "บริษัท พีพี สแตมป จำกัด",
      payeeNameSource: "vendor",
    })],
    fileCount: 1, skippedPages: 0,
  });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].kind, "vendor-name");
  assert.match(notes[0].text, /บริษัท พีพี แสตมป์ จำกัด/);
  assert.match(notes[0].text, /บริษัท พีพี สแตมป จำกัด/);
});
