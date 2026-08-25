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

const HEAD_CLASS = "text-[11px] font-semibold uppercase tracking-wide";
const MOBILE_LABEL_CLASS = "md:hidden text-[11px] font-semibold uppercase tracking-wide mb-1";
const ROW_GRID =
  "grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)_130px_120px_130px_78px] gap-2 md:items-center";

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
      {/* Column headings — desktop only; each field carries its own label below md. */}
      <div
        className={`${ROW_GRID} hidden md:grid px-1`}
        style={{ color: "var(--text-muted)" }}
      >
        <span className={HEAD_CLASS}>วันที่</span>
        <span className={HEAD_CLASS}>รายละเอียด</span>
        <span className={`${HEAD_CLASS} text-right`}>ยอดรวม VAT</span>
        <span className={`${HEAD_CLASS} text-right`}>VAT</span>
        <span className={`${HEAD_CLASS} text-right`}>หัก ณ ที่จ่าย</span>
        <span />
      </div>

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
        return (
          <div
            key={item.id ?? `row-${index}`}
            className={`${ROW_GRID} rounded-xl p-3 md:p-0 md:rounded-none border md:border-0`}
            style={{
              borderColor: "var(--border-card)",
              background: "transparent",
            }}
          >
            <div className="min-w-0">
              <span className={MOBILE_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
                วันที่
              </span>
              <SingleDatePicker
                value={item.expenseDate ?? ""}
                onChange={(ymd) => onUpdate(index, { expenseDate: ymd || null })}
                ariaLabel={`วันที่ของรายการที่ ${index + 1}`}
                placeholder="เลือกวันที่..."
                hasError={dateBad}
              />
            </div>

            <div className="min-w-0">
              <span className={MOBILE_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
                รายละเอียด
              </span>
              <input
                type="text"
                aria-label={`รายละเอียดของรายการที่ ${index + 1}`}
                placeholder="ค่าอะไร / ร้านไหน..."
                value={item.description ?? ""}
                onChange={(e) => onUpdate(index, { description: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-[14px] outline-none"
                style={{
                  background: "var(--bg-input)",
                  color: "var(--text-primary)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: "var(--border-input)",
                }}
              />
            </div>

            <div className="min-w-0">
              <span className={MOBILE_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
                ยอดรวม VAT
              </span>
              <MoneyCell
                ariaLabel={`ยอดรวม VAT ของรายการที่ ${index + 1}`}
                value={item.amount}
                emphasis
                hasError={amountBad}
                placeholder="0.00"
                // A cleared amount is 0, which `isBlankItemRow` reads as
                // "untouched" — the same convention the server documents.
                onChange={(next) => onUpdate(index, { amount: next ?? 0 })}
              />
            </div>

            <div className="min-w-0">
              <span className={MOBILE_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
                VAT
              </span>
              <MoneyCell
                ariaLabel={`VAT ของรายการที่ ${index + 1}`}
                value={item.vatAmount}
                placeholder="—"
                // null, not 0: VAT genuinely not specified is not VAT of zero.
                onChange={(next) => onUpdate(index, { vatAmount: next })}
              />
            </div>

            <div className="min-w-0">
              <span className={MOBILE_LABEL_CLASS} style={{ color: "var(--text-muted)" }}>
                หัก ณ ที่จ่าย
              </span>
              <MoneyCell
                ariaLabel={`หัก ณ ที่จ่าย ของรายการที่ ${index + 1}`}
                value={item.whtAmount}
                placeholder="—"
                onChange={(next) => onUpdate(index, { whtAmount: next })}
              />
            </div>

            <div className="flex justify-end gap-1.5">
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
                style={{ background: "var(--bg-card-alt)", color: "var(--color-danger)" }}
              >
                <Trash2 size={15} />
              </button>
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
