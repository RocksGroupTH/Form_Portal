"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Check, ChevronRight, Clock, History, Inbox, Loader2, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { useBookingAccess } from "@/features/travel-booking/hooks/useBookingAccess";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { TravelBookingDetail } from "@/features/travel-booking/components/TravelBookingDetail";
// AP-1's component, used unchanged: the correction is the same act on both
// forms, and two copies would drift on the sentence explaining what the stored
// rate actually is. This page already reaches into `@/features/accounting` for
// `fmtYmdDisplay` above.
import {
  ExchangeRateOverride,
  type RateOverrideSaved,
} from "@/features/accounting/components/ExchangeRateOverride";
import { payoutMonthOptions, type PayoutMonth } from "@/lib/acc/travel-booking/payout-months";
// Pure, import-free (its own type import is erased) — the same sentences the
// server refuses with, so the queue and the 400 can never disagree.
import { dependencyWarningText } from "@/lib/acc/travel-booking/perdiem-dependency-text";
import type { TravelBookingAccountQueueItem, TravelBookingRequest } from "@/features/travel-booking/types";

async function fetcher(url: string): Promise<TravelBookingAccountQueueItem[]> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  return json.data as TravelBookingAccountQueueItem[];
}

/** `"YYYY-MM-DD"` -> `"YYYY-MM"`. A plain slice, not a `Date` — the value never
    needs a timezone, only the two leading date parts. */
function ymFromDate(d: string | null): string | null {
  return d && d.length >= 7 ? d.slice(0, 7) : null;
}

/**
 * This row's payout month, unioned into the standard forward-looking list so a
 * value already scheduled — even one that has since fallen out of the current
 * 12-month window — never just disappears from the select. The server accepts
 * only the standard window (see the route), so picking that lone extra entry
 * back is a no-op; it exists purely so the current value is not lost from view.
 */
function monthOptionsFor(paymentDate: string | null): PayoutMonth[] {
  const base = payoutMonthOptions(new Date());
  const ym = ymFromDate(paymentDate);
  if (!ym || base.some((o) => o.ym === ym)) return base;
  const parts = ym.split("-").map(Number);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return base;
  const extra = payoutMonthOptions(new Date(parts[0], parts[1] - 1, 1), 1);
  return extra.concat(base);
}

/** Row-selection checkbox — same shape as AP-1's `ApprovalsQueue.tsx`. */
function QueueCheckbox({
  checked,
  onChange,
  ariaLabel,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled ? true : undefined}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        if (disabled) return;
        onChange();
      }}
      className={`w-[18px] h-[18px] rounded-[6px] flex items-center justify-center shrink-0 transition-all border-none p-0 ${
        disabled ? "cursor-not-allowed" : "cursor-pointer"
      }`}
      style={{
        background: checked ? "var(--text-info-green)" : "var(--bg-card)",
        boxShadow: checked
          ? "0 0 0 2px color-mix(in srgb, var(--text-info-green) 28%, transparent)"
          : "inset 0 0 0 1.5px var(--border-card)",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {checked && <Check size={11} strokeWidth={3} style={{ color: "var(--bg-card)" }} />}
    </button>
  );
}

/**
 * A row whose per-diem figure can still move under the reader — its group's
 * predecessor is not decided yet (`perdiem-dependency.ts`). Accounting must not
 * sign it, so the row's checkbox and approve button are both disabled and the
 * multi-select never picks it up. The server refuses it as well
 * (`approveByAccount`); this only saves the click.
 */
function isBlocked(item: TravelBookingAccountQueueItem): boolean {
  const dep = item.perDiemDependency;
  return !!dep && !dep.settled;
}

/**
 * AP-17 accounting sign-off queue — the step after the Admin booking desk
 * (`.../travel-booking/queue`). Requests here finished Admin's booking fill-in
 * and are waiting for accounting to pick a payout month and close them to
 * `Completed` (`approveByAccount`, `src/lib/acc/travel-booking/approval.ts`).
 *
 * Gated on `accountApproval` — the `AccBookingApproverTab` menu grant — not on
 * `canAccount` (roster membership): the two answer different questions, see
 * `useBookingAccess`. The actual approve/edit routes still authorize with
 * `canAccessBookingArea`, so a grant here without roster membership sees the
 * queue and gets a 403 on the action, exactly as the menu-grant design intends.
 *
 * Buddhist-year month labels throughout (`payoutMonthOptions`'s own
 * formatting), never `payment-month.ts`'s Gregorian `formatPayoutMonth` — the
 * two forms describe the same convention (month-end payout) with different
 * calendars, and showing both on one page would read as two different months
 * for what is actually one.
 */
export default function TravelBookingAccountApprovalsPage() {
  const searchParams = useSearchParams();
  const { loading: accessLoading, accountApproval, error: accessError } = useBookingAccess();
  const { data, error, isLoading, mutate } = useSWR(
    accountApproval ? "/api/request/travel-booking/account/queue" : null,
    fetcher,
  );

  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TravelBookingRequest | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  /** Row's chosen month, held locally so a save doesn't force-refetch the whole queue. */
  const [monthByRow, setMonthByRow] = useState<Record<number, string>>({});
  const [savingMonthId, setSavingMonthId] = useState<number | null>(null);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  /** Which of the panel's two non-approve exits is being composed, if either. */
  const [panelAction, setPanelAction] = useState<"return" | "reject" | null>(null);
  const [panelComment, setPanelComment] = useState("");
  const [panelActionRunning, setPanelActionRunning] = useState(false);

  const loadDetail = useCallback(async (id: number): Promise<TravelBookingRequest | null> => {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${id}`);
      const json = await res.json();
      const req = json.ok ? (json.data as TravelBookingRequest) : null;
      setDetail(req);
      return req;
    } catch {
      setDetail(null);
      return null;
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  const openRequest = useCallback(
    (id: number) => {
      setOpenId(id);
      setDetail(null);
      // A half-typed comment must not follow the reader to the next request.
      setPanelAction(null);
      setPanelComment("");
      void loadDetail(id);
    },
    [loadDetail],
  );

  const closePanel = useCallback(() => {
    setOpenId(null);
    setDetail(null);
    setPanelAction(null);
    setPanelComment("");
  }, []);

  const removeFromQueue = useCallback(
    (ids: number[]) => {
      void mutate();
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (openId != null && ids.indexOf(openId) !== -1) {
        setOpenId(null);
        setDetail(null);
      }
    },
    [mutate, openId],
  );

  /* After any action taken from the open panel, refresh the queue and close the
     panel once the request has left ACCOUNT.

     The step, not the status alone: a return hands the request back to Admin and
     leaves `Status='ManagerApproved'` untouched, so a status-only test would keep
     the panel open on a request this queue no longer holds. */
  const handleChanged = useCallback(async () => {
    void mutate();
    if (openId == null) return;
    const updated = await loadDetail(openId);
    if (updated && !(updated.status === "ManagerApproved" && updated.currentStepCode === "ACCOUNT")) {
      setOpenId(null);
      setDetail(null);
    }
  }, [mutate, openId, loadDetail]);

  /**
   * The rate accounting just corrected.
   *
   * Patched into the open request rather than refetched, so the booking figures
   * below re-convert at the corrected rate at once. Nothing on the queue row
   * moves: AP-17's `AccRequest.TotalAmount` is the per-diem total, which is
   * always baht and which this override deliberately does not touch.
   */
  const handleRateSaved = useCallback((saved: RateOverrideSaved) => {
    setDetail((prev) => (prev && prev.id === saved.id ? { ...prev, exchangeRate: saved.rate } : prev));
  }, []);

  /* ── The two exits besides approve (see the return/reject routes' ACCOUNT
     branch): hand it back to Admin to fix the booking, or reject it outright.
     Both require a comment — the server refuses a blank one, and the person
     picking the request up needs to be told what was wrong with it. ── */
  async function submitPanelAction(id: number, action: "return" | "reject", comment: string) {
    setPanelActionRunning(true);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        toast.error(json?.error ?? (action === "return" ? "ส่งกลับไม่สำเร็จ" : "ไม่อนุมัติไม่สำเร็จ"));
        return;
      }
      toast.success(action === "return" ? "ส่งกลับให้ Admin แก้ไขแล้ว" : "ไม่อนุมัติแล้ว");
      setPanelAction(null);
      setPanelComment("");
      removeFromQueue([id]);
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setPanelActionRunning(false);
    }
  }

  const rows = data ?? [];

  /**
   * The open request's id, but only while it is genuinely still on this queue's
   * step. The panel's actions are refused by the server anywhere else, and the
   * step — not `Status='ManagerApproved'`, which spans two stages — is what says
   * so.
   */
  const panelRequestId =
    detail != null &&
    detail.id != null &&
    detail.status === "ManagerApproved" &&
    detail.currentStepCode === "ACCOUNT"
      ? detail.id
      : null;

  /** The rows accounting may actually sign — a blocked row is never selectable. */
  const selectableRows = useMemo(() => rows.filter((r) => !isBlocked(r)), [rows]);
  /* Blocked rows are filtered out of the selection as well as out of the
     checkbox, not merely hidden from it: a row selected before a refetch could
     come back blocked (its predecessor was returned to the requester while this
     page was open), and the batch approve reads this list. */
  const selectedRows = useMemo(
    () => selectableRows.filter((r) => selectedIds.has(r.id)),
    [selectableRows, selectedIds],
  );
  const allSelected = selectableRows.length > 0 && selectableRows.every((r) => selectedIds.has(r.id));

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => {
      if (allSelected) return new Set();
      const next = new Set(prev);
      for (const r of selectableRows) next.add(r.id);
      return next;
    });
  }

  async function saveMonth(id: number, ym: string) {
    setSavingMonthId(id);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${id}/payment-date`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ym }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        toast.error(json?.error ?? "บันทึกเดือนจ่ายไม่สำเร็จ");
        return;
      }
      // Written after the server has answered — a refused month leaves the
      // select on the value the database actually holds.
      setMonthByRow((prev) => ({ ...prev, [id]: ym }));
      toast.success("บันทึกเดือนจ่ายแล้ว");
    } catch {
      toast.error("บันทึกเดือนจ่ายไม่สำเร็จ");
    } finally {
      setSavingMonthId(null);
    }
  }

  async function approveOne(id: number) {
    setApprovingId(id);
    try {
      const res = await fetch(`/api/request/travel-booking/requests/${id}/account-approve`, { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        toast.error(json?.error ?? "อนุมัติไม่สำเร็จ");
        return;
      }
      toast.success("อนุมัติแล้ว");
      removeFromQueue([id]);
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setApprovingId(null);
    }
  }

  async function approveSelected() {
    const ids = selectedRows.map((r) => r.id);
    if (ids.length === 0) return;
    setBatchRunning(true);
    const ok: number[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      try {
        const res = await fetch(`/api/request/travel-booking/requests/${id}/account-approve`, { method: "POST" });
        const json = await res.json().catch(() => null);
        if (json?.ok) ok.push(id);
        else failed.push(json?.error ?? "อนุมัติไม่สำเร็จ");
      } catch {
        failed.push("เกิดข้อผิดพลาด");
      }
    }
    setBatchRunning(false);
    if (ok.length > 0) {
      removeFromQueue(ok);
      toast.success(`อนุมัติแล้ว ${ok.length} รายการ`);
    }
    if (failed.length > 0) {
      toast.error(`อนุมัติไม่สำเร็จ ${failed.length} รายการ`);
    }
  }

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ThumbsUp}
        title="อนุมัติจองที่พัก/ตั๋วโดยสาร (บัญชี)"
        titleExtra={<FormEnvironmentChip formCode="AP-17" />}
        subtitle="รายการที่ Admin กรอกข้อมูลการจองเสร็จแล้ว รอบัญชีเลือกเดือนจ่ายและอนุมัติปิดงาน"
        backHref={backTo("/request/accounting/travel-booking", searchParams.get("from"))}
      />

      <div
        className={`rounded-2xl overflow-hidden ${selectedRows.length > 0 ? "pb-16" : ""}`}
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        {accessLoading ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--text-muted)" }}>
            กำลังตรวจสอบสิทธิ์...
          </p>
        ) : accessError ? (
          <div className="py-16 text-center px-4">
            <p className="text-[32px] mb-3">⚠️</p>
            <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
              ตรวจสอบสิทธิ์ไม่สำเร็จ
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              ไม่สามารถตรวจสอบสิทธิ์เข้าถึงของคุณได้ในขณะนี้ กรุณาลองโหลดหน้านี้ใหม่อีกครั้ง
            </p>
          </div>
        ) : !accountApproval ? (
          <div className="py-16 text-center px-4">
            <p className="text-[32px] mb-3">🔒</p>
            <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
              ไม่มีสิทธิ์เข้าถึง
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              หน้านี้สำหรับผู้ที่ได้รับสิทธิ์ &quot;อนุมัติ (บัญชี)&quot; ของ AP-17 เท่านั้น —
              กรุณาติดต่อผู้ดูแลระบบเพื่อขอเพิ่มสิทธิ์ (ผู้ดูแลระบบเพิ่มได้ที่ ตั้งค่าแบบฟอร์มขอเดินทาง →
              สิทธิ์เข้าถึง)
            </p>
          </div>
        ) : isLoading ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--text-muted)" }}>
            กำลังโหลด...
          </p>
        ) : error ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--color-danger)" }}>
            {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
          </p>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Inbox size={32} style={{ color: "var(--text-faint)", margin: "0 auto 12px" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              ไม่มีรายการรอบัญชีอนุมัติ
            </p>
          </div>
        ) : (
          <>
            <div
              className="flex items-center gap-3 px-5 py-3"
              style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}
            >
              <QueueCheckbox
                checked={allSelected}
                onChange={toggleSelectAll}
                ariaLabel="เลือกทั้งหมด"
                disabled={selectableRows.length === 0}
                title={selectableRows.length === 0 ? "ทุกรายการรอผลอนุมัติของคำขอที่เกี่ยวข้องอยู่" : undefined}
              />
              <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                เลือกทั้งหมด ({selectableRows.length} รายการ)
                {selectableRows.length !== rows.length && (
                  <span style={{ color: "var(--text-info-yellow)" }}>
                    {" "}
                    · รออีก {rows.length - selectableRows.length} รายการ
                  </span>
                )}
              </span>
            </div>

            <div className="flex flex-col">
              {rows.map((item) => {
                const blocked = isBlocked(item);
                const isSelected = !blocked && selectedIds.has(item.id);
                const options = monthOptionsFor(item.paymentDate);
                const currentYm = monthByRow[item.id] ?? ymFromDate(item.paymentDate) ?? options[0]?.ym ?? "";

                return (
                  <div
                    key={item.id}
                    className="flex items-start gap-3 px-5 py-4"
                    style={{ borderBottom: "1px solid var(--border-light)" }}
                  >
                    <div className="pt-1">
                      <QueueCheckbox
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                        ariaLabel={`เลือก ${item.requestNo ?? item.id}`}
                        disabled={blocked}
                        title={blocked && item.perDiemDependency ? dependencyWarningText(item.perDiemDependency) : undefined}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      <button
                        type="button"
                        onClick={() => openRequest(item.id)}
                        className="w-full text-left flex items-center gap-2 flex-wrap mb-1 cursor-pointer border-none bg-transparent p-0"
                      >
                        <span className="text-[13px] font-bold underline decoration-dotted" style={{ color: "var(--text-heading)" }}>
                          {item.requestNo ?? "-"}
                        </span>
                        {item.brandCode && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[10.5px] font-bold"
                            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                          >
                            {item.brandCode}
                          </span>
                        )}
                        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                          {item.requesterFullName ?? "-"}
                        </span>
                        {item.requesterDepartmentName && (
                          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                            · {item.requesterDepartmentName}
                          </span>
                        )}
                        <ChevronRight size={13} style={{ color: "var(--text-faint)" }} className="shrink-0" />
                      </button>

                      <div className="flex items-center gap-2 flex-wrap text-[11.5px] mb-2" style={{ color: "var(--text-muted)" }}>
                        <span>{item.provinceName ?? "-"}</span>
                        {item.departDate && (
                          <span>
                            · {fmtYmdDisplay(item.departDate)}
                            {item.returnDate && item.returnDate !== item.departDate ? ` – ${fmtYmdDisplay(item.returnDate)}` : ""}
                          </span>
                        )}
                        <span>
                          · เบี้ยเลี้ยง {item.perDiemDays} วัน / {fmtBaht(item.perDiemTotal)} บาท
                        </span>
                      </div>

                      {/* Named and explained, not just greyed out: an accountant who
                          finds a row they cannot approve has to be told which request
                          they are waiting on and why, or the queue simply looks broken. */}
                      {blocked && item.perDiemDependency && (
                        <div
                          className="flex items-start gap-1.5 mb-2 px-2.5 py-2 rounded-lg text-[11px]"
                          style={{
                            background: "rgba(220,38,38,0.06)",
                            color: "var(--color-danger)",
                            border: "1px solid rgba(220,38,38,0.25)",
                          }}
                        >
                          <Clock size={13} className="shrink-0 mt-0.5" />
                          <span>{dependencyWarningText(item.perDiemDependency)}</span>
                        </div>
                      )}

                      {item.perDiemHistory.length > 0 && (
                        <div
                          className="flex items-start gap-1.5 mb-2 px-2.5 py-2 rounded-lg text-[11px]"
                          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)" }}
                        >
                          <History size={13} className="shrink-0 mt-0.5" />
                          <div className="flex flex-col gap-0.5">
                            {item.perDiemHistory.map((note, idx) => (
                              <span key={idx}>{note}</span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
                          เดือนที่จ่าย
                        </label>
                        <select
                          value={currentYm}
                          disabled={savingMonthId === item.id}
                          onChange={(e) => void saveMonth(item.id, e.target.value)}
                          className="text-[12.5px] rounded-lg px-2.5 py-1.5 outline-none"
                          style={{
                            background: "var(--bg-input)",
                            color: "var(--text-primary)",
                            border: "1px solid var(--border-input)",
                          }}
                        >
                          {options.map((o) => (
                            <option key={o.ym} value={o.ym}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        {savingMonthId === item.id && (
                          <Loader2 size={13} className="animate-spin" style={{ color: "var(--text-muted)" }} />
                        )}

                        <button
                          type="button"
                          onClick={() => void approveOne(item.id)}
                          disabled={blocked || approvingId === item.id || batchRunning}
                          title={blocked && item.perDiemDependency ? dependencyWarningText(item.perDiemDependency) : undefined}
                          className={`inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1.5 rounded-lg ml-auto ${
                            blocked ? "cursor-not-allowed" : "cursor-pointer"
                          }`}
                          style={{
                            background: "var(--bg-info-green)",
                            color: "var(--text-info-green)",
                            border: "1px solid var(--border-info-green)",
                            opacity: blocked ? 0.45 : 1,
                          }}
                        >
                          {approvingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <ThumbsUp size={13} />}
                          อนุมัติ
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {selectedRows.length > 0 && (
        <div
          className="fixed bottom-0 left-0 right-0 px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "var(--bg-card)", borderTop: "1px solid var(--border-card)", boxShadow: "var(--shadow-card)", zIndex: 30 }}
        >
          <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
            เลือก {selectedRows.length} รายการ
          </span>
          <button
            type="button"
            onClick={() => void approveSelected()}
            disabled={batchRunning}
            className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer"
            style={{ background: "var(--color-action)", color: "#fff", border: "none" }}
          >
            {batchRunning ? <Loader2 size={14} className="animate-spin" /> : <ThumbsUp size={14} />}
            อนุมัติที่เลือก ({selectedRows.length})
          </button>
        </div>
      )}

      <SidePanel open={openId != null} onClose={closePanel} width="min(760px, 100vw)" zIndex={50}>
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {detail?.requestNo ?? "รายละเอียดคำขอ"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              ตรวจสอบก่อนอนุมัติปิดงาน
            </p>
          </div>
          <SidePanelClose onClick={closePanel} />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {loadingDetail && !detail ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : detail ? (
            // `readOnlyBooking`: at ACCOUNT, Admin's booking fill-in is done — this
            // view must never let it be re-opened for editing. `showBookingPrice`
            // undoes the one thing that flag also happens to hide: this reader is
            // approving the payout, so what the booking cost is exactly what they
            // are here to check.
            <>
              {/* Accounting's rate correction. Renders nothing for a baht
                  request or one that has left the ACCOUNT step — `panelRequestId`
                  is already exactly that test, and the server repeats it in the
                  UPDATE's own predicate. `foreignAmount` is deliberately null:
                  AP-17's header total is per diem, always baht, so the rate
                  changes what the booking figures convert *to* on screen and
                  rewrites no stored total. */}
              <ExchangeRateOverride
                endpoint={`/api/request/travel-booking/requests/${detail.id}/exchange-rate`}
                atAccountStep={panelRequestId != null}
                currency={detail.currency}
                rate={detail.exchangeRate}
                foreignAmount={null}
                onSaved={handleRateSaved}
              />
              {panelRequestId != null && (
                <div
                  className="rounded-2xl p-3 mb-4 flex flex-col gap-2.5"
                  style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
                >
                  {panelAction === null ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setPanelAction("return");
                          setPanelComment("");
                        }}
                        className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                        style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}
                      >
                        <RotateCcw size={14} /> ส่งกลับให้ Admin แก้ไข
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPanelAction("reject");
                          setPanelComment("");
                        }}
                        className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                        style={{ color: "var(--color-danger)", border: "1px solid rgba(220,38,38,0.25)", background: "rgba(220,38,38,0.06)" }}
                      >
                        <ThumbsDown size={14} /> ไม่อนุมัติ
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="text-[12.5px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
                        {panelAction === "return"
                          ? "ส่งกลับให้ Admin แก้ไขข้อมูลการจอง"
                          : "ไม่อนุมัติคำขอนี้"}
                      </p>
                      <textarea
                        value={panelComment}
                        onChange={(e) => setPanelComment(e.target.value)}
                        rows={3}
                        placeholder={panelAction === "return" ? "ระบุสิ่งที่ต้องแก้ไข" : "ระบุเหตุผลที่ไม่อนุมัติ"}
                        className="w-full text-[13px] px-3 py-2 rounded-lg resize-y"
                        style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={panelActionRunning || panelComment.trim() === ""}
                          onClick={() => void submitPanelAction(panelRequestId, panelAction, panelComment.trim())}
                          className="inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer"
                          style={{
                            background: "var(--color-action)",
                            color: "#fff",
                            border: "none",
                            opacity: panelActionRunning || panelComment.trim() === "" ? 0.55 : 1,
                          }}
                        >
                          {panelActionRunning ? <Loader2 size={14} className="animate-spin" /> : null}
                          ยืนยัน
                        </button>
                        <button
                          type="button"
                          disabled={panelActionRunning}
                          onClick={() => {
                            setPanelAction(null);
                            setPanelComment("");
                          }}
                          className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg cursor-pointer"
                          style={{ background: "var(--bg-card-alt)", color: "var(--text-secondary)", border: "1px solid var(--border-card)" }}
                        >
                          ยกเลิก
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              <TravelBookingDetail
                request={detail}
                onChanged={() => void handleChanged()}
                readOnlyBooking
                showBookingPrice
              />
            </>
          ) : (
            <p className="text-[13px] py-16 text-center" style={{ color: "var(--text-muted)" }}>
              โหลดรายละเอียดไม่สำเร็จ
            </p>
          )}
        </div>
      </SidePanel>
    </PageContainer>
  );
}
