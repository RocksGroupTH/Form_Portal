"use client";

import { useEffect, useRef, useState } from "react";
import { CircleAlert, Loader2, Plus, ScanLine, Trash2 } from "lucide-react";
import { SingleDatePicker } from "@/features/accounting/components/SingleDatePicker";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { sumReimburseItems } from "@/lib/acc/reimburse/calc";
import {
  amountNotPositiveMsg,
  dateMissingMsg,
  isBlankItemRow,
  rowLabel,
} from "@/lib/acc/reimburse/item-money";
import type { ReimburseItem } from "@/features/reimburse/types";

/**
 * รายการค่าใช้จ่ายจริง (spec §5.2 field 4) — the repeating expense grid.
 *
 * Columns: วันที่ · รายละเอียด · ยอดรวม VAT · VAT · หัก ณ ที่จ่าย, plus add and
 * remove. `vatAmount` and `whtAmount` are informational breakdowns of the
 * VAT-inclusive `amount`, never additions to it — which is why the live total
 * below the grid comes from `sumReimburseItems`, the same function the server
 * totals with at submit. A second sum written here is how the number on screen
 * comes to disagree with the number that gets paid.
 *
 * `isBlankItemRow` — again the server's own predicate, not a local copy —
 * decides which rows are real. The trailing empty row the grid always offers is
 * not a claim for nothing, and the row problems flagged below skip it.
 */

/* ─────────────────────────── money cell ─────────────────────────── */

/** Digits, a decimal point and a leading minus. Anything else never enters the field. */
function sanitizeMoneyText(raw: string): string {
  return raw.replace(/[^\d.-]/g, "");
}

/** A finite number, or null for blank / unparseable text. */
function parseMoneyText(raw: string): number | null {
  const t = raw.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * A money cell that shows what was typed rather than what `Number()` made of it.
 *
 * A plain controlled numeric input round-trips every keystroke through
 * `Number`, so "12.50" collapses to "12.5" as the last digit is typed and
 * "0.05" clears the box on its way through 0. Satang matter here — a VAT line
 * is routinely 7.35 — so the raw text is buffered locally and only parsed on
 * the way out.
 *
 * The buffer is dropped as soon as it stops agreeing with the value from above,
 * which is what makes a reload-after-save (fresh rows, fresh ids) replace the
 * text instead of shadowing it.
 */
function MoneyCell({
  value,
  onChange,
  placeholder,
  hasError,
  emphasis,
  ariaLabel,
}: {
  value: number | null | undefined;
  /** null when the field is cleared — the caller decides whether that means 0 or "not specified". */
  onChange: (next: number | null) => void;
  placeholder?: string;
  hasError?: boolean;
  emphasis?: boolean;
  ariaLabel: string;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    setText((prev) => {
      if (prev === null) return null;
      const parsed = parseMoneyText(prev);
      // Text that is on its way to being a number — "12..", a lone "-" — parses
      // to null, which the amount callback coerces to 0. Dropping the buffer on
      // that reading empties the field mid-keystroke and makes a leading minus
      // impossible to type. Hold it until it parses, or until blur clears it.
      if (parsed === null && prev.trim() !== "") return prev;
      return parsed === (value ?? null) ? prev : null;
    });
  }, [value]);

  const shown = text ?? (value === null || value === undefined || value === 0 ? "" : String(value));

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      placeholder={placeholder}
      value={shown}
      onChange={(e) => {
        const cleaned = sanitizeMoneyText(e.target.value);
        setText(cleaned);
        onChange(parseMoneyText(cleaned));
      }}
      onBlur={() => setText(null)}
      className={`w-full rounded-lg px-3 py-2 text-[14px] outline-none tabular-nums text-right ${emphasis ? "font-bold" : ""}`}
      style={{
        background: "var(--bg-input)",
        color: "var(--text-primary)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: hasError ? "var(--color-danger)" : "var(--border-input)",
        boxShadow: hasError ? "0 0 0 1px var(--color-danger)" : undefined,
      }}
    />
  );
}

/* ─────────────────────────── row problems ─────────────────────────── */

export interface ItemRowProblem {
  /** Index into the grid's own array — the row the user is looking at. */
  index: number;
  kind: "date" | "amount";
  label: string;
}

/**
 * The two things the server refuses a filled row for, checked here only so the
 * message arrives before the round trip.
 *
 * Deliberately **not** `validateItemMoney`: that function is exported for
 * re-checking rows already loaded from the database and carries a weaker
 * contract than anything typed by hand deserves. The gate for user input is the
 * server's `prepareReimburseItemsForSave`, which throws its own named Thai
 * messages; these are the friendly preview of the same two rules.
 *
 * Rows are **numbered as the server numbers them** — by position among the rows
 * that survive the blank filter, through `item-money`'s own `rowLabel` — and the
 * two messages are that module's own. They used to be hand-copied here and
 * counted every grid row instead, so a blank row above a filled one made the
 * preview say "แถวที่ 3" where the save came back saying "แถวที่ 2" about the
 * same row. `index` stays the **grid** position, because that is what the caller
 * highlights.
 */
export function findItemRowProblems(items: ReimburseItem[]): ItemRowProblem[] {
  const problems: ItemRowProblem[] = [];
  const keptCount = items.filter((it) => !isBlankItemRow(it)).length;
  let kept = 0;
  items.forEach((it, index) => {
    if (isBlankItemRow(it)) return;
    const label = rowLabel(kept, keptCount);
    kept++;
    if (!it.expenseDate || it.expenseDate.trim() === "") {
      problems.push({ index, kind: "date", label: dateMissingMsg(label) });
    }
    const amount = Number(it.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      problems.push({ index, kind: "amount", label: amountNotPositiveMsg(label) });
    }
  });
  return problems;
}

/* ─────────────────────────── the grid ─────────────────────────── */

const LABEL_CLASS = "block text-[10.5px] font-semibold uppercase tracking-wide mb-1";

/**
 * Two lines per row, not eleven columns across.
 *
 * The AP-4.1 sheet has eleven columns, which is fine on a spreadsheet and
 * unusable as one grid row in a browser — either every field is too narrow to
 * read or the page scrolls sideways while somebody is typing into it. Splitting
 * on the sheet's own seam keeps each field a usable width: **which document
 * this is**, then **what it cost**. Below `md` both collapse to one column, as
 * the single-line grid already did.
 */
const IDENT_GRID =
  "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-[56px_150px_130px_110px_minmax(0,1fr)_150px] gap-2";
const MONEY_GRID =
  "grid grid-cols-2 md:grid-cols-[repeat(5,minmax(0,1fr))_86px] gap-2";

/** Two decimals, without the float noise that makes 2675.0000000000005 reach a payout figure. */
function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/** A labelled cell. The label shows at every width — with eleven fields, unlabelled columns are unreadable. */
function Field({
  label,
  align,
  children,
}: {
  label: string;
  align?: "right";
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <span
        className={`${LABEL_CLASS} ${align === "right" ? "text-right" : ""}`}
        style={{ color: "var(--text-muted)" }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

/** A plain text cell. Blank becomes null, matching what `prepareReimburseItemsForSave` stores. */
function TextCell({
  value,
  onChange,
  placeholder,
  ariaLabel,
  maxLength,
}: {
  value: string | null | undefined;
  onChange: (next: string | null) => void;
  placeholder?: string;
  ariaLabel: string;
  /** The column's own width, so the server never has to truncate. */
  maxLength: number;
}) {
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      placeholder={placeholder}
      maxLength={maxLength}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      className="w-full rounded-lg px-3 py-2 text-[14px] outline-none"
      style={{
        background: "var(--bg-input)",
        color: "var(--text-primary)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: "var(--border-input)",
      }}
    />
  );
}

/**
 * A derived money figure, shown and not editable.
 *
 * ค่าใช้จ่ายรวม and จำนวนจ่ายสุทธิ are computed from the three stored columns.
 * Making them editable would give the row five money fields that must agree,
 * and no way to say which one is right when they do not.
 */
function ReadOnlyMoney({
  value,
  emphasis,
  hasError,
}: {
  value: number | null | undefined;
  emphasis?: boolean;
  hasError?: boolean;
}) {
  const n = Number(value) || 0;
  return (
    <div
      className={`w-full rounded-lg px-3 py-2 text-[14px] tabular-nums text-right ${emphasis ? "font-bold" : ""}`}
      style={{
        background: "var(--bg-card)",
        color: n === 0 ? "var(--text-faint)" : "var(--text-primary)",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: hasError ? "var(--color-danger)" : "var(--border-card)",
        boxShadow: hasError ? "0 0 0 1px var(--color-danger)" : undefined,
      }}
    >
      {n === 0 ? "0.00" : fmtBaht(n)}
    </div>
  );
}

/**
 * The per-row "read a receipt" control.
 *
 * Its own file input rather than one shared input plus a "which row?"
 * variable: a shared input has to be re-pointed before every click, and
 * picking the same file twice in a row fires no `change` event at all unless
 * the value is cleared in between. One input per row removes both.
 */
function RowReceiptButton({
  index,
  busy,
  disabled,
  onPick,
}: {
  index: number;
  busy: boolean;
  /** Another row is mid-read. The call is billed, so one at a time for the whole grid. */
  disabled: boolean;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onPick(file);
          // Cleared so re-picking the same file still fires `change`.
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => inputRef.current?.click()}
        aria-label={`อ่านใบเสร็จสำหรับรายการที่ ${index + 1}`}
        title={busy ? "กำลังอ่านใบเสร็จ..." : "แนบใบเสร็จเพื่ออ่านข้อมูลมาเติมให้"}
        className="w-9 h-9 rounded-lg flex items-center justify-center border-none shrink-0 disabled:opacity-60"
        style={{
          background: "var(--nav-active-bg)",
          color: "var(--nav-active-text)",
          cursor: busy || disabled ? "not-allowed" : "pointer",
        }}
      >
        {busy ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
      </button>
    </>
  );
}

export function ReimburseItemGrid({
  items,
  onUpdate,
  onAdd,
  onRemove,
  problems,
  showProblems,
  onReadReceipt,
  readingIndex,
  readNote,
}: {
  items: ReimburseItem[];
  onUpdate: (index: number, patch: Partial<ReimburseItem>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** Row problems from `findItemRowProblems`, computed once by the form. */
  problems: ItemRowProblem[];
  /** Only paint a row red once a submit has actually been attempted. */
  showProblems: boolean;
  /** Read this image into row `index`, and keep it as a หลักฐาน attachment. */
  onReadReceipt: (index: number, file: File) => void;
  /** Which row is mid-read, or null. Owned by the form, which owns the file list. */
  readingIndex: number | null;
  /** Why the last read produced nothing. Cleared by the form on the next attempt. */
  readNote: string | null;
}) {
  // The total the server will store: the blank trailing row contributes
  // nothing, and `sumReimburseItems` is the same function it totals with.
  const total = sumReimburseItems(items.filter((it) => !isBlankItemRow(it)));

  const problemAt = (index: number, kind: ItemRowProblem["kind"]) =>
    showProblems && problems.some((p) => p.index === index && p.kind === kind);

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {readNote && (
        <p
          className="text-[12px] m-0 px-1 flex items-start gap-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          <CircleAlert size={13} className="shrink-0 mt-0.5" />
          {readNote}
        </p>
      )}

      {items.length === 0 && (
        <p className="text-[13px] text-center py-4 m-0" style={{ color: "var(--text-faint)" }}>
          ยังไม่มีรายการ — กด &quot;เพิ่มรายการ&quot; เพื่อเริ่มกรอก
        </p>
      )}

      {items.map((item, index) => {
        const dateBad = problemAt(index, "date");
        const amountBad = problemAt(index, "amount");
        // Both derived from `amount`, which stays the one stored authority for
        // what the line costs — see `ReimburseItem.amount`.
        const beforeVat = round2((Number(item.amount) || 0) - (Number(item.vatAmount) || 0));
        const netPaid = round2((Number(item.amount) || 0) - (Number(item.whtAmount) || 0));
        return (
          <div
            key={item.id ?? `row-${index}`}
            className="rounded-xl border p-3 flex flex-col gap-2.5 min-w-0"
            style={{ borderColor: "var(--border-card)", background: "var(--bg-card-alt)" }}
          >
            {/* ── line 1 · which document this is ── */}
            <div className={IDENT_GRID}>
              <Field label="ลำดับที่">
                <span
                  className="flex items-center h-[38px] px-3 text-[14px] tabular-nums font-semibold"
                  style={{ color: "var(--text-muted)" }}
                >
                  {index + 1}
                </span>
              </Field>

              <Field label="วันที่">
                <SingleDatePicker
                  value={item.expenseDate ?? ""}
                  onChange={(ymd) => onUpdate(index, { expenseDate: ymd || null })}
                  ariaLabel={`วันที่ของรายการที่ ${index + 1}`}
                  placeholder="เลือกวันที่..."
                  hasError={dateBad}
                />
              </Field>

              <Field label="เลขที่เอกสาร">
                <TextCell
                  ariaLabel={`เลขที่เอกสารของรายการที่ ${index + 1}`}
                  placeholder="ABC1234"
                  value={item.documentNo}
                  maxLength={100}
                  onChange={(v) => onUpdate(index, { documentNo: v })}
                />
              </Field>

              <Field label="รายการ">
                <TextCell
                  ariaLabel={`รายการของรายการที่ ${index + 1}`}
                  placeholder="AP-4.2"
                  value={item.category}
                  maxLength={50}
                  onChange={(v) => onUpdate(index, { category: v })}
                />
              </Field>

              <Field label="รายละเอียด">
                <TextCell
                  ariaLabel={`รายละเอียดของรายการที่ ${index + 1}`}
                  placeholder="ค่าอะไร / ร้านไหน..."
                  value={item.description}
                  maxLength={500}
                  // "" not null: `Description` is NOT NULL in the database, and
                  // the other two are nullable.
                  onChange={(v) => onUpdate(index, { description: v ?? "" })}
                />
              </Field>

              <Field label="สาขา">
                <TextCell
                  ariaLabel={`สาขาของรายการที่ ${index + 1}`}
                  placeholder="—"
                  value={item.branchName}
                  maxLength={200}
                  onChange={(v) => onUpdate(index, { branchName: v })}
                />
              </Field>
            </div>

            {/* ── line 2 · what it cost ── */}
            <div className={MONEY_GRID}>
              <Field label="ก่อน VAT" align="right">
                <MoneyCell
                  ariaLabel={`ค่าใช้จ่ายก่อน VAT ของรายการที่ ${index + 1}`}
                  value={beforeVat}
                  placeholder="0.00"
                  // Typing here sets the stored VAT-inclusive `amount`, keeping
                  // whatever VAT the row already holds. Editing either of these
                  // two moves the total; the total itself is read-only, so the
                  // three can never be made to disagree.
                  onChange={(next) =>
                    onUpdate(index, { amount: round2((next ?? 0) + (Number(item.vatAmount) || 0)) })
                  }
                />
              </Field>

              <Field label="VAT" align="right">
                <MoneyCell
                  ariaLabel={`VAT ของรายการที่ ${index + 1}`}
                  value={item.vatAmount}
                  placeholder="—"
                  // null, not 0: VAT genuinely not specified is not VAT of zero.
                  // The total follows so ก่อน VAT stays where the requester put it.
                  onChange={(next) =>
                    onUpdate(index, { vatAmount: next, amount: round2(beforeVat + (next ?? 0)) })
                  }
                />
              </Field>

              <Field label="ค่าใช้จ่ายรวม" align="right">
                <ReadOnlyMoney value={item.amount} emphasis hasError={amountBad} />
              </Field>

              <Field label="หัก ณ ที่จ่าย" align="right">
                <MoneyCell
                  ariaLabel={`หัก ณ ที่จ่าย ของรายการที่ ${index + 1}`}
                  value={item.whtAmount}
                  placeholder="—"
                  onChange={(next) => onUpdate(index, { whtAmount: next })}
                />
              </Field>

              <Field label="จ่ายสุทธิ" align="right">
                <ReadOnlyMoney value={netPaid} />
              </Field>

              <div className="flex justify-end gap-1.5 md:self-end md:pb-0.5">
                <RowReceiptButton
                  index={index}
                  busy={readingIndex === index}
                  disabled={readingIndex !== null && readingIndex !== index}
                  onPick={(file) => onReadReceipt(index, file)}
                />
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  aria-label={`ลบรายการที่ ${index + 1}`}
                  title="ลบรายการนี้"
                  className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer border-none shrink-0"
                  style={{ background: "var(--bg-card)", color: "var(--color-danger)" }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-colors acc-add-row"
        style={{
          border: "1px dashed var(--border-card)",
          background: "transparent",
          color: "var(--text-muted)",
        }}
      >
        <Plus size={13} /> เพิ่มรายการ
      </button>

      {showProblems && problems.length > 0 && (
        <ul className="m-0 pl-4 flex flex-col gap-1">
          {problems.map((p, i) => (
            <li
              key={`${p.index}-${p.kind}-${i}`}
              className="text-[12px] flex items-start gap-1.5"
              style={{ color: "var(--color-danger)" }}
            >
              <CircleAlert size={13} className="shrink-0 mt-0.5" />
              {p.label}
            </li>
          ))}
        </ul>
      )}

      {/* Live total — the figure the server will store, from its own function. */}
      <div
        className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 mt-1"
        style={{ background: "var(--nav-active-bg)" }}
      >
        <span className="text-[12.5px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
          ยอดรวมที่ขอเบิก
        </span>
        <span className="text-[16px] font-bold tabular-nums" style={{ color: "var(--nav-active-text)" }}>
          ฿{fmtBaht(total)}
        </span>
      </div>
    </div>
  );
}
