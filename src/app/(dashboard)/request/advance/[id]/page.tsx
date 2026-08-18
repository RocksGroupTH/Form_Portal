"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { Button } from "@/components/ui/Button";
import { AdvanceForm } from "@/features/advance/components/AdvanceForm";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { STEP_LABEL, type StepType } from "@/lib/adv/approval-steps";
import { Wallet } from "lucide-react";
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
  const requestId = params?.id ? Number(String(params.id)) : null;

  const [request, setRequest] = useState<AdvanceRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);

  // Account-step approval inputs.
  const [paymentDates, setPaymentDates] = useState<string[]>([]);
  const [paymentDate, setPaymentDate] = useState<string>("");
  const [checked, setChecked] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

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
      act("approve", { paymentDate, isChecked: checked });
    } else {
      act("approve");
    }
  }
  function handleReject() {
    if (!rejectReason.trim()) return toast.error("กรุณาระบุเหตุผลที่ไม่อนุมัติ");
    act("reject", { comment: rejectReason.trim() });
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

      {isEditable && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => router.push(`/request/advance?id=${request.id}`)}>
            แก้ไขแบบร่าง
          </Button>
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
              <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                วันจ่าย:
                <select className="text-[13px] px-2 py-1 rounded-lg"
                  style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }}
                  value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)}>
                  <option value="">— เลือก —</option>
                  {paymentDates.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <label className="text-[12px] flex items-center gap-2" style={{ color: "var(--text-secondary)" }}>
                <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                ตรวจสอบแล้ว (Check)
              </label>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
              เหตุผล (กรอกก่อนกด &quot;ไม่อนุมัติ&quot;)
            </label>
            <textarea rows={2} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              placeholder="ระบุเหตุผลที่ไม่อนุมัติ..."
              className="text-[13px] px-3 py-2 rounded-lg outline-none"
              style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }} />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="danger" onClick={handleReject} disabled={busy}>ไม่อนุมัติ</Button>
            <Button variant="primary" onClick={handleApprove} loading={busy}>อนุมัติ</Button>
          </div>
        </div>
      )}
    </PageContainer>
  );
}
