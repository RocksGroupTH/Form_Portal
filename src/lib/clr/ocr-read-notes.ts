import { thaiPrintedDate } from "@/lib/clr/ai-receipt-core";
import { sameRegisteredName, type RdAnswerState } from "@/lib/clr/rd-vat-core";
import { taxIdChecksumOk } from "@/lib/clr/seller-tax-id";

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
 *   branch   the seller's own branch, missing from a tax invoice that named
 *            the seller in every other respect. Thai law has the invoice print
 *            it, so a blank is the read missing it — not the head office. It is
 *            warned about rather than filled in: an empty value sends nothing
 *            and BC uses the vendor card's branch, which somebody maintains,
 *            while a guessed 00000 would overwrite that on a tax filing.
 *   rd       the Revenue Department disagreeing about the seller: a tax id it
 *            holds no registration for, or a registered name that is not the
 *            one on the row. The requester has no tax-id column, so the
 *            finding is the whole of what they get — and it is the part that
 *            matters, because a name the model invented and a number that
 *            belongs to nobody both read as perfectly good data.
 *
 * It reports and nothing more. Every row it mentions is already in the table
 * and editable, so dismissing the dialog loses nothing.
 */
export type OcrReadNote =
  | { kind: "count"; text: string }
  | { kind: "truncated"; text: string }
  | { kind: "skipped"; text: string }
  | { kind: "date"; row: number; text: string }
  | { kind: "branch"; row: number; text: string }
  | { kind: "rd-unregistered"; row: number; text: string }
  | { kind: "rd-name"; row: number; text: string }
  /** The number fails its own check digit — known misread, no network needed. */
  | { kind: "tax-id-invalid"; row: number; text: string }
  /** The name came from our vendor master rather than the registry. */
  | { kind: "vendor-name"; row: number; text: string }
  /** One note for all the rows whose branch was defaulted, not one each. */
  | { kind: "tax-branch"; rows: number[]; text: string };

/** What the registry said about one tax id, as far as this rule cares. */
export interface RdLookup {
  state: RdAnswerState;
  /** The registered name, title included, as `registrantFullName` writes it. */
  registeredName?: string | null;
}

function fmtDay(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : ymd;
}

export function ocrReadNotes(read: {
  rows: readonly {
    expenseDate: string;
    dateText?: string | null;
    branchClose?: boolean;
    taxId?: string | null;
    /** The name on the row now — the register's, once the read applied it. */
    payeeName?: string | null;
    /**
     * What the reader answered, kept when the register's name replaced it.
     *
     * Both are said in the note. The registered name is the one that will be
     * filed, but a tax id read off the wrong block of the invoice comes back
     * with a real registered name attached to it — our own company's, on the
     * bundle that started this — and the only thing that gives it away is the
     * two names sitting next to each other looking nothing alike.
     */
    payeeNameRead?: string | null;
    /** Where `payeeName` came from when it was not the reader: the Revenue
     *  Department's register, or our own vendor master. */
    payeeNameSource?: "rd" | "vendor";
    /** The seller's branch, five digits — 00000 is the head office. */
    taxBranchCode?: string | null;
    vatAmount?: number | null;
    /** True when nothing was read and 00000 was filled in for the head office. */
    taxBranchDefaulted?: boolean;
  }[];
  /** Files the requester attached for this read. */
  fileCount: number;
  skippedPages: number;
  /**
   * Pages the reader actually looked at, across those files.
   *
   * This is what the count is measured against. Files are the wrong unit: a
   * nine-page PDF that produced one row is one row from one file, which the
   * file rule reads as a clean read and says nothing about — the loudest
   * possible failure, silent. Pages are what the money is printed on.
   */
  pagesRead?: number;
  /** The reader stopped at its page cap; pages past it were never looked at. */
  truncated?: boolean;
  /** The registry's answers, keyed by the thirteen digits of the tax id. */
  rd?: Readonly<Record<string, RdLookup>>;
}): OcrReadNote[] {
  const notes: OcrReadNote[] = [];

  /* Every page has to end up somewhere: a row, or the skip count. What is
     neither was looked at and produced nothing, and that is a receipt whose
     money is missing from the clearing while the total looks settled.

     More rows than pages is fine — two invoices can share one page. */
  const pages = read.pagesRead ?? 0;
  if (pages > 0) {
    const accounted = read.rows.length + read.skippedPages;
    if (accounted < pages) {
      notes.push({
        kind: "count",
        text: `อ่าน ${pages} หน้า ได้ ${read.rows.length} รายการ · ข้าม ${read.skippedPages} หน้า`
          + ` — เหลืออีก ${pages - accounted} หน้าที่ไม่ได้กลายเป็นรายการ ตรวจว่ามีใบเสร็จตกหล่นหรือไม่`,
      });
    }
  } else if (read.fileCount > 0 && read.rows.length < read.fileCount) {
    /* No page count — an older reader, or the Tesseract fallback. Falls back to
       files, which is weaker but better than counting nothing. */
    notes.push({
      kind: "count",
      text: `อ่านได้ ${read.rows.length} รายการ จาก ${read.fileCount} ไฟล์ที่แนบ — ตรวจว่ามีใบเสร็จตกหล่นหรือไม่`,
    });
  }

  if (read.truncated) {
    notes.push({
      kind: "truncated",
      text: `ไฟล์ยาวเกินที่ระบบอ่านได้ (${pages} หน้า) — หน้าหลังจากนี้ยังไม่ได้อ่าน กรุณาแยกไฟล์แล้วแนบเพิ่ม`,
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

  /* Only an answer is a finding. `unknown` is the registry failing to answer —
     it is behind a SOAP service and a 15-second timeout, and saying "we could
     not check" to someone who cannot see the field and did not ask for the
     check teaches them to dismiss this dialog. The account officer's own
     ตรวจสรรพากร button asks again on a screen where the number is visible and
     editable, which is where an unanswered check belongs. */
  /* Before the registry is consulted at all. A number that fails its own check
     digit was misread, and saying "ไม่พบในระบบสรรพากร" about it sends the reader
     looking for a company that was never the question. */
  read.rows.forEach((r, i) => {
    const tin = (r.taxId ?? "").replace(/\D/g, "");
    if (tin.length !== 13 || taxIdChecksumOk(tin)) return;
    notes.push({
      kind: "tax-id-invalid",
      row: i + 1,
      text: `รายการที่ ${i + 1} — เลขผู้เสียภาษี ${tin} ไม่ถูกต้องตามหลักตรวจสอบ`
        + ` (AI น่าจะอ่านผิด) กรุณาตรวจกับเอกสาร`,
    });
  });

  /* A seller we already trade with, named from our own vendor master. It is
     the answer the registry would have given, without the registry: a SOAP
     service behind a fifteen-second timeout that is silent often enough for
     this to be the usual path rather than the fallback. */
  read.rows.forEach((r, i) => {
    if (r.payeeNameSource !== "vendor" || !r.payeeNameRead) return;
    if (sameRegisteredName(r.payeeNameRead, r.payeeName)) return;
    notes.push({
      kind: "vendor-name",
      row: i + 1,
      text: `รายการที่ ${i + 1} — ใช้ชื่อผู้ขายจากทะเบียนผู้ขายของบริษัท “${r.payeeName}”`
        + ` แทนที่อ่านได้ “${r.payeeNameRead}”`,
    });
  });

  read.rows.forEach((r, i) => {
    const tin = (r.taxId ?? "").replace(/\D/g, "");
    if (tin.length !== 13 || !taxIdChecksumOk(tin)) return;
    const answer = read.rd?.[tin];
    if (!answer) return;
    if (answer.state === "unregistered") {
      notes.push({
        kind: "rd-unregistered",
        row: i + 1,
        text: `รายการที่ ${i + 1} — ไม่พบเลขผู้เสียภาษี ${tin} ในระบบสรรพากร`,
      });
      return;
    }
    if (answer.state !== "found" || !answer.registeredName) return;
    /* Compare against what the READER said. Once the registered name has been
       written onto the row, r.payeeName agrees with the register by
       construction, and comparing that would silence the note on exactly the
       rows it now exists to report. */
    const asRead = r.payeeNameRead ?? r.payeeName;
    if (sameRegisteredName(asRead, answer.registeredName)) return;
    const applied = r.payeeNameRead != null
      && sameRegisteredName(r.payeeName, answer.registeredName);
    notes.push({
      kind: "rd-name",
      row: i + 1,
      text: applied
        ? `รายการที่ ${i + 1} — ใช้ชื่อจากสรรพากร “${answer.registeredName}”`
          + ` แทนที่อ่านได้ “${asRead}” — ตรวจว่าเป็นผู้ขายรายเดียวกัน`
        : `รายการที่ ${i + 1} — ชื่อผู้ขายไม่ตรงกับที่จดทะเบียน (สรรพากร: ${answer.registeredName})`,
    });
  });

  /* The rows that were given 00000 because nothing was read (user,
     2026-09-11). Filled rather than asked about — the head office is what
     nearly every invoice says — but said once, because it is still a value
     nobody read off the paper and it goes on a tax filing.

     One note for all of them: this used to be one per row, and five identical
     sentences is how a dialog teaches people to dismiss it. */
  const defaulted = read.rows
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => r.taxBranchDefaulted === true)
    .map(({ n }) => n);
  if (defaulted.length > 0) {
    notes.push({
      kind: "tax-branch",
      rows: defaulted,
      text: `รายการที่ ${defaulted.join(", ")} — ไม่พบสาขาผู้ขายบนใบกำกับ ระบบเติม 00000 (สำนักงานใหญ่) ให้`
        + ` กรุณาตรวจกับเอกสารถ้าเป็นสาขา`,
    });
  }

  return notes;
}
