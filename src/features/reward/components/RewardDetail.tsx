"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Clock,
  FileText,
  Gift,
  PackageCheck,
  Undo2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui";
import { canActManagerStep } from "@/lib/acc/manager-auth";
import { useRewardAccess } from "@/features/reward/hooks/useRewardAccess";
import { fmtStamp as stamp } from "@/features/reward/lib/format-stamp";
import { RewardStatusBadge } from "@/features/reward/components/RewardStatusBadge";
import { REWARD_FORM_MESSAGE_TH } from "@/features/reward/constants";
import type { RewardRequest } from "@/features/reward/types";

/**
 * One request in full, plus whatever this viewer may do to it next.
 *
 * The action row is gated on **who is looking as well as what step it is at**,
 * mirroring `authorizeRewardAction` on the server: the assigned manager at
 * MANAGER, the Assist AP roster at REWARD and at fulfilment. It used to switch
 * on `request.status` alone, so a requester who opened their own request landed
 * on อนุมัติ / ไม่อนุมัติ / ส่งกลับ the moment they submitted it — buttons that
 * answer 403 for everybody except the two people entitled to press them.
 *
 * The server still decides. Hiding a button is presentation; every route
 * re-checks, and a hidden button is not a control.
 */

type ActionKind = "approve" | "reject" | "return" | "ready" | "received";

function money(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
}

const ACTION_LABEL_TH: Record<string, string> = {
  submitted: "ส่งคำขอ",
  manager_approved: "ผู้จัดการอนุมัติ",
  manager_rejected: "ผู้จัดการไม่อนุมัติ",
  manager_returned: "ผู้จัดการส่งกลับแก้ไข",
  reward_approved: "Assist AP อนุมัติ",
  reward_rejected: "Assist AP ไม่อนุมัติ",
  reward_returned: "Assist AP ส่งกลับแก้ไข",
  reward_ready: "จัดของเรียบร้อย",
  reward_received: "ผู้ขอรับของแล้ว",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      className="rounded-[14px] p-4 sm:p-5"
      style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="text-[13.5px] font-bold mb-3" style={{ color: "var(--text-primary)" }}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] mb-0.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
        {value}
      </p>
    </div>
  );
}

export function RewardDetail({
  request,
  onChanged,
}: {
  request: RewardRequest;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<ActionKind | null>(null);
  const [commentFor, setCommentFor] = useState<"reject" | "return" | null>(null);
  const [comment, setComment] = useState("");

  const { canRewardArea } = useRewardAccess();
  const [viewerStaffId, setViewerStaffId] = useState<number | null>(null);
  const [viewerEmail, setViewerEmail] = useState<string | null>(null);

  // Same lookup AP-1's detail page makes for the same purpose
  // (RequestDetail.tsx:1056-1073).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/employee")
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: { email?: string | null; employee?: { staffId?: number | null } | null } }) => {
        if (cancelled) return;
        setViewerEmail(json.ok ? (json.data?.email ?? null) : null);
        setViewerStaffId(json.ok ? (json.data?.employee?.staffId ?? null) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setViewerStaffId(null);
          setViewerEmail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingManagerApproval = useMemo(
    () => request.approvals?.find((a) => a.stepCode === "MANAGER" && a.status === "Pending") ?? null,
    [request.approvals],
  );

  // MANAGER: the assigned manager only. An admin may not stand in — AP-11
  // follows AP-1 there, not AP-17 (see authorizeRewardAction).
  const canActManager =
    request.status === "Submitted" &&
    request.currentStepCode === "MANAGER" &&
    canActManagerStep(
      viewerStaffId,
      viewerEmail,
      request.managerStaffId,
      pendingManagerApproval,
    );
  // REWARD and fulfilment: the Assist AP roster, or an admin.
  const canActOfficer = request.status === "ManagerApproved" && canRewardArea;
  const isPendingApproval = canActManager || canActOfficer;
  const canReady = request.status === "Approved" && canRewardArea;
  const canReceived = request.status === "Ready" && canRewardArea;

  /**
   * Which step the buttons below act on.
   *
   * AP-11 has two approvals — the manager, then Assist AP — and one person can
   * hold both: every UAT tester is their own manager by design, and an admin
   * counts as Assist AP. For them the "อนุมัติ" button reappears the instant the
   * first approval lands, which reads as a click that did not register rather
   * than as the second of two steps. Naming the step is the whole fix; the
   * button did work both times.
   */
  const stepLabel = canActManager
    ? "ขั้นที่ 1 · ผู้จัดการ"
    : canActOfficer
      ? "ขั้นที่ 2 · Assist AP"
      : canReady
        ? "จัดของ"
        : canReceived
          ? "จ่ายของ"
          : null;

  async function run(kind: ActionKind, body?: Record<string, unknown>) {
    setBusy(kind);
    try {
      const res = await fetch(`/api/request/reward/requests/${request.id}/${kind}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ดำเนินการไม่สำเร็จ");
        // 409 means somebody else moved it — reload so the buttons match reality.
        if (res.status === 409) onChanged();
        return;
      }
      // Name what just happened and what is next. "บันทึกแล้ว" on a two-approval
      // form told the one person who holds both steps nothing about which of
      // them they had just cleared.
      toast.success(
        kind === "approve"
          ? canActManager
            ? "ผู้จัดการอนุมัติแล้ว — ขั้นต่อไป: Assist AP"
            : "Assist AP อนุมัติแล้ว — รอจัดของ"
          : "บันทึกแล้ว",
      );
      setCommentFor(null);
      setComment("");
      onChanged();
    } catch {
      toast.error("ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  function submitComment() {
    if (!commentFor) return;
    if (!comment.trim()) {
      toast.error(
        commentFor === "reject" ? "กรุณาระบุเหตุผลที่ไม่อนุมัติ" : "กรุณาระบุสิ่งที่ต้องแก้ไข",
      );
      return;
    }
    run(commentFor, { comment: comment.trim() });
  }

  return (
    <div className="space-y-4">
      <Card title="รายละเอียดคำขอ">
        <div className="grid gap-3.5 grid-cols-2 sm:grid-cols-3">
          <Field label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <Field label="สถานะ" value={<RewardStatusBadge status={request.status} />} />
          <Field label="บริษัท" value={request.brandCode ?? "—"} />
          <Field label="รหัสพนักงาน" value={request.staffId ?? "—"} />
          <Field label="ชื่อ-สกุล" value={request.requesterFullName ?? "—"} />
          <Field label="แผนก" value={request.requesterDepartmentName ?? "—"} />
        </div>
      </Card>

      <Card title="ของรางวัล">
        <div
          className="flex items-start gap-3 rounded-xl px-3.5 py-3 mb-3.5"
          style={{ background: "var(--bg-subtle)" }}
        >
          <span
            className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            <Gift size={17} />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
              {request.rewardName ?? "—"}
            </p>
            <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              {request.rewardCode ?? "—"}
            </p>
          </div>
        </div>
        <div className="grid gap-3.5 grid-cols-2 sm:grid-cols-3">
          <Field label="จำนวน" value={`${request.qty} ชิ้น`} />
          <Field label="มูลค่า/ชิ้น" value={money(request.unitActualValue)} />
          <Field label="มูลค่ารวม" value={money(request.totalActualValue)} />
        </div>
        {request.note && (
          <div className="mt-3.5">
            <Field label="หมายเหตุ" value={request.note} />
          </div>
        )}
      </Card>

      {/* Fulfilment stamps — only once there is something to show. */}
      {(request.readyAt || request.receivedAt) && (
        <Card title="การจัดของและรับของ">
          <div className="grid gap-3.5 grid-cols-1 sm:grid-cols-2">
            <Field label="จัดของเสร็จเมื่อ" value={stamp(request.readyAt)} />
            <Field label="ผู้ขอรับของเมื่อ" value={stamp(request.receivedAt)} />
          </div>
          {request.status === "Ready" && (
            <p className="text-[11.5px] mt-3" style={{ color: "var(--text-muted)" }}>
              {REWARD_FORM_MESSAGE_TH[2]}
            </p>
          )}
        </Card>
      )}

      {request.attachments.length > 0 && (
        <Card title="เอกสารประกอบ">
          <div className="space-y-2">
            {request.attachments.map((a) => (
              <a
                key={a.id}
                href={`/api/request/reward/files/${a.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors"
                style={{ background: "var(--bg-subtle)" }}
              >
                <FileText size={15} style={{ color: "var(--text-muted)" }} className="shrink-0" />
                <span
                  className="text-[12.5px] font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {a.fileName}
                </span>
              </a>
            ))}
          </div>
        </Card>
      )}

      {/* Actions — what the request's current step allows. */}
      {(isPendingApproval || canReady || canReceived) && (
        <Card title={stepLabel ? `ดำเนินการ — ${stepLabel}` : "ดำเนินการ"}>
          {commentFor ? (
            <div className="space-y-3">
              <label
                className="text-[12px] font-semibold block"
                style={{ color: "var(--text-primary)" }}
                htmlFor="reward-comment"
              >
                {commentFor === "reject" ? "เหตุผลที่ไม่อนุมัติ" : "สิ่งที่ต้องแก้ไข"}
                <span style={{ color: "var(--text-danger)" }}> *</span>
              </label>
              <textarea
                id="reward-comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                autoFocus
                className="w-full text-[13px] rounded-lg px-3 py-2 outline-none resize-y"
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  border: "1.5px solid var(--border-card)",
                }}
              />
              {commentFor === "reject" && (
                <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                  เมื่อไม่อนุมัติ จำนวนที่ล็อกไว้จะถูกคืนเข้าคลังของรางวัลทันที
                </p>
              )}
              <div className="flex gap-2">
                <Button
                  variant={commentFor === "reject" ? "danger" : "primary"}
                  size="md"
                  loading={busy === commentFor}
                  onClick={submitComment}
                >
                  ยืนยัน
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => {
                    setCommentFor(null);
                    setComment("");
                  }}
                >
                  ยกเลิก
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {isPendingApproval && (
                <>
                  <Button
                    variant="primary"
                    size="md"
                    loading={busy === "approve"}
                    icon={<CheckCircle2 size={14} />}
                    onClick={() => run("approve")}
                  >
                    {canActManager ? "อนุมัติ (ผู้จัดการ)" : "อนุมัติ (Assist AP)"}
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    icon={<XCircle size={14} />}
                    onClick={() => setCommentFor("reject")}
                  >
                    ไม่อนุมัติ
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    icon={<Undo2 size={14} />}
                    onClick={() => setCommentFor("return")}
                  >
                    ส่งกลับแก้ไข
                  </Button>
                </>
              )}
              {canReady && (
                <Button
                  variant="primary"
                  size="md"
                  loading={busy === "ready"}
                  icon={<PackageCheck size={14} />}
                  onClick={() => run("ready")}
                >
                  จัดของเรียบร้อย (Ready)
                </Button>
              )}
              {canReceived && (
                <Button
                  variant="primary"
                  size="md"
                  loading={busy === "received"}
                  icon={<CheckCircle2 size={14} />}
                  onClick={() => run("received")}
                >
                  ผู้ขอรับของแล้ว (Received)
                </Button>
              )}
            </div>
          )}
        </Card>
      )}

      <Card title="ประวัติการดำเนินการ">
        <ol className="space-y-3">
          {request.timeline.map((t) => (
            <li key={t.id} className="flex gap-2.5">
              <span
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}
              >
                <Clock size={12} />
              </span>
              <div className="min-w-0">
                <p className="text-[12.5px] font-bold" style={{ color: "var(--text-primary)" }}>
                  {ACTION_LABEL_TH[t.action] ?? t.action}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {stamp(t.createdAt)}
                  {t.authorName ? ` · ${t.authorName}` : ""}
                </p>
                {t.note && (
                  <p className="text-[12px] mt-1" style={{ color: "var(--text-secondary)" }}>
                    {t.note}
                  </p>
                )}
              </div>
            </li>
          ))}
          {request.timeline.length === 0 && (
            <li className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              ยังไม่มีประวัติ
            </li>
          )}
        </ol>
      </Card>
    </div>
  );
}
