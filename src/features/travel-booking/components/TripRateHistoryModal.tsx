"use client";

import { History } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { fmtBaht } from "./shared";
import type { TripRateSegment } from "@/features/travel-booking/lib/trip-rate-segments";

/**
 * The dated country per-diem rates **this trip** falls under.
 *
 * Modelled on `AllowanceHistoryModal` — same Dialog, same timeline, same
 * badge — with one difference that shapes everything: it takes its segments as a
 * prop rather than fetching. The HR modal asks a server for one employee's whole
 * log; this describes an intersection of a date range on screen with a rate list
 * already in the browser, and there is nothing to fetch that would know the
 * dates the requester has just typed.
 *
 * It is only ever opened when a trip spans **more than one** rate — a single
 * rate is already stated on the card and a dialog to repeat it would be a click
 * for nothing.
 */

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function TripRateHistoryModal({
  open,
  onClose,
  segments,
  countryLabel,
}: {
  open: boolean;
  onClose: () => void;
  segments: readonly TripRateSegment[];
  countryLabel: string | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title="เรทเบี้ยเลี้ยงที่ใช้กับทริปนี้"
      uniformSurface
    >
      <div className="flex flex-col gap-5">
        <div>
          <p
            className="text-[11px] font-bold uppercase tracking-wide mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            {countryLabel ? `ประเทศ ${countryLabel}` : "รายการเรทที่เข้าข่าย"}
          </p>
          <div className="relative">
            <div
              className="absolute left-2 top-1.5 bottom-1.5 w-px"
              style={{ background: "var(--border-card)" }}
            />
            <div className="flex flex-col gap-5">
              {segments.map((s, i) => {
                /* Dated newest-last here, unlike the HR modal's newest-first:
                   these are the legs of one trip in the order it is travelled,
                   and reversing them would put the return before the departure. */
                const unrated = s.effectiveDate === null;
                return (
                  <div key={`${s.effectiveDate ?? "none"}-${i}`} className="relative flex gap-3.5">
                    <div className="w-4 shrink-0 flex justify-center pt-0.5">
                      <span
                        className="rounded-full"
                        style={
                          unrated
                            ? {
                                width: 10,
                                height: 10,
                                background: "var(--bg-card)",
                                border: "2px solid var(--border-card)",
                              }
                            : {
                                width: 14,
                                height: 14,
                                background: "var(--nav-active-text)",
                                boxShadow: "0 0 0 3px var(--nav-active-bg)",
                              }
                        }
                      />
                    </div>
                    <div className="min-w-0 -mt-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[15px] font-bold tabular-nums"
                          style={{
                            color: unrated ? "var(--text-muted)" : "var(--nav-active-text)",
                          }}
                        >
                          ฿{fmtBaht(s.amount)}
                        </span>
                        <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                          / วัน
                        </span>
                        <span
                          className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                        >
                          {s.days} วัน
                        </span>
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {/* A null date is not a rate that started on some day — it
                            is the absence of one, and saying "มีผลตั้งแต่ —" would
                            read as a rate whose date nobody filled in. */}
                        {unrated
                          ? "ยังไม่มีเรทที่มีผลครอบคลุมวันเหล่านี้"
                          : `มีผลตั้งแต่ ${fmtDate(s.effectiveDate as string)}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <p
          className="text-[11px] flex items-center gap-1.5"
          style={{ color: "var(--text-faint)" }}
        >
          <History size={12} className="shrink-0" /> เรทกำหนดที่ตั้งค่าแบบฟอร์ม — คิดตามวันเดินทางของทริปนี้
        </p>
      </div>
    </Dialog>
  );
}
