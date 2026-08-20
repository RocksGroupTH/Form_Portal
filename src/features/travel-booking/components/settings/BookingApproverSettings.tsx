"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Loader2, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ADSearchModal, type ADResult } from "@/components/settings/ADSearchModal";

const ENDPOINT = "/api/request/travel-booking/settings/approvers";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BookingApproverRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
}

/* ── Confirm Modal — same shape as the UAT Users panel's ── */
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--overlay-bg)" }}
    >
      <div
        className="rounded-2xl w-[400px] max-w-[90vw] overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        <div className="px-5 py-4">
          <h3 className="text-[14px] font-bold mb-2" style={{ color: "var(--text-heading)" }}>
            {title}
          </h3>
          <p className="text-[12px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
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
 * AP-17's สิทธิ์เข้าถึง tab — who may see the booking queue and the booking
 * report.
 *
 * Deliberately a separate roster from AP-1's ผู้อนุมัติบัญชี: arranging hotels is
 * not approving expense claims. It is also, unusually, a list that starts
 * **empty**, and an empty list is not a neutral state once the gate is on — it
 * hides the queue and the report from everyone who is not an admin. So the
 * empty case gets a standing notice rather than the usual grey "nothing here
 * yet" line: it is a configuration an admin needs explained, not discovered.
 *
 * Table shape follows `UatUserSettings`: one สถานะ column in which the badge
 * reports the state and the round button beside it performs the single
 * available action. Deactivation is a soft delete — rows are never removed, so
 * the history of who could see what stays readable.
 */
export function BookingApproverSettings() {
  const {
    data,
    error: fetchError,
    mutate,
    isLoading,
  } = useSWR<{
    ok: boolean;
    data: BookingApproverRow[];
    error?: string;
  }>(ENDPOINT, fetcher);

  const [showAddModal, setShowAddModal] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    danger?: boolean;
    onConfirm: () => void;
  } | null>(null);
  const [busyStaffId, setBusyStaffId] = useState<number | null>(null);

  const rows = data?.ok ? data.data ?? [] : [];
  // A rejected fetch has to reach `loadError` too, not just an `ok: false` body.
  // Without it SWR leaves `data` undefined and `isLoading` false, `rows` is []
  // and the standing notice below announces "ยังไม่มีผู้มีสิทธิ์เข้าถึง — คิวจอง
  // และรายงานจะไม่แสดงกับใครเลย" on the strength of knowing nothing. An empty
  // roster and an unreadable one look identical from here and mean opposite
  // things, and once the gate is wired that banner is an alarm people act on.
  const loadError = fetchError
    ? fetchError instanceof Error
      ? fetchError.message
      : "โหลดข้อมูลไม่สำเร็จ"
    : data && !data.ok
      ? data.error ?? "โหลดข้อมูลไม่สำเร็จ"
      : null;
  const activeCount = rows.filter((r) => r.isActive).length;

  const call = async (
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    busy?: number,
  ) => {
    if (busy !== undefined) setBusyStaffId(busy);
    try {
      const res = await fetch(ENDPOINT, {
        method,
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
      {/* ── The standing notice. Reachable right now, and the state this page
          ships in: nothing is broken, but nobody outside IT/System Admin can
          reach the booking queue or the report until someone is added. ── */}
      {!isLoading && !loadError && activeCount === 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed">
            ยังไม่มีผู้มีสิทธิ์เข้าถึง — คิวจองและรายงานจะไม่แสดงกับใครเลย
          </p>
        </div>
      )}

      <div
        className="rounded-xl p-4"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
      >
        <div className="flex items-center gap-2 mb-1">
          <ShieldCheck size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>
            สิทธิ์เข้าถึง
          </h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            เปิดใช้งาน {activeCount} / {rows.length} คน
          </span>
        </div>
        <p className="text-[11px] mb-3" style={{ color: "var(--text-muted)" }}>
          ผู้ที่อยู่ในรายชื่อนี้จะเห็นคิวจอง (Admin) และรายงานของแบบฟอร์มขอเดินทาง (AP-17)
          — แยกจากรายชื่อผู้อนุมัติบัญชีของ AP-1
        </p>

        <div className="mb-4">
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
          >
            <Plus size={12} /> เพิ่มผู้มีสิทธิ์เข้าถึง
          </button>
        </div>

        {showAddModal && (
          <ADSearchModal
            title="เพิ่มผู้มีสิทธิ์เข้าถึง"
            subtitle="ค้นหาผู้ใช้จาก Microsoft Entra ID — ต้องมีข้อมูลพนักงานที่ยังทำงานอยู่ในระบบ HR"
            onClose={() => setShowAddModal(false)}
            // Only the email goes up: the server resolves StaffId from HR.
            onSelect={(u: ADResult) => {
              void call("POST", { email: u.email, displayName: u.name });
            }}
            existingEmails={rows.filter((r) => r.isActive).map((r) => r.email)}
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
        ) : rows.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีรายชื่อ — กด &quot;เพิ่มผู้มีสิทธิ์เข้าถึง&quot; เพื่อเริ่มต้น
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr
                  style={{
                    borderBottom: "1px solid var(--border-light)",
                    background: "var(--bg-card-alt)",
                  }}
                >
                  <th
                    className="text-left px-4 py-2 font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    ชื่อ
                  </th>
                  <th
                    className="text-left px-4 py-2 font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    อีเมล
                  </th>
                  <th
                    className="text-left px-4 py-2 font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    รหัสพนักงาน
                  </th>
                  {/* Status and its control share one column: the badge reports,
                      the button acts. A badge that is also a button reads as
                      neither. */}
                  <th
                    className="text-center px-4 py-2 font-semibold"
                    style={{ color: "var(--text-muted)" }}
                  >
                    สถานะ
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, idx) => (
                  <tr
                    key={r.id}
                    className="transition-colors hover:!bg-[var(--bg-row-hover)]"
                    style={{
                      borderBottom: "1px solid var(--border-light)",
                      background: idx % 2 === 1 ? "var(--bg-row-stripe)" : undefined,
                    }}
                  >
                    <td className="px-4 py-2.5 font-medium" style={{ color: "var(--text-primary)" }}>
                      {r.displayName}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {r.email}
                    </td>
                    <td className="px-4 py-2.5" style={{ color: "var(--text-muted)" }}>
                      {r.staffId}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded"
                          style={
                            r.isActive
                              ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                              : { background: "var(--bg-badge)", color: "var(--text-muted)" }
                          }
                        >
                          {r.isActive ? "ใช้งาน" : "ปิด"}
                        </span>
                        <button
                          type="button"
                          disabled={busyStaffId === r.staffId}
                          onClick={() => {
                            if (!r.isActive) {
                              void call("PATCH", { staffId: r.staffId, isActive: true }, r.staffId);
                              return;
                            }
                            // Turning the last one off is the state the standing
                            // notice describes — say so before it happens, not
                            // after.
                            const last = activeCount === 1;
                            setConfirmAction({
                              title: "ปิดสิทธิ์เข้าถึง",
                              message: last
                                ? `ปิดสิทธิ์เข้าถึงของ ${r.displayName} (${r.email})? นี่เป็นคนสุดท้ายในรายชื่อ — หลังปิดแล้วจะไม่มีใครเห็นคิวจองและรายงาน AP-17 เลย`
                                : `ปิดสิทธิ์เข้าถึงของ ${r.displayName} (${r.email})? จะไม่เห็นคิวจองและรายงาน AP-17 อีกต่อไป`,
                              danger: true,
                              onConfirm: () => {
                                setConfirmAction(null);
                                void call(
                                  "PATCH",
                                  { staffId: r.staffId, isActive: false },
                                  r.staffId,
                                );
                              },
                            });
                          }}
                          className="inline-flex items-center justify-center rounded-full border-none shrink-0 enabled:cursor-pointer disabled:cursor-default disabled:opacity-70"
                          style={
                            r.isActive
                              ? {
                                  width: 24,
                                  height: 24,
                                  background: "var(--status-bad-bg)",
                                  color: "var(--status-bad-text)",
                                }
                              : {
                                  width: 24,
                                  height: 24,
                                  background: "var(--status-ok-bg)",
                                  color: "var(--status-ok-text)",
                                }
                          }
                          title={r.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
                          aria-label={
                            r.isActive
                              ? `ปิดการใช้งาน ${r.displayName}`
                              : `เปิดใช้งาน ${r.displayName}`
                          }
                        >
                          {busyStaffId === r.staffId ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : r.isActive ? (
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
