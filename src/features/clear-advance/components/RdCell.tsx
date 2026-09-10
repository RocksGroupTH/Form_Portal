"use client";

import React, { useState } from "react";
import type { ClearAdvanceItem } from "@/features/clear-advance/types";
import { sameRegisteredName } from "@/lib/clr/rd-vat-core";
import { PickerPanel, useAnchoredPopup } from "@/features/clear-advance/components/LinePickers";
import type { RdAnswer } from "@/features/clear-advance/hooks/useRdVatByTin";

const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDay = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
};

/**
 * The "RD" cell — what the Revenue Department says about this line's seller.
 *
 * A chip on the row, because on a grid the question is "which line has a
 * problem" and a paragraph per line cannot answer it at a glance. The chip
 * carries the verdict; clicking it opens what the card used to show at rest —
 * the invoice against the register, the button that takes the registered name,
 * and when it was last asked.
 *
 * Advisory throughout. Nothing here has ever blocked an approval, and nothing
 * here does now: a seller who is not on the VAT register may still be paid, and
 * the accountant is the one who decides what that means.
 */
export function RdCell({
  item,
  answer,
  onRecheck,
  onApply,
}: {
  item: Pick<ClearAdvanceItem, "taxId" | "payeeName" | "taxBranchCode" | "vatAmount">;
  answer: RdAnswer | undefined;
  /** `refresh` forces a new ask of the registry; without it a stored answer
   *  is returned. The card drew the same distinction — ลองใหม่ after a failed
   *  check read the store, ตรวจใหม่ overwrote it. */
  onRecheck: (refresh: boolean) => void;
  onApply: (patch: { payeeName: string; taxBranchCode: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  /* Portalled and self-closing, like every other picker on this row — an
     `absolute` panel inside the table's overflow container is clipped on the
     last row and near the right edge. */
  const { btnRef, popRef, pos } = useAnchoredPopup(open, setOpen, false);

  const tin = (item.taxId ?? "").replace(/\D/g, "");
  const hasTin = tin.length === 13;
  const vat = Number(item.vatAmount ?? 0);
  const reg = answer?.state === "found" ? answer.registrant : null;
  const rdFullName = reg ? [reg.titleName, reg.name].filter(Boolean).join(" ") : "";
  const invoiceName = (item.payeeName ?? "").trim();
  const invoiceBranch = (item.taxBranchCode ?? "").trim();
  /* Spacing differs between the invoice, the card and the register for the same
     company, so only a real difference counts — otherwise the chip cries wolf
     on every line and stops being read. */
  const differs =
    !!rdFullName &&
    (!sameRegisteredName(rdFullName, invoiceName) || (reg?.branchCode ?? "") !== invoiceBranch);

  if (!hasTin) {
    return (
      <span className="text-[12px]" style={{ color: "var(--text-faint)" }} title="ยังไม่มีเลขผู้เสียภาษี 13 หลัก — กรอกในช่องซ้ายมือก่อน">
        —
      </span>
    );
  }

  const chip: { text: string; color: string; bg: string; title: string } = (() => {
    if (!answer || answer.state === "checking") {
      return { text: "…", color: "var(--text-faint)", bg: "transparent", title: "กำลังตรวจกับกรมสรรพากร…" };
    }
    if (answer.state === "unknown") {
      return { text: "!", color: "var(--text-faint)", bg: "transparent", title: "ตรวจไม่สำเร็จ — คลิกเพื่อดูและลองใหม่" };
    }
    if (answer.state === "unregistered") {
      /* Not being VAT registered is only a problem if VAT was charged. A
         natural person selling on a plain receipt is not registered and never
         will be — nearly every individual seller lands here, and dressing that
         as a warning taught the reader to scroll past the line where VAT really
         was claimed from a non-registrant. */
      return vat > 0
        ? { text: "⚠", color: "var(--text-info-yellow)", bg: "var(--bg-info-yellow)", title: `ไม่อยู่ในทะเบียน VAT แต่บรรทัดนี้มี VAT ${money(vat)}` }
        : { text: "—", color: "var(--text-faint)", bg: "transparent", title: "ไม่อยู่ในทะเบียน VAT — ปกติสำหรับบุคคลธรรมดาหรือผู้ขายรายย่อย" };
    }
    return differs
      ? { text: "⚠", color: "var(--text-info-yellow)", bg: "var(--bg-info-yellow)", title: "ชื่อหรือสาขาไม่ตรงกับทะเบียนสรรพากร" }
      : { text: "✓", color: "var(--text-info-green)", bg: "var(--bg-info-green)", title: `ตรงกับใบกำกับ — ${rdFullName}` };
  })();

  return (
    <div className="relative">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={chip.title}
        className="text-[12px] leading-none px-1.5 py-1 rounded cursor-pointer border-none"
        style={{ background: chip.bg, color: chip.color }}
      >
        {chip.text}
      </button>

      {open && (
        <PickerPanel inline={false} pos={pos} panelRef={popRef}>
          <div className="p-2.5 flex flex-col gap-1.5">
          {!answer || answer.state === "checking" ? (
            <Muted>กำลังตรวจกับกรมสรรพากร…</Muted>
          ) : answer.state === "unknown" ? (
            <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
              ตรวจไม่สำเร็จ
              <LinkButton onClick={() => onRecheck(false)}>ลองใหม่</LinkButton>
            </span>
          ) : answer.state === "unregistered" ? (
            <>
              {vat > 0 ? (
                <span className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
                  ⚠ ไม่อยู่ในทะเบียน VAT แต่บรรทัดนี้มี VAT {money(vat)} — ภาษีซื้ออาจขอคืนไม่ได้ ตรวจใบกำกับอีกครั้ง
                </span>
              ) : (
                <Muted>ไม่อยู่ในทะเบียน VAT — ปกติสำหรับบุคคลธรรมดาหรือผู้ขายรายย่อย</Muted>
              )}
              <CheckedAt at={answer.checkedAt} onRefresh={() => onRecheck(true)} />
            </>
          ) : reg ? (
            differs ? (
              <>
                {/* Both, side by side: the invoice is the document, the
                    registry is the record, and which to keep is a judgement. */}
                <Compare label="ใบกำกับ" name={invoiceName || "—"} branch={invoiceBranch} />
                <Compare label="สรรพากร" name={rdFullName} branch={reg.branchCode ?? ""} tone="ok" />
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      onApply({ payeeName: rdFullName, taxBranchCode: reg.branchCode });
                      setOpen(false);
                    }}
                    className="text-[11px] px-2 py-0.5 rounded-lg cursor-pointer"
                    style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)", border: "none" }}
                  >
                    ใช้ข้อมูลจากสรรพากร
                  </button>
                  <CheckedAt at={answer.checkedAt} onRefresh={() => onRecheck(true)} />
                </div>
              </>
            ) : (
              <>
                <span className="text-[11px]" style={{ color: "var(--text-info-green)" }}>
                  ✓ ตรงกับใบกำกับ — {rdFullName}
                  {reg.branchCode ? ` · สาขา ${reg.branchCode}` : ""}
                </span>
                <CheckedAt at={answer.checkedAt} onRefresh={() => onRecheck(true)} />
              </>
            )
          ) : null}
          </div>
        </PickerPanel>
      )}
    </div>
  );
}

function Compare({ label, name, branch, tone }: { label: string; name: string; branch: string; tone?: "ok" }) {
  return (
    <span className="text-[11px] flex gap-1.5">
      <span className="shrink-0" style={{ color: "var(--text-faint)", minWidth: 48 }}>{label}</span>
      <span style={{ color: tone === "ok" ? "var(--text-info-green)" : "var(--text-primary)" }}>
        {name}
        {branch ? ` · สาขา ${branch}` : ""}
      </span>
    </span>
  );
}

function CheckedAt({ at, onRefresh }: { at: string | null; onRefresh: () => void }) {
  return (
    <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
      {at ? `ตรวจเมื่อ ${fmtDay(at)}` : ""}
      <LinkButton onClick={onRefresh}>ตรวจใหม่</LinkButton>
    </span>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="underline cursor-pointer border-none bg-transparent p-0 text-[10px]"
      style={{ color: "var(--nav-active-text)" }}
    >
      {children}
    </button>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{children}</span>;
}
