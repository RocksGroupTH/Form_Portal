"use client";

import { Check, ListChecks } from "lucide-react";
import type { ReimburseRule } from "@/features/reimburse/types";

/**
 * ระเบียบการจ่าย Reimburse (spec §5.2 field 6) — every active
 * `AccReimburseRule`, each with its own checkbox, all of which must be ticked
 * before the request will submit.
 *
 * The list is database-backed on purpose (contrast `REIMBURSE_NOTICE`, which is
 * prose in code): Accounting edit it at Settings, so this component renders
 * whatever the server returns and never hard-codes a rule.
 *
 * An empty list is not an error — a database with no active rule means there is
 * nothing to acknowledge, and the submit gate is satisfied vacuously, exactly
 * as the server's `activeRules.some(...)` check decides it.
 */
export function ReimburseRuleChecklist({
  rules,
  loading,
  checkedIds,
  onToggle,
  onToggleAll,
  hasError,
}: {
  rules: ReimburseRule[];
  loading: boolean;
  /** Rule ids ticked so far. */
  checkedIds: number[];
  onToggle: (ruleId: number, next: boolean) => void;
  onToggleAll: (next: boolean) => void;
  /** Red highlight after a failed submit attempt while any rule is unticked. */
  hasError?: boolean;
}) {
  const checked = new Set(checkedIds);
  const allChecked = rules.length > 0 && rules.every((r) => checked.has(r.id));

  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-11 rounded-xl animate-pulse"
            style={{ background: "var(--bg-card-alt)" }}
          />
        ))}
      </div>
    );
  }

  if (rules.length === 0) {
    return (
      <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
        — ยังไม่ได้ตั้งค่าระเบียบการจ่าย —
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <p
          className="text-[12px] m-0 flex items-center gap-1.5"
          style={{ color: hasError && !allChecked ? "var(--color-danger)" : "var(--text-muted)" }}
        >
          <ListChecks size={13} className="shrink-0" />
          กรุณาอ่านและติ๊กยืนยันให้ครบทุกข้อ ({checkedIds.length}/{rules.length})
        </p>
        <button
          type="button"
          onClick={() => onToggleAll(!allChecked)}
          className="shrink-0 text-[12px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer"
          style={{
            background: "var(--bg-card-alt)",
            border: "1px solid var(--border-card)",
            color: "var(--nav-active-text)",
          }}
        >
          {allChecked ? "ยกเลิกทั้งหมด" : "ยืนยันทั้งหมด"}
        </button>
      </div>

      {rules.map((rule) => {
        const on = checked.has(rule.id);
        return (
          <button
            key={rule.id}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => onToggle(rule.id, !on)}
            className="w-full flex items-start gap-2.5 text-left rounded-xl px-3.5 py-3 cursor-pointer transition-all"
            style={{
              borderWidth: 1.5,
              borderStyle: "solid",
              borderColor: on
                ? "var(--nav-active-text)"
                : hasError
                  ? "var(--color-danger)"
                  : "var(--border-card)",
              background: on ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
            }}
          >
            <span
              className="w-[18px] h-[18px] mt-px rounded flex items-center justify-center shrink-0"
              style={{
                background: on ? "var(--nav-active-text)" : "var(--bg-card)",
                border: on ? "none" : "1px solid var(--border-card)",
              }}
            >
              {on && <Check size={12} color="#fff" />}
            </span>
            <span
              className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: on ? "var(--nav-active-text)" : "var(--text-primary)" }}
            >
              {rule.ruleText}
            </span>
          </button>
        );
      })}
    </div>
  );
}
