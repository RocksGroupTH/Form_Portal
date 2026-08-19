"use client";

import { useEffect, useState } from "react";
import { CircleAlert, Plus, Trash2 } from "lucide-react";
import { sumReimburseItems } from "@/lib/acc/reimburse/calc";
import { isBlankItemRow } from "@/lib/acc/reimburse/item-money";
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
      return parseMoneyText(prev) === (value ?? null) ? prev : null;
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
 * Rows are labelled by their position in the grid, not by their position among
 * the rows that survive the blank filter — a blank row above a filled one would
 * otherwise make the number point at a different, valid row.
 */
export function findItemRowProblems(items: ReimburseItem[]): ItemRowProblem[] {
  const problems: ItemRowProblem[] = [];
  items.forEach((it, index) => {
    if (isBlankItemRow(it)) return;
    const label = items.length > 1 ? ` (แถวที่ ${index + 1})` : "";
    if (!it.expenseDate || it.expenseDate.trim() === "") {
      problems.push({ index, kind: "date", label: `กรุณาระบุวันที่ของรายการ${label}` });
    }
    const amount = Number(it.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      problems.push({
        index,
        kind: "amount",
        label: `กรุณาระบุจำนวนเงินให้ถูกต้อง (มากกว่า 0)${label}`,
      });
    }
  });
  return problems;
}

/* ─────────────────────────── the grid ─────────────────────────── */

const HEAD_CLASS = "text-[11px] font-semibold uppercase tracking-wide";
const MOBILE_LABEL_CLASS = "md:hidden text-[11px] font-semibold uppercase tracking-wide mb-1";
const ROW_GRID =
  "grid grid-cols-1 md:grid-cols-[150px_minmax(0,1fr)_130px_120px_130px_36px] gap-2 md:items-center";

function fmtBaht(n: number): string {
  return n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ReimburseItemGrid({
  items,
  onUpdate,
  onAdd,
  onRemove,
  problems,
  showProblems,
}: {
  items: ReimburseItem[];
  onUpdate: (index: number, patch: Partial<ReimburseItem>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** Row problems from `findItemRowProblems`, computed once by the form. */
  problems: ItemRowProblem[];
  /** Only paint a row red once a submit has actually been attempted. */
  showProblems: boolean;
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
              <input
                type="date"
                aria-label={`วันที่ของรายการที่ ${index + 1}`}
                value={item.expenseDate ?? ""}
                onChange={(e) => onUpdate(index, { expenseDate: e.target.value || null })}
                className="w-full rounded-lg px-3 py-2 text-[14px] outline-none"
                style={{
                  background: "var(--bg-input)",
                  color: "var(--text-primary)",
                  borderWidth: 1,
                  borderStyle: "solid",
                  borderColor: dateBad ? "var(--color-danger)" : "var(--border-input)",
                  boxShadow: dateBad ? "0 0 0 1px var(--color-danger)" : undefined,
                }}
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

            <div className="flex md:block justify-end">
              <button
                type="button"
                onClick={() => onRemove(index)}
                aria-label={`ลบรายการที่ ${index + 1}`}
                title="ลบรายการนี้"
                className="w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer border-none"
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
