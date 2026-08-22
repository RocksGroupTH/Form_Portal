"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Loader2, Plus, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { ADSearchModal } from "@/components/settings/ADSearchModal";
import type { ReimburseApprover } from "@/features/reimburse/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ENDPOINT = "/api/request/reimburse/settings/approvers";

/* ── Confirm Modal — same shape as UatUserSettings' ── */
function ConfirmModal({
  title,
  message,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "var(--overlay-bg)" }}>
      <div
        className="rounded-2xl w-[400px] max-w-[90vw] overflow-hidden"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
      >
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>
            {title}
          </h3>
          <p className="text-[12px]" style={{ color: "var(--text-muted)" }}>
            {message}
          </p>
        </div>
        <div
          className="flex gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
        >
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}
          >
            ยกเลิก
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white"
            style={{ background: danger ? "var(--color-danger)" : "var(--color-action)" }}
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * AP-4's accounting approver pool.
 *
 * Laid out like `UatUserSettings`: one status column where the badge reports
 * the state and the round button beside it performs the one action available —
 * green to switch someone on, red to switch them off. A badge that is also a
 * button reads as neither.
 *
 * Two standing warnings sit above the table, both of them about states the
 * database permits and the workflow does not survive:
 *
 *  - **nobody active** — every AP-4 request stops dead at `ACCOUNT` with
 *    "ไม่มีสิทธิ์ …", which is what an empty table means today;
 *  - **exactly one active** — the two-person rule (`canActFinalStep`) refuses
 *    the same person at `ACCOUNT_FINAL` that took `ACCOUNT`, so a single
 *    approver can start a request through accounting and then nobody, including
 *    them, can finish it.
 *
 * The second is the one that looks fine until it is tried, which is why it is
 * said here rather than discovered at the last approval of a real claim.
 */
export function ReimburseApproverSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data: ReimburseApprover[]; error?: string }>(
    ENDPOINT,
    fetcher,
  );

  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [busyStaffId, setBusyStaffId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  const approvers = data?.ok ? data.data : [];
  const loadError = data && !data.ok ? (data.error ?? "โหลดข้อมูลไม่สำเร็จ") : null;
  const activeCount = approvers.filter((a) => a.isActive).length;

  const doAction = async (body: Record<string, unknown>, busy?: number) => {
    if (busy !== undefined) setBusyStaffId(busy);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("บันทึกเรียบร้อย");
        await mutate();
      } else {
        toast.error(json.error ?? "เกิดข้อผิดพลาด");
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด");
    } finally {
      if (busy !== undefined) setBusyStaffId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── Warning: the pool cannot clear a request ── */}
      {!isLoading && !loadError && activeCount === 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ยังไม่มีผู้อนุมัติฝ่ายบัญชีที่เปิดใช้งาน — คำขอ AP-4 ทุกใบจะค้างที่ขั้นตรวจสอบของบัญชี
            และไม่มีใครกดอนุมัติได้ กรุณาเพิ่มอย่างน้อย 2 คน
          </p>
        </div>
      )}
      {!isLoading && !loadError && activeCount === 1 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            มีผู้อนุมัติฝ่ายบัญชีที่เปิดใช้งานเพียง 1 คน — AP-4 กำหนดให้ผู้ที่ตรวจสอบ (ขั้นบัญชี)
            กับผู้ที่อนุมัติขั้นสุดท้ายต้องไม่ใช่คนเดียวกัน คำขอจะค้างที่ขั้นอนุมัติสุดท้าย
            จนกว่าจะมีผู้อนุมัติที่เปิดใช้งานอย่างน้อย 2 คน
          </p>
        </div>
      )}

      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="flex items-center gap-2 mb-3">
          <Users size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>
            ผู้อนุมัติฝ่ายบัญชี (AP-4)
          </h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            เปิดใช้งาน {activeCount} / {approvers.length} คน
          </span>
        </div>

        <p className="text-[11.5px] leading-relaxed mb-3 m-0" style={{ color: "var(--text-muted)" }}>
          รายชื่อนี้ใช้ทั้งขั้น &quot;ตรวจสอบ (บัญชี)&quot; และ &quot;อนุมัติขั้นสุดท้าย&quot; —
          ใครถึงก่อนเป็นผู้ดำเนินการ โดยคนเดียวกันจะกดทั้งสองขั้นไม่ได้ · เป็นคนละรายชื่อกับผู้อนุมัติของ AP-1
        </p>

        <div className="mb-4">
          <button
            onClick={() => setShowAddModal(true)}
            disabled={adding}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg border-none enabled:cursor-pointer disabled:opacity-60"
            style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
          >
            {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} เพิ่มผู้อนุมัติ
          </button>
        </div>

        {showAddModal && (
          <ADSearchModal
            title="เพิ่มผู้อนุมัติฝ่ายบัญชี (AP-4)"
            subtitle="ผู้อนุมัติต้องมีข้อมูลพนักงานที่ใช้งานอยู่ในระบบ HR (StaffId)"
            onClose={() => setShowAddModal(false)}
            existingEmails={approvers.map((a) => a.email)}
            onSelect={(u) => {
              setAdding(true);
              void doAction({ action: "add", email: u.email, displayName: u.name }).finally(() => setAdding(false));
            }}
          />
        )}

        {isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : loadError ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-danger)" }}>
            {loadError}
          </p>
        ) : approvers.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีผู้อนุมัติฝ่ายบัญชี — กด &quot;เพิ่มผู้อนุมัติ&quot; เพื่อเริ่มต้น
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-light)", background: "var(--bg-card-alt)" }}>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                    ชื่อ
                  </th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                    อีเมล
                  </th>
                  <th className="text-left px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                    StaffId
                  </th>
                  {/* Status and its control are one column: the badge reports,
                      the round button beside it acts. */}
                  <th className="text-center px-4 py-2 font-semibold" style={{ color: "var(--text-muted)" }}>
                    สถานะ
                  </th>
                </tr>
              </thead>
              <tbody>
                {approvers.map((a, idx) => (
                  <tr
                    key={a.id}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                      {a.displayName}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {a.email}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums" style={{ color: "var(--text-muted)" }}>
                      #{a.staffId}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={
                            a.isActive
                              ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                              : { background: "var(--bg-badge)", color: "var(--text-muted)" }
                          }
                        >
                          {a.isActive ? "ใช้งาน" : "ปิด"}
                        </span>
                        <button
                          type="button"
                          disabled={busyStaffId === a.staffId}
                          onClick={() => {
                            if (!a.isActive) {
                              void doAction(
                                { action: "setActive", staffId: a.staffId, isActive: true },
                                a.staffId,
                              );
                              return;
                            }
                            // Naming the consequence rather than asking "are you
                            // sure": going from two active approvers to one is
                            // what strands a request at the final step, and that
                            // is not obvious from the row being switched off.
                            const remaining = activeCount - 1;
                            const message =
                              remaining < 2
                                ? `ปิดการใช้งาน ${a.displayName}? จะเหลือผู้อนุมัติที่เปิดใช้งาน ${remaining} คน — คำขอ AP-4 จะค้างที่ขั้นบัญชีจนกว่าจะมีอย่างน้อย 2 คน`
                                : `ปิดการใช้งาน ${a.displayName} (${a.email})?`;
                            setConfirmAction({
                              title: "ปิดการใช้งานผู้อนุมัติ",
                              message,
                              danger: true,
                              onConfirm: () => {
                                setConfirmAction(null);
                                void doAction(
                                  { action: "setActive", staffId: a.staffId, isActive: false },
                                  a.staffId,
                                );
                              },
                            });
                          }}
                          className="inline-flex items-center justify-center rounded-full border-none shrink-0 enabled:cursor-pointer disabled:cursor-default disabled:opacity-70"
                          style={
                            a.isActive
                              ? { width: 24, height: 24, background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }
                              : { width: 24, height: 24, background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                          }
                          title={a.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                          aria-label={
                            a.isActive ? `ปิดการใช้งาน ${a.displayName}` : `เปิดใช้งาน ${a.displayName}`
                          }
                        >
                          {busyStaffId === a.staffId ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : a.isActive ? (
                            <UserX size={13} />
                          ) : (
                            <UserCheck size={13} />
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          danger={confirmAction.danger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
