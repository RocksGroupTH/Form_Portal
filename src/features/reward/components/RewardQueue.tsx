"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { CheckCircle2, ChevronRight, Inbox, Loader2, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { RewardDetail } from "@/features/reward/components/RewardDetail";
import { fmtDay as stamp } from "@/features/reward/lib/format-stamp";
import { RewardStatusBadge } from "@/features/reward/components/RewardStatusBadge";
import type { RewardListRow, RewardRequest } from "@/features/reward/types";

/**
 * The Assist AP work queue.
 *
 * One list, three stages, because that is one person's job in sequence: accept
 * the request, prepare the goods, hand them over. Splitting them into tabs would
 * make the reader check three places to find out whether there is anything to
 * do.
 *
 * The primary button on each row is the *next* action for that row, so the queue
 * can be worked without opening anything — and the row still opens for the
 * detail, the evidence and the reject path.
 */

async function fetcher(url: string): Promise<RewardListRow[]> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  return json.data as RewardListRow[];
}

/** What this row needs next — label, endpoint, icon. Null when it needs opening. */
function nextAction(status: string): { label: string; kind: string; icon: React.ReactNode } | null {
  if (status === "ManagerApproved") {
    return { label: "อนุมัติ", kind: "approve", icon: <CheckCircle2 size={13} /> };
  }
  if (status === "Approved") {
    return { label: "จัดของเสร็จ", kind: "ready", icon: <PackageCheck size={13} /> };
  }
  if (status === "Ready") {
    return { label: "รับของแล้ว", kind: "received", icon: <CheckCircle2 size={13} /> };
  }
  return null;
}

export function RewardQueue() {
  const { data, error, isLoading, mutate } = useSWR("/api/request/reward/admin/queue", fetcher);
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<RewardRequest | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  function closePanel() {
    setOpenId(null);
    setDetail(null);
  }

  async function openRow(id: number) {
    setOpenId(id);
    setDetail(null);
    const res = await fetch(`/api/request/reward/requests/${id}`);
    const json = await res.json();
    if (json.ok) setDetail(json.data as RewardRequest);
    else toast.error(json.error ?? "โหลดคำขอไม่สำเร็จ");
  }

  async function act(id: number, kind: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/request/reward/requests/${id}/${kind}`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ดำเนินการไม่สำเร็จ");
      } else {
        toast.success("บันทึกแล้ว");
      }
    } catch {
      toast.error("ดำเนินการไม่สำเร็จ");
    } finally {
      setBusyId(null);
      // Always refetch: on success the row moved, and on a 409 somebody else
      // moved it — either way what is on screen is now stale.
      mutate();
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
        <Loader2 size={15} className="animate-spin" />
        กำลังโหลดคิวงาน...
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-[13px]" style={{ color: "var(--text-danger)" }}>
        {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
      </p>
    );
  }

  const rows = data ?? [];

  if (rows.length === 0) {
    return (
      <div
        className="rounded-[14px] px-4 py-10 text-center"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
      >
        <Inbox size={24} style={{ margin: "0 auto 10px", color: "var(--text-muted)" }} />
        <p className="text-[13.5px] font-bold" style={{ color: "var(--text-primary)" }}>
          ไม่มีคำขอที่รอดำเนินการ
        </p>
        <p className="text-[12px] mt-1" style={{ color: "var(--text-muted)" }}>
          คำขอที่ผู้จัดการอนุมัติแล้วจะปรากฏที่นี่
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2.5">
        {rows.map((row) => {
          const action = nextAction(row.status);
          return (
            <div
              key={row.id}
              className="rounded-[14px] p-3.5 flex items-center gap-3"
              style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
            >
              <button
                type="button"
                onClick={() => openRow(row.id)}
                className="flex-1 min-w-0 text-left"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[13px] font-extrabold"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {row.requestNo ?? `#${row.id}`}
                  </span>
                  <RewardStatusBadge status={row.status} />
                  {row.brandCode && (
                    <span className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                      {row.brandCode}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] mt-1 truncate" style={{ color: "var(--text-secondary)" }}>
                  {row.rewardName ?? "—"} × {row.qty} · {row.requesterFullName ?? "—"}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  ส่งคำขอ {stamp(row.submittedAt)}
                  {row.requesterDepartmentName ? ` · ${row.requesterDepartmentName}` : ""}
                </p>
              </button>

              <div className="flex items-center gap-1.5 shrink-0">
                {action && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={busyId === row.id}
                    icon={action.icon}
                    onClick={() => act(row.id, action.kind)}
                  >
                    {action.label}
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => openRow(row.id)}
                  className="p-1 rounded-md"
                  style={{ color: "var(--text-muted)" }}
                  aria-label="เปิดรายละเอียด"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <SidePanel open={openId != null} onClose={closePanel}>
        <SidePanelClose onClick={closePanel} />
        <div className="p-4 sm:p-5">
          <h2 className="text-[15px] font-extrabold mb-4" style={{ color: "var(--text-primary)" }}>
            {detail?.requestNo ?? "รายละเอียดคำขอ"}
          </h2>
          {detail ? (
            <RewardDetail
              request={detail}
              onChanged={() => {
                if (openId != null) openRow(openId);
                mutate();
              }}
            />
          ) : (
            <div
              className="flex items-center gap-2 text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              <Loader2 size={15} className="animate-spin" />
              กำลังโหลด...
            </div>
          )}
        </div>
      </SidePanel>
    </>
  );
}
