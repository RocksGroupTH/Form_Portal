"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X, ExternalLink, Paperclip, FileText } from "lucide-react";
import { toast } from "sonner";
import { statusLabelDisplay } from "@/features/accounting/constants";
import type { AdvanceRequest } from "@/features/advance/types";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import { AdvanceVendorPicker } from "./AdvanceVendorPicker";

function money(n: number | null | undefined): string {
  return (n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const APPR_STATUS: Record<string, { label: string; color: string }> = {
  Approved: { label: "อนุมัติแล้ว", color: "#16a34a" },
  Rejected: { label: "ไม่อนุมัติ", color: "#dc2626" },
  Pending: { label: "รออนุมัติ", color: "var(--text-muted)" },
};

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = !value?.toString().trim();
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[12px] m-0 font-medium break-words" style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }}>
        {empty ? "—" : value}
      </p>
    </div>
  );
}

/**
 * Right-side drawer that previews an AP-2 request (info · attachments · approval
 * history) without navigating into the full form page. Opens instantly and
 * fetches only the request JSON, so it is far faster than the detail route.
 */
export function AdvanceDetailPanel({ requestId, onClose, onChanged }:
  { requestId: number | null; onClose: () => void; onChanged?: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<AdvanceRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState<{ attemptNo: number; erpDocumentNo: string | null; status: string }[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [paymentDates, setPaymentDates] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState<string>("");
  const [approving, setApproving] = useState(false);

  // ADV↔PV send history (only meaningful once a row has been pulled back and re-sent).
  useEffect(() => {
    if (requestId == null) { setAttempts([]); return; }
    let cancelled = false;
    fetch(`/api/request/advance/requests/${requestId}/attempts`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { attemptNo: number; erpDocumentNo: string | null; status: string }[] }) => { if (!cancelled) { if (j.ok && j.data) setAttempts(j.data); else setAttempts([]); } })
      .catch(() => { if (!cancelled) setAttempts([]); });
    return () => { cancelled = true; };
  }, [requestId]);

  useEffect(() => {
    setSelectedVendor("");
    if (requestId == null) { setData(null); return; }
    let cancelled = false;
    setLoading(true);
    setData(null);
    fetch(`/api/request/advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: AdvanceRequest }) => { if (!cancelled) setData(j.ok && j.data ? j.data : null); })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  // Close on Escape.
  useEffect(() => {
    if (requestId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [requestId, onClose]);

  const atApproval = data?.status === "Submitted" && !!data?.currentStepCode;
  const atAccOfficer = atApproval && data?.currentStepCode === "ACC_OFFICER";

  useEffect(() => {
    if (!atAccOfficer) return;
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { dates: string[]; default: string } }) => {
        if (j.ok && j.data) { setPaymentDates(j.data.dates); setPaymentDate(j.data.default); }
      })
      .catch(() => {});
  }, [atAccOfficer]);

  if (requestId == null) return null;

  const adv = data?.advance;
  const files = adv?.files ?? [];
  const fx = adv && adv.currency !== "THB" && adv.amount != null
    ? `${adv.amount.toLocaleString()} ${adv.currency} × ${adv.exchangeRate ?? "-"} = ${money(adv.baseAmount)} ฿`
    : `${money(adv?.baseAmount ?? adv?.amount ?? data?.totalAmount)} ฿`;

  async function handleApprove() {
    if (requestId == null) return;
    if (atAccOfficer) {
      if (!paymentDate) return toast.error("กรุณาเลือกวันจ่าย");
      if (!selectedVendor) return toast.error("กรุณาเลือก Vendor");
    }
    setApproving(true);
    try {
      if (atAccOfficer) {
        const c = await fetch("/api/request/advance/vendor-confirm", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: requestId, vendorNo: selectedVendor }),
        }).then((r) => r.json()) as { ok: boolean; error?: string };
        if (!c.ok) { toast.error(c.error ?? "ยืนยัน Vendor ไม่สำเร็จ"); return; }
      }
      const res = await fetch(`/api/request/advance/requests/${requestId}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(atAccOfficer ? { paymentDate } : {}),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "อนุมัติไม่สำเร็จ"); return; }
      toast.success("อนุมัติสำเร็จ");
      onChanged?.();
      onClose();
    } catch {
      toast.error("อนุมัติไม่สำเร็จ");
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      {/* backdrop */}
      <div className="fixed inset-0 z-40" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} />
      {/* drawer */}
      <aside
        className="fixed top-0 right-0 z-50 h-full w-full max-w-[440px] flex flex-col shadow-2xl acc-theme"
        style={{ background: "var(--bg-card)", borderLeft: "1px solid var(--border-card)" }}
      >
        {/* header */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: "1px solid var(--border-card)" }}>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
              {data?.requestNo ?? (loading ? "กำลังโหลด..." : `#${requestId}`)}
            </p>
            {data && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                {statusLabelDisplay(data.status)}
              </span>
            )}
          </div>
          <button type="button" onClick={onClose} className="cursor-pointer p-1 rounded-lg"
            style={{ color: "var(--text-muted)" }} title="ปิด">
            <X size={18} />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {loading ? (
            <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
          ) : !data ? (
            <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>ไม่พบคำขอ</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="ผู้ขอ" value={data.requesterFullName} />
                <Field label="แบรนด์" value={data.brandCode} />
                <Field label="ผู้รับเงิน" value={adv?.payeeName} />
                <Field label="ประเภท" value={adv?.payeeType === "vendor" ? "คู่ค้า" : adv?.payeeType === "employee" ? "พนักงาน" : null} />
                <Field label="เลขบัญชี" value={adv?.payeeBankAccount} />
                <Field label="ธนาคาร" value={adv?.payeeBankCode} />
                <Field label="วันที่ใช้เงิน" value={adv?.needByDate} />
                <Field label="วันคาดเคลียร์" value={adv?.expectedClearDate} />
                <Field label="วันจ่าย" value={data.paymentDate} />
                <Field label="จำนวนเงิน" value={fx} />
              </div>

              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>รายละเอียดค่าใช้จ่าย</p>
                <p className="text-[12px] m-0 whitespace-pre-wrap" style={{ color: adv?.purpose ? "var(--text-primary)" : "var(--text-muted)" }}>
                  {adv?.purpose || "—"}
                </p>
              </div>

              {adv?.overThresholdReason && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1" style={{ color: "var(--text-faint)" }}>เหตุผล (ยอดเกิน 3,000)</p>
                  <p className="text-[12px] m-0 whitespace-pre-wrap" style={{ color: "var(--text-primary)" }}>{adv.overThresholdReason}</p>
                </div>
              )}

              {/* attachments */}
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Paperclip size={13} style={{ color: "var(--text-muted)" }} />
                  <p className="text-[10px] font-bold uppercase tracking-wide m-0" style={{ color: "var(--text-faint)" }}>
                    เอกสารแนบ ({files.length})
                  </p>
                </div>
                {files.length === 0 ? (
                  <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>— ไม่มีเอกสารแนบ</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {files.map((f) => {
                      const href = `/api/request/advance/files/${f.id}`;
                      const isImg = (f.contentType ?? "").toLowerCase().startsWith("image/");
                      const ext = (f.fileName.split(".").pop() ?? "").toUpperCase().slice(0, 4);
                      return (
                        <a key={f.id} href={href} target="_blank" rel="noopener noreferrer" title={f.fileName}
                          className="group flex flex-col rounded-lg overflow-hidden no-underline"
                          style={{ border: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}>
                          <div className="relative w-full aspect-square flex items-center justify-center overflow-hidden"
                            style={{ background: "var(--bg-badge)" }}>
                            {isImg ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={href} alt={f.fileName} loading="lazy" className="w-full h-full object-cover" />
                            ) : (
                              <div className="flex flex-col items-center gap-1">
                                <FileText size={22} style={{ color: "var(--nav-active-text)" }} />
                                <span className="text-[9px] font-bold" style={{ color: "var(--text-muted)" }}>{ext || "FILE"}</span>
                              </div>
                            )}
                            <span className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5"
                              style={{ background: "rgba(0,0,0,0.55)" }}>
                              <ExternalLink size={11} color="#fff" />
                            </span>
                          </div>
                          <span className="text-[10px] px-1.5 py-1 truncate" style={{ color: "var(--text-secondary)" }}>{f.fileName}</span>
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>

              {atAccOfficer && requestId != null && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>
                    Vendor (สำหรับลง ERP)
                  </p>
                  <AdvanceVendorPicker
                    key={requestId}
                    requestId={requestId}
                    company={data.brandCode ?? ""}
                    compact
                    onConfirmed={setSelectedVendor}
                    onSuggested={setSelectedVendor}
                  />
                </div>
              )}

              {/* approval history — always shown */}
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: "var(--text-faint)" }}>
                  ประวัติการอนุมัติ
                </p>
                {!data.approvals || data.approvals.length === 0 ? (
                  <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>— ยังไม่มีขั้นอนุมัติ</p>
                ) : (
                  <div className="flex flex-col">
                    {data.approvals.map((a, i) => {
                      const st = APPR_STATUS[a.status] ?? { label: a.status, color: "var(--text-muted)" };
                      const last = i === data.approvals!.length - 1;
                      const who = a.actionedByName ?? a.assignedName;
                      return (
                        <div key={a.id} className="flex gap-2.5">
                          {/* timeline rail */}
                          <div className="flex flex-col items-center">
                            <span className="mt-1.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: st.color }} />
                            {!last && <span className="flex-1 w-px my-0.5" style={{ background: "var(--border-card)" }} />}
                          </div>
                          <div className="flex-1 min-w-0 pb-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{a.stepLabel}</span>
                              <span className="text-[11px] font-bold shrink-0" style={{ color: st.color }}>{st.label}</span>
                            </div>
                            <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                              {who ?? "—"}
                              {a.actionedAt ? ` · ${a.actionedAt.slice(0, 16).replace("T", " ")}` : ""}
                              {a.paymentDate ? ` · จ่าย ${a.paymentDate}` : ""}
                            </p>
                            {a.comment && (
                              <p className="text-[11px] m-0 mt-0.5 px-2 py-1 rounded"
                                style={{ background: "var(--bg-card-alt)", color: "var(--text-secondary)" }}>
                                {a.comment}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ERP send history (ADV↔PV mapping) — shown only after a re-send */}
              {attempts.length > 1 && (
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>
                    ประวัติการส่ง ERP
                  </p>
                  <div className="flex flex-col gap-1">
                    {attempts.map((a) => (
                      <div key={a.attemptNo} className="flex items-center gap-2 text-[12px]">
                        <span className="font-mono" style={{ color: "var(--text-primary)" }}>{a.erpDocumentNo ?? "—"}</span>
                        <span className="font-semibold" style={{ color: a.status === "Resent" ? "var(--color-warning)" : "var(--color-success, #16a34a)" }}>
                          {a.status === "Resent" ? "Resent (อย่า post)" : "Sent (ปัจจุบัน)"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* footer */}
        <div className="px-4 py-3 flex flex-col gap-2" style={{ borderTop: "1px solid var(--border-card)" }}>
          {atApproval && (
            <div className="flex items-center gap-2">
              {atAccOfficer && (
                <PaymentDatePicker value={paymentDate} onChange={setPaymentDate} allowedDates={paymentDates} />
              )}
              <button type="button" onClick={handleApprove} disabled={approving}
                className="ml-auto text-[13px] font-bold px-4 py-2 rounded-lg cursor-pointer border-none disabled:opacity-60"
                style={{ background: "var(--color-action, #A3121B)", color: "#fff" }}>
                {approving ? "กำลังดำเนินการ..." : atAccOfficer ? "ดำเนินการ" : "อนุมัติ"}
              </button>
            </div>
          )}
          <button type="button" onClick={() => router.push(`/request/advance/${requestId}`)}
            className="flex items-center gap-1.5 text-[12px] font-semibold cursor-pointer bg-transparent border-none p-0"
            style={{ color: "var(--nav-active-text)" }}>
            เปิดใบเต็ม <ExternalLink size={13} />
          </button>
        </div>
      </aside>
    </>
  );
}
