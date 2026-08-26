"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { AdvanceForm } from "@/features/advance/components/AdvanceForm";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { STEP_LABEL, type StepType } from "@/lib/adv/approval-steps";
import { Wallet } from "lucide-react";
import { PaymentDatePicker } from "@/components/ui/PaymentDatePicker";
import type { AdvanceRequest } from "@/features/advance/types";

export default function AdvanceDetailPage() {
  return (
    <Suspense fallback={null}>
      <AdvanceDetailContent />
    </Suspense>
  );
}

function AdvanceDetailContent() {
  const params = useParams();
  const router = useRouter();
  const { data: session } = useSession();
  const requestId = params?.id ? Number(String(params.id)) : null;

  const [request, setRequest] = useState<AdvanceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Account-step approval inputs.
  const [paymentDates, setPaymentDates] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState<string>("");
  const [checked, setChecked] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  // Vendor selection at the ACC_OFFICER step.
  const [vendors, setVendors] = useState<{ vendorNo: string; displayName: string | null }[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<string>("");
  const [vendorMatch, setVendorMatch] = useState<{ status: string | null; confidence: string | null; reason: string | null }>({ status: null, confidence: null, reason: null });

  const fetchRequest = useCallback(() => {
    if (requestId == null || Number.isNaN(requestId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/request/advance/requests/${requestId}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: AdvanceRequest }) => {
        if (cancelled) return;
        if (json.ok && json.data) setRequest(json.data);
        else setNotFound(true);
      })
      .catch(() => { if (!cancelled) setNotFound(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId]);

  useEffect(() => fetchRequest(), [fetchRequest]);

  useEffect(() => {
    if (request?.currentStepCode !== "ACC_OFFICER") return;
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { dates: string[]; default: string } }) => {
        if (json.ok && json.data) {
          setPaymentDates(json.data.dates);
          setPaymentDate(json.data.default);
        }
      })
      .catch(() => {});
  }, [request?.currentStepCode]);

  useEffect(() => {
    if (requestId == null) return;
    if (request?.currentStepCode !== "ACC_OFFICER" || !request?.brandCode) return;
    let cancelled = false;
    fetch(`/api/request/advance/vendors?company=${encodeURIComponent(request.brandCode)}`)
      .then((r) => r.json())
      .then((j: { ok: boolean; vendors?: { vendorNo: string; displayName: string | null }[] }) => {
        if (cancelled) return;
        if (j.ok && j.vendors) setVendors(j.vendors);
      })
      .catch(() => {});
    fetch(`/api/request/advance/vendor-match/${requestId}`, { method: "POST" })
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: { status: string | null; vendorNo: string | null; confidence: string | null; reason: string | null } }) => {
        if (cancelled) return;
        if (j.ok && j.data) {
          setVendorMatch({ status: j.data.status, confidence: j.data.confidence, reason: j.data.reason });
          setSelectedVendor((prev) => prev || (j.data?.vendorNo ?? ""));
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [request?.currentStepCode, request?.brandCode, requestId]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/request/advance/requests/${requestId}/${path}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ดำเนินการไม่สำเร็จ");
      toast.success("ดำเนินการสำเร็จ");
      fetchRequest();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  function handleApprove() {
    if (request?.currentStepCode === "ACC_OFFICER") {
      if (!checked) return toast.error("ต้องกด Check ก่อนอนุมัติ");
      if (!paymentDate) return toast.error("กรุณาเลือกวันจ่าย");
      if (!selectedVendor) return toast.error("กรุณาเลือก Vendor");
      act("approve", { paymentDate, isChecked: checked });
    } else {
      act("approve");
    }
  }
  function handleReject() {
    if (!rejectReason.trim()) return toast.error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
    act("reject", { comment: rejectReason.trim() });
  }
  function handleReturn() {
    if (!rejectReason.trim()) return toast.error("กรุณาระบุสิ่งที่ต้องแก้ไข");
    act("return", { comment: rejectReason.trim() });
  }

  if (loading) {
    return <TravelExpenseLoadingPopup label="กำลังโหลดคำขอ..." subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)" />;
  }
  if (notFound || !request) {
    return (
      <PageContainer className="acc-theme py-6 px-3 sm:px-0">
        <PageHeaderBar icon={Wallet} title="ไม่พบคำขอ" subtitle="รายการนี้อาจถูกลบหรือคุณไม่มีสิทธิ์เข้าถึง"
          onBack={() => router.back()} backLabel="กลับ" />
      </PageContainer>
    );
  }

  const isEditable = request.status === "Draft" || request.status === "Returned";
  const currentStep = (request.currentStepCode as StepType | null) ?? null;
  const inApproval = request.status === "Submitted" && !!currentStep;
  const currentStepLabel = currentStep ? STEP_LABEL[currentStep] ?? currentStep : "";

  // Requester may withdraw while still within 24h AND Head Accounting hasn't approved.
  const myId = session?.user?.id != null ? Number(session.user.id) : null;
  const isOwner = myId != null && request.submittedBy === myId;
  const headAccApproved = (request.approvals ?? []).some((a) => a.stepType === "HEAD_ACC" && a.status === "Approved");
  const within24h = request.submittedAt
    ? Date.now() - new Date(request.submittedAt).getTime() <= 24 * 60 * 60 * 1000
    : false;
  const canCancel =
    isOwner &&
    (request.status === "Submitted" || request.status === "ManagerApproved") &&
    within24h && !headAccApproved;

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0 flex flex-col gap-4">
      <PageHeaderBar
        icon={Wallet}
        title={request.requestNo ?? "ฉบับร่าง"}
        subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)"
        onBack={() => router.back()}
        backLabel="กลับ"
        titleExtra={
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
            {statusLabelDisplay(request.status)}
          </span>
        }
      />

      {(isEditable || canCancel) && (
        <div className="flex justify-end gap-2">
          {isEditable && (
            <Button variant="secondary" onClick={() => router.push(`/request/advance?id=${request.id}`)}>
              แก้ไขแบบร่าง
            </Button>
          )}
          {canCancel && (
            <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={busy}>
              ยกเลิกคำขอ
            </Button>
          )}
        </div>
      )}

      {/* Read-only field view (form renders read-only for non-draft status) */}
      <AdvanceForm initial={request} onSaved={() => {}} onSubmitted={() => {}} />

      {/* Approval timeline */}
      {request.approvals && request.approvals.length > 0 && (
        <div className="rounded-2xl p-4 flex flex-col gap-2"
          style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}>
          <h3 className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>ประวัติการอนุมัติ</h3>
          {request.approvals.map((a) => (
            <div key={a.id} className="flex items-center justify-between text-[12px]"
              style={{ color: "var(--text-secondary)" }}>
              <span>{a.stepLabel}
                {a.actionedByName ? ` · ${a.actionedByName}` : a.assignedName ? ` · ${a.assignedName}` : ""}</span>
              <span className="font-bold">{a.status}{a.comment ? ` — ${a.comment}` : ""}</span>
            </div>
          ))}
        </div>
      )}

      {/* Approval actions (server enforces authorization) */}
      {inApproval && (
        <div className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}>
          <h3 className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
            การอนุมัติ ({currentStepLabel})
          </h3>
          {currentStep === "ACC_OFFICER" && (
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                วันจ่าย:
                <PaymentDatePicker value={paymentDate} onChange={setPaymentDate} allowedDates={paymentDates} />
              </div>
              <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                ตรวจสอบแล้ว (Check)
              </label>
              <div className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                Vendor:
                <select
                  aria-label="เลือก Vendor"
                  value={selectedVendor}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSelectedVendor(v);
                    if (!v) return;
                    fetch("/api/request/advance/vendor-confirm", {
                      method: "POST", headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ id: requestId, vendorNo: v }),
                    })
                      .then((r) => r.json())
                      .then((j: { ok: boolean; error?: string }) => {
                        if (!j.ok) toast.error(j.error ?? "ยืนยัน Vendor ไม่สำเร็จ");
                        else { setVendorMatch((m) => ({ ...m, status: "confirmed" })); toast.success("ยืนยัน Vendor แล้ว"); }
                      })
                      .catch(() => toast.error("ยืนยัน Vendor ไม่สำเร็จ"));
                  }}
                  className="border rounded px-2 py-1"
                >
                  <option value="">— เลือก Vendor —</option>
                  {vendors.map((v) => (
                    <option key={v.vendorNo} value={v.vendorNo}>{v.displayName ?? v.vendorNo} ({v.vendorNo})</option>
                  ))}
                </select>
                {vendorMatch.status === "suggested" && vendorMatch.confidence && (
                  <span title={vendorMatch.reason ?? ""} className="text-[11px] opacity-70">AI: {vendorMatch.confidence}</span>
                )}
              </div>
            </div>
          )}
          {/* ACC_OFFICER is the final ERP-posting step — only "ดำเนินการ", no
              reject/return (and hence no reason box). Earlier approvers keep all three. */}
          {currentStep !== "ACC_OFFICER" && (
            <div className="flex flex-col gap-1">
              <label className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                เหตุผล / สิ่งที่ต้องแก้ไข (กรอกก่อนกด &quot;ไม่อนุมัติ&quot; หรือ &quot;ส่งกลับแก้ไข&quot;)
              </label>
              <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
                placeholder="ระบุเหตุผลที่ไม่อนุมัติ หรือสิ่งที่ต้องการให้แก้ไข..."
                className="text-[13px] px-3 py-2 rounded-lg outline-none"
                style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }} />
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            {currentStep !== "ACC_OFFICER" && (
              <>
                <Button variant="secondary" onClick={handleReturn} disabled={busy}>ส่งกลับแก้ไข</Button>
                <Button variant="danger" onClick={handleReject} disabled={busy}>ไม่อนุมัติ</Button>
              </>
            )}
            <Button variant="primary" onClick={handleApprove} loading={busy}>
              {currentStep === "ACC_OFFICER" ? "ดำเนินการ" : "อนุมัติ"}
            </Button>
          </div>
        </div>
      )}

      {/* cancel-request confirm popup */}
      <Dialog
        open={cancelOpen}
        onOpenChange={(o) => { if (!busy) setCancelOpen(o); }}
        title="ยืนยันยกเลิกคำขอ"
        contentClassName="max-w-[400px]"
      >
        <div className="flex flex-col gap-3 p-1">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            ยกเลิกคำขอ <b>{request.requestNo ?? ""}</b> ใช่ไหม? ระบบจะแจ้งเตือน <b>Head Accounting</b> และสำเนาถึงคุณทางอีเมล
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={busy}>ไม่ยกเลิก</Button>
            <Button variant="danger" loading={busy}
              onClick={async () => { await act("cancel"); setCancelOpen(false); }}>ยืนยันยกเลิก</Button>
          </div>
        </div>
      </Dialog>
    </PageContainer>
  );
}
