"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, CircleAlert, Plus, Trash2 } from "lucide-react";
import { SingleDatePicker } from "@/features/accounting/components/SingleDatePicker";
import { ExpenseAccountPicker } from "./ExpenseAccountPicker";
import type { ExpenseAccount } from "@/lib/acc/reimburse/expense-account-service";
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
 * The AP-4.1 sheet's columns, in its order — see `COLUMNS`. One line per row,
 * one horizontal scrollbar for the whole table, and "ดูเต็มจอ" when the full
 * width is wanted at once.
 *
 * **Three of the money columns are derived and read-only.** `amount` is the
 * only total stored: ก่อน VAT is `amount - vatAmount` and จ่ายสุทธิ is
 * `amount - whtAmount`, so the row cannot be edited into a state where its own
 * figures disagree. The live total below comes from `sumReimburseItems`, the
 * same function the server totals with at submit — a second sum written here
 * is how the number on screen comes to differ from the number that gets paid.
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

const HEAD_CLASS = "text-[10.5px] font-semibold uppercase tracking-wide truncate";

/**
 * One line per expense row, scrolled sideways — the AP-4.1 sheet's own shape.
 *
 * It was three stacked lines for a while, on the reasoning that fourteen
 * columns cannot be read at once in a browser. In use that turned out to be
 * the wrong trade: a claim is checked by comparing rows against each other,
 * and stacked rows make two lines impossible to compare without scrolling
 * vertically past the fields in between. One line each, one horizontal
 * scrollbar for the whole table, and "ดูเต็มจอ" for when the whole width is
 * wanted at once.
 *
 * The header and every row share this template, which is what keeps the labels
 * over their fields; a width changed here moves both.
 */
const COLUMNS: readonly { label: string; width: string; right?: boolean }[] = [
  { label: "ลำดับ", width: "44px" },
  { label: "วันที่", width: "148px" },
  { label: "เลขที่เอกสาร", width: "130px" },
  { label: "รายการ", width: "190px" },
  { label: "รายละเอียด", width: "230px" },
  { label: "สาขา", width: "130px" },
  { label: "เลขผู้เสียภาษี", width: "140px" },
  { label: "ผู้ขาย", width: "180px" },
  { label: "ที่อยู่", width: "230px" },
  { label: "ก่อน VAT", width: "110px", right: true },
  { label: "VAT", width: "100px", right: true },
  { label: "ค่าใช้จ่ายรวม", width: "120px", right: true },
  { label: "หัก ณ ที่จ่าย", width: "110px", right: true },
  { label: "จ่ายสุทธิ", width: "120px", right: true },
];

/** The trailing column holds the expand and remove buttons, and has no heading. */
const ACTION_COLUMN_WIDTH = 76;
const COLUMN_GAP = 8;

/**
 * The row's own inset, applied to the header too so the labels sit over their
 * fields rather than 4px off, and — the part that actually broke — **counted
 * in `ROW_MIN_WIDTH`**.
 *
 * `box-sizing: border-box` puts padding and border inside the element's width,
 * so a min-width that omits them leaves the columns that much less room than
 * they asked for and the last one is pushed past the rounded edge. That is
 * exactly what it looked like: the remove button hanging outside the row.
 */
const ROW_PAD_X = 8;
const ROW_BORDER_X = 1;

const ROW_GRID = "grid gap-2";
const ROW_INSET = "px-2";

/**
 * Wide enough that no column is squeezed, so the scroller — rather than the
 * layout — absorbs a narrow window. Computed from `COLUMNS` instead of typed
 * out, because a hand-kept total drifts the moment a width changes and the
 * symptom is a subtly clipped last column nobody traces back to here.
 */
const ROW_MIN_WIDTH =
  COLUMNS.reduce((sum, c) => sum + parseInt(c.width, 10), 0) +
  ACTION_COLUMN_WIDTH +
  COLUMN_GAP * COLUMNS.length +
  (ROW_PAD_X + ROW_BORDER_X) * 2;

/** The panel under an expanded row. Narrower than the table on purpose — it is
 *  pinned to the left edge of the visible area, so it has to fit a normal window. */
const DETAIL_PANEL_WIDTH = 860;
const DETAIL_GRID = "grid grid-cols-[26px_minmax(0,1fr)_90px_110px_120px] gap-2 items-baseline";

const ROW_TEMPLATE = `${COLUMNS.map((c) => c.width).join(" ")} ${ACTION_COLUMN_WIDTH}px`;

/** Two decimals, without the float noise that makes 2675.0000000000005 reach a payout figure. */
function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
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


export function ReimburseItemGrid({
  items,
  onUpdate,
  onAdd,
  onRemove,
  problems,
  showProblems,
  documents,
  readNote,
  accounts,
  accountsLoading,
  brandChosen,
}: {
  items: ReimburseItem[];
  onUpdate: (index: number, patch: Partial<ReimburseItem>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** Row problems from `findItemRowProblems`, computed once by the form. */
  problems: ItemRowProblem[];
  /** Only paint a row red once a submit has actually been attempted. */
  showProblems: boolean;
  /**
   * The attachment strip, rendered at the top of this block.
   *
   * Passed in rather than built here: the files belong to the request, the form
   * owns them, and reading one is what creates the rows below. This component
   * only decides where it sits — first, because attaching is the first thing
   * the requester does.
   */
  documents: React.ReactNode;
  /** Why the last read produced nothing. Cleared by the form on the next attempt. */
  readNote: string | null;
  /** The G/L accounts this brand may book to — `รายการ`'s options. */
  accounts: ExpenseAccount[];
  accountsLoading?: boolean;
  /** False before a brand is picked; the list is keyed on brand and cannot load. */
  brandChosen: boolean;
}) {

  /**
   * Which rows have their document's lines showing.
   *
   * Keyed on position rather than on `item.id`, because the save replaces every
   * row wholesale and hands back new ids — keyed on those, every panel would
   * close itself on each save.
   */
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(() => new Set());
  const toggleRow = useCallback((key: string) => {
    setOpenRows((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // The total the server will store: the blank trailing row contributes
  // nothing, and `sumReimburseItems` is the same function it totals with.
  const total = sumReimburseItems(items.filter((it) => !isBlankItemRow(it)));

  const problemAt = (index: number, kind: ItemRowProblem["kind"]) =>
    showProblems && problems.some((p) => p.index === index && p.kind === kind);

  /**
   * The rows, kept in a variable so the render below reads as the sequence it
   * is — documents, rows, problems, total — rather than a hundred lines of
   * table wedged between two short blocks.
   */
  const rowsBlock = (
    <>
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

      {items.length > 0 && (
        // One scroller around the header *and* every row, so there is a single
        // scrollbar at the bottom and the columns stay lined up under their
        // labels. A scroller per row would give one bar each and let the rows
        // drift out of alignment with each other as they were scrolled.
        // `show-x-scroll` opts back in to a visible scrollbar. `.acc-theme`
        // hides every scrollbar on these pages, so `overflow-x-auto` alone
        // scrolls with no affordance at all — nothing on screen says the table
        // continues to the right. AP-3's expense grid opted back in the same
        // way; the class exists for exactly this.
        <div className="overflow-x-auto show-x-scroll pb-1">
          <div style={{ minWidth: ROW_MIN_WIDTH }} className="flex flex-col gap-2">
            {/* Same inset and the same template as a row, plus a transparent
                border so the header's columns line up with the bordered rows
                below rather than sitting 1px to the left of them. */}
            <div
              className={`${ROW_GRID} ${ROW_INSET} border border-transparent`}
              style={{ gridTemplateColumns: ROW_TEMPLATE }}
            >
              {COLUMNS.map((c) => (
                <span
                  key={c.label}
                  className={`${HEAD_CLASS} ${c.right ? "text-right" : ""}`}
                  style={{ color: "var(--text-muted)" }}
                >
                  {c.label}
                </span>
              ))}
              <span />
            </div>

            {items.map((item, index) => {
              const dateBad = problemAt(index, "date");
              const amountBad = problemAt(index, "amount");
              // Both derived from `amount`, which stays the one stored authority
              // for what the line costs — see `ReimburseItem.amount`.
              const beforeVat = round2((Number(item.amount) || 0) - (Number(item.vatAmount) || 0));
              const netPaid = round2((Number(item.amount) || 0) - (Number(item.whtAmount) || 0));
              // Keyed on position, not on `item.id`: the save replaces every
              // row wholesale, so an id is new after each one and an expanded
              // panel would close itself on every save.
              const rowKey = `row-${index}`;
              const lines = item.details ?? [];
              const lineCount = lines.length;
              const isOpen = lineCount > 0 && openRows.has(rowKey);
              return (
                <Fragment key={item.id ?? rowKey}>
                <div
                  className={`${ROW_GRID} ${ROW_INSET} border py-2 items-center`}
                  style={{
                    gridTemplateColumns: ROW_TEMPLATE,
                    borderColor: "var(--border-card)",
                    background: "var(--bg-card-alt)",
                    // Square off the join when the panel is under it, so the
                    // two read as one block rather than two stacked cards.
                    borderRadius: isOpen ? "12px 12px 0 0" : 12,
                    borderBottomWidth: isOpen ? 0 : 1,
                  }}
                >
                  <span
                    className="text-[13px] tabular-nums font-semibold text-center"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {index + 1}
                  </span>

                  <SingleDatePicker
                    value={item.expenseDate ?? ""}
                    onChange={(ymd) => onUpdate(index, { expenseDate: ymd || null })}
                    ariaLabel={`วันที่ของรายการที่ ${index + 1}`}
                    placeholder="เลือกวันที่..."
                    hasError={dateBad}
                  />

                  <TextCell
                    ariaLabel={`เลขที่เอกสารของรายการที่ ${index + 1}`}
                    placeholder="ABC1234"
                    value={item.documentNo}
                    maxLength={100}
                    onChange={(v) => onUpdate(index, { documentNo: v })}
                  />

                  <ExpenseAccountPicker
                    ariaLabel={`บัญชีของรายการที่ ${index + 1}`}
                    value={item.category}
                    onChange={(v) => onUpdate(index, { category: v })}
                    accounts={accounts}
                    loading={accountsLoading}
                    brandChosen={brandChosen}
                  />

                  <TextCell
                    ariaLabel={`รายละเอียดของรายการที่ ${index + 1}`}
                    placeholder="ค่าอะไร..."
                    value={item.description}
                    maxLength={500}
                    // "" not null: `Description` is NOT NULL in the database,
                    // and the other text columns are nullable.
                    onChange={(v) => onUpdate(index, { description: v ?? "" })}
                  />

                  <TextCell
                    ariaLabel={`สาขาของรายการที่ ${index + 1}`}
                    placeholder="—"
                    value={item.branchName}
                    maxLength={200}
                    onChange={(v) => onUpdate(index, { branchName: v })}
                  />

                  <TextCell
                    ariaLabel={`เลขประจำตัวผู้เสียภาษีของรายการที่ ${index + 1}`}
                    placeholder="0105547161674"
                    value={item.vendorTaxId}
                    maxLength={20}
                    onChange={(v) => onUpdate(index, { vendorTaxId: v })}
                  />

                  <TextCell
                    ariaLabel={`ชื่อผู้ขายของรายการที่ ${index + 1}`}
                    placeholder="ผู้ขาย"
                    value={item.vendorName}
                    maxLength={300}
                    onChange={(v) => onUpdate(index, { vendorName: v })}
                  />

                  <TextCell
                    ariaLabel={`ที่อยู่ผู้ขายของรายการที่ ${index + 1}`}
                    placeholder="—"
                    value={item.vendorAddress}
                    maxLength={500}
                    onChange={(v) => onUpdate(index, { vendorAddress: v })}
                  />

                  <MoneyCell
                    ariaLabel={`ค่าใช้จ่ายก่อน VAT ของรายการที่ ${index + 1}`}
                    value={beforeVat}
                    placeholder="0.00"
                    // Typing here sets the stored VAT-inclusive `amount`,
                    // keeping whatever VAT the row already holds. Editing
                    // either of these two moves the total; the total itself is
                    // read-only, so the three can never be made to disagree.
                    onChange={(next) =>
                      onUpdate(index, { amount: round2((next ?? 0) + (Number(item.vatAmount) || 0)) })
                    }
                  />

                  <MoneyCell
                    ariaLabel={`VAT ของรายการที่ ${index + 1}`}
                    value={item.vatAmount}
                    placeholder="—"
                    // null, not 0: VAT genuinely not specified is not VAT of
                    // zero. The total follows so ก่อน VAT stays put.
                    onChange={(next) =>
                      onUpdate(index, { vatAmount: next, amount: round2(beforeVat + (next ?? 0)) })
                    }
                  />

                  <ReadOnlyMoney value={item.amount} emphasis hasError={amountBad} />

                  <MoneyCell
                    ariaLabel={`หัก ณ ที่จ่าย ของรายการที่ ${index + 1}`}
                    value={item.whtAmount}
                    placeholder="—"
                    onChange={(next) => onUpdate(index, { whtAmount: next })}
                  />

                  <ReadOnlyMoney value={netPaid} />

                  <span className="flex items-center gap-1 justify-self-end">
                    {/* Only where there is something to open. A control that
                        does nothing on most rows teaches people to stop
                        pressing it on the rows where it works. */}
                    {lineCount > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleRow(rowKey)}
                        aria-expanded={isOpen}
                        aria-label={`${isOpen ? "ปิด" : "ดู"}รายการย่อยของรายการที่ ${index + 1}`}
                        title={`เอกสารนี้มี ${lineCount} รายการย่อย`}
                        className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none shrink-0"
                        style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                      >
                        {isOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(index)}
                      aria-label={`ลบรายการที่ ${index + 1}`}
                      title="ลบรายการนี้"
                      className="w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none shrink-0"
                      style={{ background: "var(--bg-card)", color: "var(--color-danger)" }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>

                {isOpen && (
                  <div
                    className={`${ROW_INSET} border rounded-b-xl pb-2.5`}
                    style={{
                      borderColor: "var(--border-card)",
                      background: "var(--bg-card-alt)",
                      borderTopWidth: 0,
                    }}
                  >
                    {/* Pinned to the left of whatever part of the table is on
                        screen. The row above is 2,156px wide, so a panel laid
                        out normally would start wherever the reader happens to
                        have scrolled to — often off-screen entirely. */}
                    <div className="sticky left-0" style={{ width: DETAIL_PANEL_WIDTH, maxWidth: "100%" }}>
                      <p
                        className="text-[11px] font-semibold uppercase tracking-wide m-0 pt-1 pb-1.5"
                        style={{ color: "var(--text-muted)" }}
                      >
                        รายการในเอกสาร · {lineCount} บรรทัด
                      </p>
                      <div className={`${DETAIL_GRID} pb-1`} style={{ color: "var(--text-muted)" }}>
                        <span className={HEAD_CLASS}>#</span>
                        <span className={HEAD_CLASS}>รายละเอียด</span>
                        <span className={`${HEAD_CLASS} text-right`}>จำนวน</span>
                        <span className={`${HEAD_CLASS} text-right`}>ราคา/หน่วย</span>
                        <span className={`${HEAD_CLASS} text-right`}>มูลค่า</span>
                      </div>
                      {lines.map((d, di) => (
                        <div
                          key={`${rowKey}-d-${di}`}
                          className={`${DETAIL_GRID} py-1.5`}
                          style={{ borderTop: "1px solid var(--border-light)" }}
                        >
                          <span className="text-[12px] tabular-nums" style={{ color: "var(--text-faint)" }}>
                            {di + 1}
                          </span>
                          <span className="text-[12.5px] break-words" style={{ color: "var(--text-primary)" }}>
                            {d.description}
                          </span>
                          <span className="text-[12.5px] tabular-nums text-right" style={{ color: "var(--text-secondary)" }}>
                            {d.quantity == null ? "—" : fmtBaht(d.quantity)}
                          </span>
                          <span className="text-[12.5px] tabular-nums text-right" style={{ color: "var(--text-secondary)" }}>
                            {d.unitPrice == null ? "—" : fmtBaht(d.unitPrice)}
                          </span>
                          <span className="text-[12.5px] tabular-nums text-right font-semibold" style={{ color: "var(--text-primary)" }}>
                            {d.amount == null ? "—" : fmtBaht(d.amount)}
                          </span>
                        </div>
                      ))}
                      <p className="text-[11px] m-0 pt-2" style={{ color: "var(--text-faint)" }}>
                        คัดลอกมาจากเอกสารเพื่อให้ตรวจได้ ไม่ได้นำมารวมเป็นยอด — ยอดของแถวคือ ค่าใช้จ่ายรวม ด้านบน
                      </p>
                    </div>
                  </div>
                )}
                </Fragment>
              );
            })}
          </div>
        </div>
      )}

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
    </>
  );

  return (
    <div className="flex flex-col gap-2 min-w-0">
      {documents}

      {rowsBlock}

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
        <span className="min-w-0">
          <span className="block text-[12.5px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
            ยอดรวมที่ขอเบิก
          </span>
          {/* Said out loud, because the figure below deliberately does **not**
              equal the ค่าใช้จ่ายรวม column summed — it is จ่ายสุทธิ summed.
              Without this line that reads as an arithmetic bug on the one
              number the whole form is about. */}
          <span className="block text-[11px] mt-0.5" style={{ color: "var(--nav-active-text)", opacity: 0.75 }}>
            รวมจาก &quot;จ่ายสุทธิ&quot; — หักภาษี ณ ที่จ่ายแล้ว
          </span>
        </span>
        <span className="text-[16px] font-bold tabular-nums shrink-0" style={{ color: "var(--nav-active-text)" }}>
          ฿{fmtBaht(total)}
        </span>
      </div>

    </div>
  );
}
