"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";
import { BedDouble, Car, ChevronRight, ClipboardList, Inbox, Loader2, Ticket } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { backTo } from "@/lib/request-hub-nav";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeaderBar } from "@/components/layout/PageHeaderBar";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { SidePanel, SidePanelClose } from "@/components/ui/SidePanel";
import { useBookingAccess } from "@/features/travel-booking/hooks/useBookingAccess";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { TravelBookingDetail } from "@/features/travel-booking/components/TravelBookingDetail";
import type { TravelBookingAdminQueueItem, TravelBookingRequest } from "@/features/travel-booking/types";

async function fetcher(url: string): Promise<TravelBookingAdminQueueItem[]> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  return json.data as TravelBookingAdminQueueItem[];
}

function NeedBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
    >
      {icon}
      {label}
    </span>
  );
}

/**
 * AP-17 admin work queue (spec §8.1) — requests that finished Manager approval and are
 * waiting on Admin to fill room/ticket/rent booking details. Gated on `canAccount` from
 * `useBookingAccess`, which is AP-17's own `AccBookingApprover` roster alone — not AP-1's
 * `AccApprover`, and not admin-inclusive.
 *
 * That is deliberately *narrower* than what the backing `admin/queue`,
 * `admin/requests/[id]/booking` and `admin/requests/[id]/complete` routes enforce: they
 * authorize with `canAccessBookingArea`, which reads the same roster but keeps an admin arm
 * so an admin can always operate the system. So an admin who is not on the roster is hidden
 * from this page while the routes would still serve them — menu visibility and authorization
 * are separate questions, and hiding a card was never the control.
 */
export default function TravelBookingAdminQueuePage() {
  const searchParams = useSearchParams();
  const { loading: accessLoading, canAccount, error: accessError } = useBookingAccess();
  const { data, error, isLoading, mutate } = useSWR(
    canAccount ? "/api/request/travel-booking/admin/queue" : null,
    fetcher,
  );

  /* Detail opens in a SidePanel (same as My Request) — Admin fills the booking in, or bounces
     the request back, without losing their place in a long queue. */
  const [openId, setOpenId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TravelBookingRequest | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

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
      void loadDetail(id);
    },
    [loadDetail],
  );

  /* After any action, refresh both the queue and the open request — and close the panel once
     the request has left the Admin stage (handed to accounting / returned / rejected).

     The step, not the status alone: เสร็จสิ้น hands the request to accounting by
     moving `CurrentStepCode` to 'ACCOUNT' and leaving `Status='ManagerApproved'`
     exactly where it was, so a status-only test never fires — the row drops out
     of the queue beneath while the panel stays open on dead Admin controls. */
  const handleChanged = useCallback(async () => {
    void mutate();
    if (openId == null) return;
    const updated = await loadDetail(openId);
    if (updated && !(updated.status === "ManagerApproved" && updated.currentStepCode === "ADMIN")) {
      setOpenId(null);
      setDetail(null);
    }
  }, [mutate, openId, loadDetail]);

  return (
    <PageContainer className="acc-theme py-6 px-3 sm:px-0">
      <PageHeaderBar
        icon={ClipboardList}
        title="คิวจองที่พัก/ตั๋วโดยสาร (AP-17)"
        titleExtra={<FormEnvironmentChip formCode="AP-17" />}
        subtitle="รายการที่ผู้จัดการอนุมัติแล้ว รอ Admin กรอกข้อมูลการจอง"
        backHref={backTo("/request/accounting/travel-booking", searchParams.get("from"))}
      />

      <div className="rounded-2xl overflow-hidden" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        {accessLoading ? (
          <p className="text-[13px] py-10 text-center" style={{ color: "var(--text-muted)" }}>
            กำลังตรวจสอบสิทธิ์...
          </p>
        ) : accessError ? (
          /* A permission check that could not be run is not a refusal. Falling
             through to the deny screen would state a reason we do not know —
             the same distinction commit 514c134 drew for the roster panel. */
          <div className="py-16 text-center px-4">
            <p className="text-[32px] mb-3">⚠️</p>
            <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
              ตรวจสอบสิทธิ์ไม่สำเร็จ
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              ไม่สามารถตรวจสอบสิทธิ์เข้าถึงของคุณได้ในขณะนี้ กรุณาลองโหลดหน้านี้ใหม่อีกครั้ง
            </p>
            <p className="text-[12px] mt-2" style={{ color: "var(--text-faint)" }}>
              {accessError instanceof Error ? accessError.message : "โหลดสิทธิ์ไม่สำเร็จ"}
            </p>
          </div>
        ) : !canAccount ? (
          <div className="py-16 text-center px-4">
            <p className="text-[32px] mb-3">🔒</p>
            <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
              ไม่มีสิทธิ์เข้าถึง
            </h2>
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              หน้านี้สำหรับผู้ที่อยู่ในรายชื่อสิทธิ์เข้าถึงของ AP-17 เท่านั้น — กรุณาติดต่อผู้ดูแลระบบเพื่อขอเพิ่มรายชื่อ (ผู้ดูแลระบบเพิ่มได้ที่ ตั้งค่า → สิทธิ์เข้าถึง)
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
        ) : !data || data.length === 0 ? (
          <div className="py-16 text-center px-4">
            <Inbox size={32} style={{ color: "var(--text-faint)", margin: "0 auto 12px" }} />
            <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
              ไม่มีรายการรอ Admin กรอกข้อมูลการจอง
            </p>
          </div>
        ) : (
          <div className="flex flex-col" style={{ borderTop: "1px solid var(--border-light)" }}>
            {data.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openRequest(item.id)}
                className="w-full text-left flex items-center gap-3 px-5 py-4 cursor-pointer border-none bg-transparent transition-colors hover:opacity-90"
                style={{ borderBottom: "1px solid var(--border-light)", background: "transparent" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                      {item.requestNo ?? "-"}
                    </span>
                    {/* A pill beside the number, matching AP-1's approval queue.
                        Per trip, so two rows of one booking group can name
                        different companies — which is exactly why it has to be
                        on the row rather than on a group header somewhere. */}
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
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[11.5px]" style={{ color: "var(--text-muted)" }}>
                    <span>{item.provinceName ?? "-"}</span>
                    {item.departDate && (
                      <span>
                        · {fmtYmdDisplay(item.departDate)}
                        {item.returnDate && item.returnDate !== item.departDate ? ` – ${fmtYmdDisplay(item.returnDate)}` : ""}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                    {item.needsRoomBooking && <NeedBadge icon={<BedDouble size={11} />} label="ห้องพัก" />}
                    {item.needsTicketBooking && <NeedBadge icon={<Ticket size={11} />} label="ตั๋วโดยสาร" />}
                    {item.needsRentBooking && <NeedBadge icon={<Car size={11} />} label="รถเช่า" />}
                  </div>
                </div>
                <ChevronRight size={16} style={{ color: "var(--text-faint)" }} className="shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      <SidePanel open={openId != null} onClose={() => setOpenId(null)} width="min(760px, 100vw)" zIndex={50}>
        <div
          className="flex items-center justify-between px-4 py-3 shrink-0"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          <div className="min-w-0">
            <p className="text-[14px] font-bold truncate m-0" style={{ color: "var(--text-heading)" }}>
              {detail?.requestNo ?? "รายละเอียดคำขอ"}
            </p>
            <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
              กรอกข้อมูลการจอง หรือส่งกลับ/ไม่อนุมัติคำขอ
            </p>
          </div>
          <SidePanelClose onClick={() => setOpenId(null)} />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-4 py-4 acc-theme">
          {loadingDetail && !detail ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={24} className="animate-spin" style={{ color: "var(--text-muted)" }} />
            </div>
          ) : detail ? (
            <TravelBookingDetail request={detail} onChanged={() => void handleChanged()} />
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
