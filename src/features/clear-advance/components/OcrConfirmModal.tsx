"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PoweredByClaude } from "@/components/ui/PoweredByClaude";
import type { BranchOption, GlAccountOption } from "@/features/clear-advance/types";
import type { ReceiptKind } from "@/lib/clr/ai-receipt-core";
import { BranchPicker, GlPicker, cellClass, cellStyle } from "./LinePickers";

/** One OCR candidate awaiting the user's confirmation. Mirrors the editable half
 *  of an expense line plus the WHT-certificate fields the receipt also carries,
 *  so a confirmed row can fill both tables. */
export interface OcrRow {
  /** Stable React key — the rows are reordered by nothing, but a row can be dropped. */
  key: string;
  /** What the model decided this page is. The reviewer can correct it here. */
  kind: ReceiptKind;
  /** Ticked rows are the ones that get written. */
  include: boolean;
  /** The attached receipt this candidate came from. */
  sourceFileId?: number;
  fileName?: string;
  expenseDate: string;
  docNo: string;
  branchCode: string;
  glAccountNo: string;
  glAccountName: string;
  description: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
  /** Read from the receipt, not edited here — carried through to the WHT certificate. */
  taxId: string;
  payeeName: string;
  payeeAddress: string;
  /** Grand total as read, used when the WHT certificate has no before-VAT amount. */
  totalAmount: string;
  /** The account was pre-filled from the AI suggestion (§10) — advisory, editable. */
  glSuggested?: boolean;
}

const KIND_LABEL: Record<ReceiptKind, string> = {
  receipt: "ใบเสร็จ / ใบกำกับภาษี",
  slip: "สลิปโอนเงิน",
};

function money(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "0.00";
}

function F({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 min-w-0">
      <span className="text-[11px] font-bold" style={{ color: "var(--text-secondary)" }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * Review pop-up for OCR results (spec §7). Nothing reaches the expense table
 * until ยืนยันบันทึก — Cancel throws the candidates away, and either way the
 * uploaded file stays attached to the request.
 */
export function OcrConfirmModal({
  open, rows: incoming, skippedPages, branches, brandChosen, glForced, forcedGlLabel, onConfirm, onCancel,
}: {
  open: boolean;
  rows: OcrRow[];
  /** Pages the reader dropped for being neither a receipt nor a slip. Stated as a
   *  count, never as rows: discarding silently is not acceptable, and junk rows
   *  are worse than none. */
  skippedPages: number;
  branches: BranchOption[];
  /** No brand picked yet — the branch list is brand-scoped, so the picker says so. */
  brandChosen: boolean;
  /** The brand books every line to one fixed account, so no G/L is chosen here. */
  glForced: boolean;
  forcedGlLabel?: string;
  onConfirm: (rows: OcrRow[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<OcrRow[]>(incoming);
  // Each row's account list is fetched for that row's branch, exactly like the
  // expense table does — the server decides what a branch may charge.
  const [glByBranch, setGlByBranch] = useState<Record<string, GlAccountOption[]>>({});
  const glRequested = useRef<Set<string>>(new Set());

  useEffect(() => { setRows(incoming); }, [incoming]);

  const branchKeys = useMemo(
    () => Array.from(new Set(rows.map((r) => r.branchCode).filter(Boolean))).sort().join("|"),
    [rows],
  );
  useEffect(() => {
    const missing = (branchKeys ? branchKeys.split("|") : []).filter((c) => !glRequested.current.has(c));
    if (missing.length === 0) return;
    missing.forEach((c) => glRequested.current.add(c));
    let cancelled = false;
    Promise.all(
      missing.map((code) =>
        fetch(`/api/request/clear-advance/options/gl-accounts?branch=${encodeURIComponent(code)}`)
          .then((r) => r.json())
          .then((j: { ok: boolean; data?: GlAccountOption[] }) => [code, j.ok ? j.data ?? [] : []] as const)
          .catch(() => {
            glRequested.current.delete(code); // let a later render retry
            return [code, [] as GlAccountOption[]] as const;
          }),
      ),
    ).then((entries) => {
      if (!cancelled) setGlByBranch((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
    return () => { cancelled = true; };
  }, [branchKeys]);

  // Switching a row's branch can invalidate the account on it — drop the pick
  // rather than carry an account that branch is not allowed to charge.
  useEffect(() => {
    setRows((prev) => {
      let changed = false;
      const next = prev.map((r) => {
        const opts = r.branchCode ? glByBranch[r.branchCode] : undefined;
        if (!r.glAccountNo || !opts || opts.some((o) => o.glAccountNo === r.glAccountNo)) return r;
        changed = true;
        return { ...r, glAccountNo: "", glAccountName: "" };
      });
      return changed ? next : prev;
    });
  }, [glByBranch]);

  // Ask for a suggested account once a row has a branch (§10). The branch decides
  // which accounts are allowed, so this cannot run any earlier; the server picks
  // from that branch's list only, and the answer is a pre-fill the user can change.
  const suggestRequested = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (glForced) return;
    const targets = rows.filter(
      (r) => r.kind === "receipt" && r.branchCode && r.description.trim() && !r.glAccountNo
        && !suggestRequested.current.has(`${r.key}|${r.branchCode}`),
    );
    if (targets.length === 0) return;
    targets.forEach((r) => suggestRequested.current.add(`${r.key}|${r.branchCode}`));
    let cancelled = false;
    for (const r of targets) {
      fetch("/api/request/clear-advance/suggest-gl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: r.description, branch: r.branchCode }),
      })
        .then((res) => res.json())
        .then((j: { ok: boolean; data?: { glAccountNo: string; nameTh: string | null } | null }) => {
          if (cancelled || !j.ok || !j.data) return;
          const s = j.data;
          setRows((prev) => prev.map((x) =>
            // Only fill a row that is still empty and still on the branch we asked about.
            x.key === r.key && x.branchCode === r.branchCode && !x.glAccountNo
              ? { ...x, glAccountNo: s.glAccountNo, glAccountName: s.nameTh ?? "", glSuggested: true }
              : x));
        })
        .catch(() => {});
    }
    return () => { cancelled = true; };
  }, [rows, glForced]);

  const update = (key: string, patch: Partial<OcrRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) onCancel(); }}
      title="ตรวจสอบข้อมูลจากใบเสร็จ"
      scrollable={false}
      contentClassName="max-w-3xl"
    >
      <div className="flex flex-col min-h-0 flex-1">
        <div className="px-5 pt-4 flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
            AI อ่านได้ {rows.length} รายการ · จะบันทึก {rows.filter((r) => r.include).length} รายการ
            {skippedPages > 0 && ` · ข้ามไป ${skippedPages} หน้า (ไม่ใช่ใบเสร็จหรือสลิป)`}
            {" "}— ตรวจสอบชนิดเอกสารและแก้ไขให้ถูกต้อง แล้วกด “ยืนยันบันทึก”
          </p>
          <PoweredByClaude />
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto slim-scroll px-5 py-4 flex flex-col gap-3">
          {rows.map((r, idx) => (
            <div key={r.key} className="rounded-xl p-3 flex flex-col gap-2.5"
              style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}>
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={r.include}
                    onChange={(e) => update(r.key, { include: e.target.checked })} />
                  <span className="text-[11px] font-bold" style={{ color: "var(--text-muted)" }}>
                    รายการที่ {idx + 1}
                  </span>
                </label>
                <div className="flex items-center gap-2 min-w-0">
                  {/* The model classified the page; a wrong guess is cheaper to fix
                      here than by re-uploading. */}
                  <select className={cellClass} style={{ ...cellStyle }} value={r.kind}
                    aria-label="ชนิดเอกสาร"
                    onChange={(e) => update(r.key, { kind: e.target.value as ReceiptKind })}>
                    {(Object.keys(KIND_LABEL) as ReceiptKind[]).map((k) => (
                      <option key={k} value={k}>{KIND_LABEL[k]}</option>
                    ))}
                  </select>
                  {r.fileName && (
                    <span className="text-[11px] truncate max-w-[40%]" style={{ color: "var(--text-faint)" }}>
                      {r.fileName}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <F label={r.kind === "slip" ? "วันที่โอน" : "วันที่"}>
                  <input type="date" className={cellClass} style={{ ...cellStyle, width: "100%" }}
                    value={r.expenseDate} onChange={(e) => update(r.key, { expenseDate: e.target.value })} />
                </F>
                <F label={r.kind === "slip" ? "เลขที่รายการ" : "เลขที่เอกสาร"}>
                  <input className={cellClass} style={{ ...cellStyle, width: "100%" }} placeholder="—"
                    value={r.docNo} onChange={(e) => update(r.key, { docNo: e.target.value })} />
                </F>
                {/* Branch and account belong to an expense line; a slip only carries
                    a date and an amount. */}
                {r.kind === "receipt" && (
                  <>
                    <F label="สาขา">
                      <BranchPicker options={branches} value={r.branchCode} noBrand={!brandChosen}
                        disabled={!brandChosen} inline
                        onPick={(code) => update(r.key, { branchCode: code })} />
                    </F>
                    <F label="รายการ">
                      {glForced ? (
                        <div className="text-[12px] px-2 py-1.5 rounded-lg"
                          style={{ background: "var(--bg-card)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}>
                          {forcedGlLabel}
                        </div>
                      ) : (
                        <>
                          <GlPicker
                            options={(r.branchCode && glByBranch[r.branchCode]) || []}
                            valueNo={r.glAccountNo}
                            disabled={!r.branchCode}
                            noBranch={!r.branchCode}
                            inline
                            onPick={(o) => update(r.key, {
                              glAccountNo: o?.glAccountNo ?? "", glAccountName: o?.nameTh ?? "", glSuggested: false,
                            })}
                          />
                          {r.glSuggested && (
                            <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                              AI แนะนำจากรายละเอียด — เปลี่ยนได้
                            </span>
                          )}
                        </>
                      )}
                    </F>
                  </>
                )}
              </div>

              <F label="รายละเอียด">
                <textarea rows={2} className={cellClass}
                  style={{ ...cellStyle, width: "100%", resize: "vertical", lineHeight: 1.4 }}
                  value={r.description} placeholder="—"
                  onChange={(e) => update(r.key, { description: e.target.value })} />
              </F>

              {r.kind === "receipt" ? (
                <div className="grid grid-cols-3 gap-2.5">
                  <F label="ก่อน VAT">
                    <input type="number" min="0" step="0.01" inputMode="decimal"
                      className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }} placeholder="0.00"
                      value={r.amountBeforeVat} onChange={(e) => update(r.key, { amountBeforeVat: e.target.value })} />
                  </F>
                  <F label="VAT">
                    <input type="number" min="0" step="0.01" inputMode="decimal"
                      className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }} placeholder="0.00"
                      value={r.vatAmount} onChange={(e) => update(r.key, { vatAmount: e.target.value })} />
                  </F>
                  <F label="WHT">
                    <input type="number" min="0" step="0.01" inputMode="decimal"
                      className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }} placeholder="0.00"
                      value={r.whtAmount} onChange={(e) => update(r.key, { whtAmount: e.target.value })} />
                  </F>
                </div>
              ) : (
                <F label="ยอดที่โอน">
                  <input type="number" min="0" step="0.01" inputMode="decimal"
                    className={`${cellClass} text-right`} style={{ ...cellStyle, width: "100%" }} placeholder="0.00"
                    value={r.amountBeforeVat} onChange={(e) => update(r.key, { amountBeforeVat: e.target.value })} />
                </F>
              )}

              {r.kind === "receipt" && (
                <div className="text-[11px] text-right" style={{ color: "var(--text-muted)" }}>
                  รวม ฿{money(String(Number(r.amountBeforeVat || 0) + Number(r.vatAmount || 0)))}
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="shrink-0 flex items-center justify-end gap-2 px-5 py-3.5"
          style={{ borderTop: "1px solid var(--border-light)" }}>
          <Button variant="secondary" size="sm" onClick={onCancel}>ยกเลิก</Button>
          <Button variant="primary" size="sm" onClick={() => onConfirm(rows.filter((r) => r.include))}>ยืนยันบันทึก</Button>
        </div>
      </div>
    </Dialog>
  );
}
