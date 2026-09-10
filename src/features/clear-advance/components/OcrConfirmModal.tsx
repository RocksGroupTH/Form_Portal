"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { PoweredByClaude } from "@/components/ui/PoweredByClaude";
import type { BranchOption, GlAccountOption } from "@/features/clear-advance/types";
import type { ReceiptKind } from "@/lib/clr/ai-receipt-core";
import { BranchPicker, cellClass, cellStyle, isPickerPanelOpen } from "./LinePickers";
import { normalizeTaxIdInput, taxIdNotice } from "@/lib/clr/seller-tax-id";

/** One OCR candidate awaiting the user's confirmation. Mirrors the editable half
 *  of an expense line plus the WHT-certificate fields the receipt also carries,
 *  so a confirmed row can fill both tables. */
interface VatRegistrant {
  nid: string;
  titleName: string | null;
  name: string | null;
  branchNumber: number | null;
  branchCode: string | null;
  vatRegisteredOn: string | null;
  address: string | null;
}

/** "unknown" is the RD not answering — deliberately not the same as "unregistered". */
type VatCheck =
  | { state: "checking" }
  | { state: "found"; registrant: VatRegistrant }
  | { state: "unregistered" }
  | { state: "unknown" };

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
  /**
   * The date as the model copied it off the page. Shown, never edited: it is
   * evidence about the read, not a value we keep. A slip printed "08 ก.ย. 2026"
   * came back copied as "08 ก.ค. 2026" — the characters themselves misread, so
   * September became July with nothing on our side able to tell. Printing what
   * the AI thinks it saw lets the reviewer catch that at a glance.
   */
  dateText?: string;
  docNo: string;
  /**
   * The seller's branch exactly as the invoice prints it. Carried through the
   * modal so the rule that turns it into a code runs on our side, and so a
   * reviewer can see what was read.
   */
  taxBranchText: string;
  branchCode: string;
  glAccountNo: string;
  glAccountName: string;
  description: string;
  amountBeforeVat: string;
  vatAmount: string;
  whtAmount: string;
  /**
   * The seller off the tax invoice — checked and corrected here, because this is
   * the one moment the reviewer has the receipt in front of them. They become
   * the VAT line's Tax Invoice Name and VAT registration in BC.
   */
  taxId: string;
  payeeName: string;
  payeeAddress: string;
  /** Grand total as read, used when the WHT certificate has no before-VAT amount. */
  totalAmount: string;
  /** The account was pre-filled from the AI suggestion (§10) — advisory, editable. */
  glSuggested?: boolean;
  /** The branch was pre-filled from the AI suggestion (§10) — advisory, editable. */
  branchSuggested?: boolean;
  /** The reader said other branches fitted nearly as well (the CKK / CKK2 / CKC
   *  case). Its own signal, not a computed score — it only draws the eye. */
  branchClose?: boolean;
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
  open, rows: incoming, skippedPages, branches, brandChosen, glForced, onConfirm, onCancel,
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
  onConfirm: (rows: OcrRow[]) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<OcrRow[]>(incoming);
  /** Receipt rows being saved that still have no branch, numbered as on screen. */
  const missingBranch = rows
    .map((r, i) => ({ r, n: i + 1 }))
    .filter(({ r }) => r.include && r.kind === "receipt" && !r.branchCode)
    .map(({ n }) => n);
  // Each row's account list is fetched for that row's branch, exactly like the
  // expense table does — the server decides what a branch may charge.
  const [glByBranch, setGlByBranch] = useState<Record<string, GlAccountOption[]>>({});
  const glRequested = useRef<Set<string>>(new Set());

  /**
   * What the Revenue Department says about each seller's tax id, keyed by the id.
   * `null` is a real answer — that number is not on the VAT register.
   *
   * It is looked up as soon as an id is on screen, because it settles three
   * things the reader is unreliable about at once: the registered name (spelled
   * four different ways across four reads of one invoice), the branch, and
   * whether the seller may issue a tax invoice at all — input tax from someone
   * who is not registered cannot be claimed.
   */
  const [vat, setVat] = useState<Record<string, VatCheck>>({});
  const vatRequested = useRef<Set<string>>(new Set());

  useEffect(() => { setRows(incoming); }, [incoming]);

  const taxIdKeys = useMemo(
    () => Array.from(new Set(rows.map((r) => r.taxId.replace(/\D/g, "")).filter((t) => t.length === 13)))
      .sort().join("|"),
    [rows],
  );
  useEffect(() => {
    for (const tin of taxIdKeys.split("|").filter(Boolean)) {
      if (vatRequested.current.has(tin)) continue;
      vatRequested.current.add(tin);
      setVat((p) => ({ ...p, [tin]: { state: "checking" } }));
      fetch(`/api/request/clear-advance/vat-registrant?taxId=${tin}`)
        .then((r) => r.json())
        .then((j: { ok: boolean; data?: { registrant: VatRegistrant | null } }) => {
          setVat((p) => ({
            ...p,
            // An unreachable RD is not an unregistered seller: the failed case
            // says nothing rather than accusing the invoice.
            [tin]: j.ok
              ? (j.data?.registrant
                  ? { state: "found", registrant: j.data.registrant }
                  : { state: "unregistered" })
              : { state: "unknown" },
          }));
        })
        .catch(() => setVat((p) => ({ ...p, [tin]: { state: "unknown" } })));
    }
  }, [taxIdKeys]);

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
      // Closing here discards the whole read AND the upload, so Escape must not
      // be able to do it by accident: while a branch or account panel is open
      // that keypress is the panel's, and the panel closes itself on it. The
      // next Escape, with nothing nested open, closes the modal as usual.
      onEscapeKeyDown={(e) => { if (isPickerPanelOpen()) e.preventDefault(); }}
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
                    // Scanner filenames are a timestamp and nothing else —
                    // "20260819164241237.pdf". Cut to 40% of the row they all
                    // read alike, and the reviewer cannot tell which upload a row
                    // came from, which is the only thing this label is for. It
                    // takes whatever the row has left now, truncating only when
                    // there is genuinely no room, and the title carries the whole
                    // name for that case.
                    <span className="text-[11px] truncate flex-1 min-w-0" title={r.fileName}
                      style={{ color: "var(--text-faint)" }}>
                      {r.fileName}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <F label={r.kind === "slip" ? "วันที่โอน" : "วันที่"}>
                  <input type="date" className={cellClass} style={{ ...cellStyle, width: "100%" }}
                    value={r.expenseDate} onChange={(e) => update(r.key, { expenseDate: e.target.value })} />
                  {r.dateText && (
                    <p className="text-[11px] mt-1 mb-0" style={{ color: "var(--text-muted)" }}>
                      อ่านจากเอกสาร: <span style={{ color: "var(--text-secondary)" }}>{r.dateText}</span>
                    </p>
                  )}
                </F>
                <F label={r.kind === "slip" ? "เลขที่รายการ" : "เลขที่เอกสาร"}>
                  <input className={cellClass} style={{ ...cellStyle, width: "100%" }} placeholder="—"
                    value={r.docNo} onChange={(e) => update(r.key, { docNo: e.target.value })} />
                </F>
                {/* Branch and account belong to an expense line; a slip only carries
                    a date and an amount. */}
                {/* The tax-VAT block: who issued the invoice. Thirteen digits is
                  longer than anything else on this form, so it gets a row of its
                  own rather than a third of one. */}
              {r.kind === "receipt" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <F label="เลขผู้เสียภาษี (ผู้ขาย)">
                    {/* Digits only, thirteen of them: the RD lookup below asks
                        only about a 13-digit number, so a stray character or a
                        fourteenth digit used to leave a field that looks filled
                        in and silently never checks. */}
                    <input className={cellClass}
                      style={{
                        ...cellStyle, width: "100%",
                        border: taxIdNotice(r.taxId) ? "1px solid var(--color-warning)" : cellStyle.border,
                      }}
                      inputMode="numeric" placeholder="เลข 13 หลัก" maxLength={13}
                      value={r.taxId}
                      onChange={(e) => update(r.key, { taxId: normalizeTaxIdInput(e.target.value) })} />
                    {taxIdNotice(r.taxId) && (
                      <span className="text-[10px]" style={{ color: "var(--color-warning)" }}>
                        {taxIdNotice(r.taxId)}
                      </span>
                    )}
                    {/* Only the empty state says anything. A number that is there
                        needs no caption — the reviewer is looking at the invoice —
                        and a standing warning on every read is one more line to
                        stop seeing. Blank is the case worth explaining: our own tax
                        id is discarded before it reaches here, so an empty field
                        can mean the read went wrong rather than that the invoice
                        printed nothing. */}
                    {!r.taxId && (
                      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
                        AI อ่านเลขผู้ขายไม่ได้ — กรอกจากใบกำกับ
                      </span>
                    )}
                    {/* What the Revenue Department holds for that number. The
                        registered name and branch are facts where the read was a
                        guess, so they are offered rather than applied: the
                        reviewer has the paper and decides. Not being registered
                        is stated plainly — input tax from a seller who is not
                        cannot be claimed. */}
                    {(() => {
                      const v = vat[r.taxId.replace(/\D/g, "")];
                      if (!v) return null;
                      if (v.state === "checking") {
                        return <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>กำลังตรวจกับกรมสรรพากร…</span>;
                      }
                      if (v.state === "unregistered") {
                        return (
                          <span className="text-[10px]" style={{ color: "var(--text-warning)" }}>
                            ไม่พบในทะเบียน VAT ของกรมสรรพากร — ภาษีซื้อจากใบนี้อาจขอคืนไม่ได้
                          </span>
                        );
                      }
                      if (v.state === "unknown") {
                        return <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>ตรวจกับกรมสรรพากรไม่สำเร็จ</span>;
                      }
                      const reg = v.registrant;
                      const full = [reg.titleName, reg.name].filter(Boolean).join(" ");
                      const differs = full && full !== r.payeeName.trim();
                      return (
                        <span className="text-[10px] flex flex-wrap items-center gap-1"
                          style={{ color: "var(--text-info-green)" }}>
                          <span>สรรพากร: {full}{reg.branchCode ? ` · สาขา ${reg.branchCode}` : ""}</span>
                          {differs && (
                            <button type="button"
                              className="text-[10px] underline cursor-pointer border-none bg-transparent p-0"
                              style={{ color: "var(--nav-active-text)" }}
                              onClick={() => update(r.key, {
                                payeeName: full,
                                taxBranchText: reg.branchCode === "00000" ? "สำนักงานใหญ่" : `สาขาที่ ${reg.branchCode}`,
                              })}>
                              ใช้ชื่อนี้
                            </button>
                          )}
                        </span>
                      );
                    })()}
                  </F>
                  <F label="สาขาผู้ขาย">
                    <input className={cellClass} style={{ ...cellStyle, width: "100%" }}
                      placeholder="สำนักงานใหญ่ / สาขาที่ 00001"
                      value={r.taxBranchText}
                      onChange={(e) => update(r.key, { taxBranchText: e.target.value })} />
                  </F>
                </div>
              )}

              {r.kind === "receipt" && (
                <F label="ชื่อผู้ขาย">
                  <input className={cellClass} style={{ ...cellStyle, width: "100%" }} placeholder="—"
                    value={r.payeeName} onChange={(e) => update(r.key, { payeeName: e.target.value })} />
                </F>
              )}

              {r.kind === "receipt" && (
                  <>
                    {/* Ours, not the seller's — the two now sit near each other,
                        and filling one into the other would post the expense to the
                        wrong shop and file the tax against the wrong branch. */}
                    <F label="สาขาที่ใช้จ่าย (ของเรา) *">
                      <BranchPicker options={branches} value={r.branchCode} noBrand={!brandChosen}
                        disabled={!brandChosen} inline
                        onPick={(code) => update(r.key, {
                          branchCode: code, branchSuggested: false, branchClose: false,
                        })} />
                      {/* The branch decides the BU, the account list and the
                          BRANCH dimension on the journal line — a row saved
                          without one is a row someone has to come back to. */}
                      {!r.branchCode && (
                        <span className="text-[10px]" style={{ color: "var(--color-danger)" }}>
                          กรุณาเลือกสาขา
                        </span>
                      )}
                      {r.branchSuggested && (
                        // "close" earns a colour: the pick is as likely to be the
                        // neighbouring branch, and branch decides the account list.
                        <span className="text-[10px]"
                          style={{ color: r.branchClose ? "var(--text-warning)" : "var(--text-faint)" }}>
                          {r.branchClose
                            ? "AI แนะนำ — มีสาขาชื่อคล้ายกัน โปรดตรวจสอบ"
                            : "AI แนะนำจากเอกสาร — เปลี่ยนได้"}
                        </span>
                      )}
                    </F>
                    {/* The "รายการ" cell was here. Accounting chooses the G/L
                        account now, on the detail grid, so the requester is not
                        shown one to confirm — but the suggestion below still
                        runs and still rides along on the row, which is what
                        puts a pre-filled grid in front of the account officer. */}
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
          {/* Refused rather than saved-and-warned: every receipt row needs a
              branch, and the picker for it is on this screen. */}
          <Button
            variant="primary"
            size="sm"
            disabled={missingBranch.length > 0}
            title={missingBranch.length > 0 ? `เลือกสาขาให้ครบก่อน — รายการที่ ${missingBranch.join(", ")}` : undefined}
            onClick={() => onConfirm(rows.filter((r) => r.include))}
          >
            ยืนยันบันทึก
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
