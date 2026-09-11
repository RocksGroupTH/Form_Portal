import { thaiPrintedDate } from "@/lib/clr/ai-receipt-core";

/**
 * What to tell the requester after the AI has read their receipts.
 *
 * The rows now go straight into the expense table, so there is no confirm
 * screen left to carry the things the read was unsure about. Only three of
 * them are worth a dialog, and all three share a property: nothing downstream
 * can catch them.
 *
 *   count    a file that produced no row is a receipt whose money is simply
 *            missing from the clearing, and the total will look settled.
 *   skipped  a page the model called neither receipt nor slip. Counted, never
 *            listed — on an internal form the model invents descriptions that
 *            appear nowhere in the document, so junk rows are worse than none.
 *   date     the model misreading the characters themselves. A slip printed
 *            "08 ก.ย. 2026" came back as "08 ก.ค. 2026"; date validation is
 *            "not empty", and the value becomes a G/L posting date.
 *   branch   the model saw two branches that fit nearly as well. The one it
 *            picked is real and correctly formatted, so no rule can object —
 *            it just decides the BU and the BRANCH dimension.
 *
 * It reports and nothing more. Every row it mentions is already in the table
 * and editable, so dismissing the dialog loses nothing.
 */
export type OcrReadNote =
  | { kind: "count"; text: string }
  | { kind: "skipped"; text: string }
  | { kind: "date"; row: number; text: string }
  | { kind: "branch"; row: number; text: string };

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

export function ocrReadNotes(read: {
  rows: readonly { expenseDate: string; dateText?: string | null; branchClose?: boolean }[];
  /** Files the requester attached for this read. */
  fileCount: number;
  skippedPages: number;
}): OcrReadNote[] {
  const notes: OcrReadNote[] = [];

  /* Fewer rows than files, never the other way: one PDF routinely holds
     several receipts, and more rows than files is the reader working. */
  if (read.fileCount > 0 && read.rows.length < read.fileCount) {
    notes.push({
      kind: "count",
      text: `อ่านได้ ${read.rows.length} รายการ จาก ${read.fileCount} ไฟล์ที่แนบ — ตรวจว่ามีใบเสร็จตกหล่นหรือไม่`,
    });
  }

  if (read.skippedPages > 0) {
    notes.push({
      kind: "skipped",
      text: `ข้าม ${read.skippedPages} หน้า (ไม่ใช่ใบเสร็จหรือสลิป)`,
    });
  }

  read.rows.forEach((r, i) => {
    if (r.branchClose) {
      notes.push({
        kind: "branch",
        row: i + 1,
        text: `รายการที่ ${i + 1} — สาขาที่เลือกอาจไม่ใช่สาขานี้ มีสาขาชื่อคล้ายกัน`,
      });
    }
  });

  read.rows.forEach((r, i) => {
    /* Compared through the same table lookup that produced the stored date, so
       a `dateText` the parser cannot read says nothing rather than guessing. */
    const printed = thaiPrintedDate(r.dateText);
    if (!printed || !r.expenseDate || printed === r.expenseDate) return;
    notes.push({
      kind: "date",
      row: i + 1,
      text: `รายการที่ ${i + 1} — วันที่บนเอกสารอ่านว่า “${r.dateText}” แต่บันทึกเป็น ${fmtDay(r.expenseDate)}`,
    });
  });

  return notes;
}
