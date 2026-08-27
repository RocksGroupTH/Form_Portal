"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Building2, Check, Circle, History, Info, Loader2, Mail, Phone, Plus, Save, Send, Trash2, User, UserCog, Wallet } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import { Avatar } from "@/components/ui/Avatar";
import { Dialog } from "@/components/ui/Dialog";
import { RequesterPickerModal } from "@/components/RequesterPickerModal";
import { UatDataBanner } from "@/components/UatDataBanner";
import { AllowanceHistoryModal } from "./AllowanceHistoryModal";
import { useUserPhoto } from "@/lib/hooks/useUserPhoto";
import { fmtYmdDisplay } from "@/features/accounting/lib/format-travel-dates";
import { useTravelBookingForm } from "@/features/travel-booking/hooks/useTravelBookingForm";
import { TravelBookingTab } from "./TravelBookingTab";
import { SectionCard, fmtBaht } from "./shared";
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";
import type { TravelBookingGroup } from "@/features/travel-booking/types";

interface TravelBookingFormProps {
  initial?: TravelBookingGroup | null;
  onSaved?: (groupKey: string) => void;
  onSubmitted?: (count: number, firstRequestId: number | null) => void;
}

/** Validation keys that share a field's anchor (their own input has no dedicated `data-field`). */
const FIELD_ANCHOR_FALLBACK: Record<string, string> = {
  accommodationCustom: "accommodation",
  goVehicleCustom: "goVehicle",
  returnVehicle: "goVehicle",
  returnVehicleCustom: "goVehicle",
  departTime: "goVehicle",
  returnTime: "goVehicle",
  goDepartureLocations: "goVehicle",
  returnDepartureLocations: "goVehicle",
  rentVehicleCustom: "rentVehicle",
};

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Interior days (exclusive of both endpoints) of a [depart, return] range, as YYYY-MM-DD. */
function interiorDays(depart: string | null, ret: string | null): string[] {
  if (!depart || !ret || ret <= depart) return [];
  const out: string[] = [];
  const cur = new Date(`${depart}T00:00:00`);
  const end = new Date(`${ret}T00:00:00`);
  cur.setDate(cur.getDate() + 1);
  while (cur < end) {
    out.push(`${cur.getFullYear()}-${pad2(cur.getMonth() + 1)}-${pad2(cur.getDate())}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Scroll the first missing field (by its `data-field` anchor) into view and focus its input. */
function scrollToField(key: string) {
  if (typeof document === "undefined") return;
  const find = (k: string) => document.querySelector<HTMLElement>(`[data-field="${k}"]`);
  const el = find(key) ?? (FIELD_ANCHOR_FALLBACK[key] ? find(FIELD_ANCHOR_FALLBACK[key]) : null);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select")?.focus({ preventScroll: true });
}

export function TravelBookingForm({ initial, onSaved, onSubmitted }: TravelBookingFormProps) {
  const form = useTravelBookingForm(initial);
  const {
    anchorRequestId,
    tabs, activeTabIndex, setActiveTabIndex, addTab, removeTab, updateTab,
    reasons, accommodations, vehicles, rentVehicles, provinces,
    employee, employeeHint, employeeEmail, employeeLoading, manager, managerReason,
    colleagues, colleaguesLoading, requesterEnvironment,
    existingRanges, requesterStaffId, setRequesterStaffId, selectedRequester,
    brandCode, setBrandCode, brands,
    continuationFlags, perDiemEstimates, totalPerDiemEstimate,
    tabIssues, canSubmit,
    saving, submitting, submitPhase, saveDraft, submitAll, uploadIdCard, removeIdCardFile,
  } = form;

  const [triedSubmit, setTriedSubmit] = useState(false);
  const [removeConfirmIndex, setRemoveConfirmIndex] = useState<number | null>(null);
  const [allowanceHistoryOpen, setAllowanceHistoryOpen] = useState(false);
  const [requesterPickerOpen, setRequesterPickerOpen] = useState(false);

  const sessionPhoto = useUserPhoto();
  const requesterPhoto = employee?.photoUrl ?? sessionPhoto;
  const requesterName = employee
    ? employee.firstName && employee.lastName
      ? `${employee.firstName} ${employee.lastName}`
      : employee.fullName
    : "";

  /* ── "Open on behalf of" — colleague display name for the requester note ── */
  const onBehalfName = selectedRequester?.fullName ?? (requesterStaffId ? `#${requesterStaffId}` : "");
  // Manager shown in the card: the selected colleague's manager when opening on behalf, else self's.
  const shownManager = requesterStaffId ? (selectedRequester?.manager ?? null) : manager;
  // In UAT the colleague's manager is their UAT manager, so the remedy for a
  // missing one is the tester list, not HR — pointing at HR there would end with
  // somebody asking HR to attach a real manager to test data.
  const shownManagerReason = requesterStaffId
    ? selectedRequester?.manager
      ? null
      : requesterEnvironment === "UAT"
        ? "โหมด UAT: เพื่อนที่เลือกยังไม่ได้กำหนดผู้จัดการสำหรับ UAT — ตั้งที่ Settings → UAT Users"
        : "เพื่อนที่เลือกยังไม่ได้กำหนดหัวหน้างานในระบบ HR"
    : managerReason;

  // Days already booked (interiors of the requester's other trips + this group's other tabs) —
  // locked in the current tab's date picker so ranges can't overlap (endpoints stay shareable).
  const lockedTravelDates = useMemo(() => {
    const set = new Set<string>();
    for (const rg of existingRanges) for (const d of interiorDays(rg.departDate, rg.returnDate)) set.add(d);
    tabs.forEach((t, i) => {
      if (i !== activeTabIndex) for (const d of interiorDays(t.departDate, t.returnDate)) set.add(d);
    });
    return Array.from(set);
  }, [existingRanges, tabs, activeTabIndex]);

  // `shownManager`, not `manager`: on behalf of a colleague the submit assigns
  // *their* manager, so gating on the actor's would both block a submit that is
  // fine and let one through whose requester has nobody to approve it.
  const overallCanSubmit =
    canSubmit && (employeeLoading || colleaguesLoading || !!shownManager);

  const handleSaveDraft = useCallback(async () => {
    const saved = await saveDraft();
    if (saved) {
      toast.success("บันทึกร่างแล้ว");
      onSaved?.(saved.groupKey);
    }
  }, [saveDraft, onSaved]);

  const handleSubmit = useCallback(async () => {
    setTriedSubmit(true);
    if (!overallCanSubmit) {
      toast.error("กรุณากรอกข้อมูลให้ครบก่อนส่งคำขอ");
      // Jump to the first tab with a missing field and focus it (else the requester/manager at top).
      const badTab = tabIssues.findIndex((iss) => iss.length > 0);
      if (badTab >= 0) {
        const key = tabIssues[badTab][0]?.key;
        if (badTab !== activeTabIndex) setActiveTabIndex(badTab);
        requestAnimationFrame(() => requestAnimationFrame(() => { if (key) scrollToField(key); }));
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      return;
    }
    const result = await submitAll();
    if (!result.ok) {
      toast.error(result.error ?? "ส่งคำขอไม่สำเร็จ");
      return;
    }
    toast.success(`ส่งคำขอ ${result.count ?? tabs.length} ใบแล้ว`);
    onSubmitted?.(result.count ?? tabs.length, result.firstRequestId ?? null);
  }, [overallCanSubmit, submitAll, onSubmitted, tabs.length, tabIssues, activeTabIndex, setActiveTabIndex]);

  const activeTab = tabs[activeTabIndex] ?? tabs[0];

  const confirmRemove = (index: number) => {
    if (tabs.length <= 1) return;
    setRemoveConfirmIndex(index);
  };

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-4 min-w-0">
      {/*
        Which set of books this group belongs to, before anything a reader could
        act on — ahead of the guidance box too, because guidance about the form
        matters less than which database it writes to.

        `anchorRequestId`, not the resumed prop: it starts as the resumed
        group's first request id and picks up the id the server hands back on
        first save, so a brand-new group is labelled from the moment it becomes
        a row. A group with no id yet is blank and the banner renders nothing.
      */}
      {/* -mb-4 cancels the banner's own margin so the parent's gap-4 is the only
          spacing; empty:hidden keeps the wrapper from becoming a phantom flex
          child on every blank form, where the banner renders nothing. */}
      <div className="-mb-4 empty:hidden">
        <UatDataBanner requestId={anchorRequestId} holdSpace={false} />
      </div>

      {/* คำแนะนำ */}
      <div
        data-tour="ap17-notice"
        className="rounded-2xl px-4 py-3.5 flex items-start gap-2.5"
        style={{
          background: "color-mix(in srgb, var(--color-action) 8%, var(--bg-card))",
          border: "1px solid color-mix(in srgb, var(--color-action) 25%, var(--border-card))",
        }}
      >
        <Info size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-action)" }} />
        <div className="flex flex-col gap-1">
          {AP17_HEADER_MESSAGE_LINES.map((line, i) => (
            <p key={i} className="text-[12.5px] leading-relaxed m-0" style={{ color: "var(--text-secondary)" }}>
              {line}
            </p>
          ))}
        </div>
      </div>

      {/* แบรนด์ที่เบิก — AP-1's chips, over AP-17's own AccFormBrand rows. */}
      <SectionCard icon={<Building2 size={15} />} title="แบรนด์ที่เบิก">
        {brands.length === 0 ? (
          // Not an empty row of chips: nothing has gone wrong with the page,
          // the form simply has no brand granted yet and cannot be submitted
          // until one is. Nothing is seeded — that was deliberate.
          <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
            ยังไม่ได้ตั้งค่าแบรนด์ที่เบิกได้สำหรับฟอร์มนี้ — ติดต่อผู้ดูแลระบบ
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {brands.map((b) => {
              const active = brandCode === b.brandCode;
              return (
                <button
                  key={b.brandCode}
                  type="button"
                  onClick={() => setBrandCode(active ? null : b.brandCode)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-[14px] font-semibold transition-all"
                  style={{
                    borderWidth: 2,
                    borderStyle: "solid",
                    borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                    background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                    color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                  }}
                >
                  <BrandMark src={b.brandLogo} alt="" code={b.brandCode} size={20} rounded="rounded" />
                  {b.brandName}
                  {active && <Check size={14} />}
                </button>
              );
            })}
          </div>
        )}
      </SectionCard>

      {/* ผู้ขอเบิก (read-only) */}
      <SectionCard
        dataTour="ap17-requester"
        icon={<User size={15} />}
        title="ผู้ขอเบิก"
        extra={(
          /* See AP-1's copy of this button — the department-size gate it used
             to carry hid the picker from anyone alone in their department. */
          <button
            type="button"
            onClick={() => setRequesterPickerOpen(true)}
            className="hover-run-border shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--nav-active-text)" }}
          >
            <UserCog size={13} /> เปลี่ยนผู้ขอเบิก
          </button>
        )}
      >
        {employeeLoading ? (
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-12 h-12 rounded-2xl animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
            <div className="flex-1 flex flex-col gap-2">
              <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
              <div className="h-3 w-48 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
            </div>
          </div>
        ) : !employee ? (
          <div
            className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
            style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-card)" }}
          >
            ไม่พบข้อมูลพนักงานสำหรับอีเมล <b>{employeeEmail ?? "-"}</b> ในระบบ HR
            {employeeHint ? ` — ${employeeHint}` : ""}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
            {/* requester */}
            <div className="flex flex-col gap-2.5 min-w-0">
              <RequesterPickerModal
                open={requesterPickerOpen}
                onClose={() => setRequesterPickerOpen(false)}
                colleagues={colleagues}
                searchEndpoint="/api/request/travel-booking/requesters"
                self={employee ? {
                  staffId: employee.staffId,
                  fullName: requesterName || employee.fullName,
                  departmentName: employee.departmentName ?? null,
                  position: employee.position ?? null,
                  email: employee.email ?? employee.emailCompBr ?? null,
                  photoUrl: requesterPhoto,
                } : null}
                value={requesterStaffId}
                onSelect={setRequesterStaffId}
              />
              {requesterStaffId ? (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                    <Avatar name={selectedRequester?.fullName || "?"} size={48} photo={selectedRequester?.photoUrl ?? undefined} color="var(--nav-active-text)" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{selectedRequester?.fullName ?? `#${requesterStaffId}`}</span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{requesterStaffId}</span>
                    </div>
                    {(selectedRequester?.departmentName || selectedRequester?.position) && (
                      <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                        {[selectedRequester?.departmentName, selectedRequester?.position].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {selectedRequester?.email && (
                      <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                        <Mail size={11} className="shrink-0" /> <span className="truncate">{selectedRequester.email}</span>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                    <Avatar name={requesterName || employee.fullName || "?"} size={48} photo={requesterPhoto} color="var(--nav-active-text)" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{requesterName || "-"}</span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{employee.staffId}</span>
                    </div>
                    {(employee.departmentName || employee.position) && (
                      <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                        {[employee.departmentName, employee.position].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-[12px]" style={{ color: "var(--text-secondary)" }}>
                      <span className="inline-flex items-center gap-1"><Phone size={11} /> {employee.phone ?? "-"}</span>
                      <button
                        type="button"
                        onClick={() => setAllowanceHistoryOpen(true)}
                        className="inline-flex items-center gap-1 cursor-pointer border-none bg-transparent p-0"
                        style={{ color: "var(--nav-active-text)" }}
                        title="ดูประวัติเบี้ยเลี้ยง"
                      >
                        <Wallet size={11} /> ฿{employee.allowance != null ? fmtBaht(employee.allowance) : "-"}/วัน
                        <History size={11} className="opacity-70" />
                      </button>
                    </div>
                    {(employee.email || employee.emailCompBr) && (
                      <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                        <Mail size={11} className="shrink-0" /> <span className="truncate">{employee.email ?? employee.emailCompBr}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
              {requesterStaffId && (
                <span className="text-[12px] mt-1 px-3 py-2 rounded-lg" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
                  กำลังกรอกแทน {onBehalfName} — คำขอจะอยู่ใน “คำขอของฉัน” ของคุณ และผู้อนุมัติจะเป็นหัวหน้าของผู้ขอเบิก
                </span>
              )}
            </div>

            {/* manager */}
            <div className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6">
              {shownManager ? (
                <>
                  <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                    <Avatar name={shownManager.fullName || "?"} size={48} photo={shownManager.photoUrl ?? undefined} color="var(--nav-active-text)" />
                  </div>
                  <div className="min-w-0 flex flex-col gap-0.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>หัวหน้างาน (ผู้จัดการ)</span>
                    <div className="flex items-baseline gap-2 min-w-0">
                      <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{shownManager.fullName ?? "-"}</span>
                      <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{shownManager.staffId}</span>
                    </div>
                    {shownManager.position && <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>{shownManager.position}</span>}
                    {shownManager.email && (
                      <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                        <Mail size={11} className="shrink-0" /> <span className="truncate">{shownManager.email}</span>
                      </span>
                    )}
                    {requesterStaffId && (
                      <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>หัวหน้างานของผู้ขอเบิก</span>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>หัวหน้างาน (ผู้จัดการ)</span>
                  <p className="text-[12.5px] m-0 flex items-start gap-1.5" style={{ color: "var(--color-danger)" }}>
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    {shownManagerReason ?? "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR — ไม่สามารถส่งคำขอได้"}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </SectionCard>

      {/* แท็บคำขอ */}
      <div
        data-tour="ap17-tabs"
        className="sticky top-14 md:top-12 z-30 rounded-2xl overflow-hidden"
        style={{
          background: "color-mix(in srgb, var(--bg-card) 92%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          border: "1px solid var(--border-card)",
          boxShadow: "0 4px 16px -8px rgba(0,0,0,0.12)",
        }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 overflow-x-auto no-scrollbar">
          {tabs.map((t, i) => {
            const active = i === activeTabIndex;
            const complete = tabIssues[i]?.length === 0;
            const showIncomplete = triedSubmit && !complete;
            return (
              <div key={i} className="flex items-stretch shrink-0 h-10 rounded-xl overflow-hidden" style={{
                borderWidth: 1.5, borderStyle: "solid",
                borderColor: showIncomplete ? "var(--color-danger)" : active ? "var(--nav-active-text)" : "var(--border-card)",
                background: active ? "var(--nav-active-bg)" : complete ? "color-mix(in srgb, var(--positive, #15b357) 5%, var(--bg-card))" : "var(--bg-card)",
              }}>
                <button
                  type="button"
                  onClick={() => setActiveTabIndex(i)}
                  className="flex items-center gap-1.5 h-full px-3 cursor-pointer border-none bg-transparent"
                >
                  <span
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                    style={complete
                      ? { background: "var(--positive, #15b357)", color: "#fff" }
                      : active
                        ? { background: "var(--nav-active-text)", color: "#fff" }
                        : { background: "var(--bg-card-alt)", color: "var(--text-muted)" }}
                  >
                    {complete ? <Check size={12} /> : i + 1}
                  </span>
                  <span className="text-[13px] font-semibold whitespace-nowrap" style={{ color: active ? "var(--nav-active-text)" : "var(--text-primary)" }}>
                    ทริป {i + 1}
                  </span>
                </button>
                {tabs.length > 1 && (
                  <button
                    type="button"
                    onClick={() => confirmRemove(i)}
                    aria-label={`ลบทริป ${i + 1}`}
                    title="ลบทริปนี้"
                    className="shrink-0 w-8 h-full flex items-center justify-center cursor-pointer border-none bg-transparent opacity-50 hover:opacity-100"
                    style={{ color: active ? "var(--nav-active-text)" : "var(--text-faint)", borderLeft: "1px solid var(--border-light)" }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={addTab}
            className="shrink-0 h-10 flex items-center gap-1.5 rounded-xl px-3 cursor-pointer border transition-all"
            style={{ background: "var(--bg-card)", borderColor: "var(--border-card)", color: "var(--text-secondary)" }}
          >
            <Plus size={14} style={{ color: "var(--nav-active-text)" }} />
            <span className="text-[12px] font-semibold whitespace-nowrap">เพิ่มทริป</span>
          </button>
        </div>
      </div>

      {/* เนื้อหาแท็บที่เลือก */}
      {activeTab && (
        <TravelBookingTab
          tab={activeTab}
          isContinuation={continuationFlags[activeTabIndex] ?? false}
          perDiemEstimate={perDiemEstimates[activeTabIndex] ?? { days: 0, total: 0, groups: [] }}
          allowanceRate={employee?.allowance ?? null}
          reasons={reasons}
          accommodations={accommodations}
          vehicles={vehicles}
          rentVehicles={rentVehicles}
          provinces={provinces}
          disabledTravelDates={lockedTravelDates}
          issues={tabIssues[activeTabIndex] ?? []}
          triedSubmit={triedSubmit}
          requesterStaffId={requesterStaffId}
          onChange={(patch) => updateTab(activeTabIndex, patch)}
          onSelectPendingIdCard={(file) => updateTab(activeTabIndex, { pendingIdCard: file })}
          onRemoveIdCardFile={(fileId) => removeIdCardFile(activeTabIndex, fileId)}
        />
      )}

      {/* Footer: สรุปรวม + ปุ่มบันทึก/ส่ง */}
      <div
        data-tour="ap17-submit"
        className="sticky bottom-3 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            Per diem รวมทุกคำขอ (ประมาณการ)
          </span>
          <span className="text-[16px] font-bold" style={{ color: "var(--text-heading)" }}>
            ฿{fmtBaht(totalPerDiemEstimate)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={saving || submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer disabled:opacity-60"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
          >
            <Save size={14} />
            {saving ? "กำลังบันทึก..." : "บันทึกร่าง"}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || submitting}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-bold cursor-pointer border-none text-white disabled:opacity-60"
            style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
          >
            <Send size={14} />
            {submitting ? "กำลังส่งคำขอ..." : `ส่งคำขอ (${tabs.length} ใบ)`}
          </button>
        </div>
      </div>

      {/* ยืนยันการลบทริป */}
      <Dialog
        open={removeConfirmIndex != null}
        onOpenChange={(v) => { if (!v) setRemoveConfirmIndex(null); }}
        title="ยืนยันการลบทริป"
        uniformSurface
      >
        <p className="text-[14px] mb-6" style={{ color: "var(--text-secondary)" }}>
          ลบทริป {removeConfirmIndex != null ? removeConfirmIndex + 1 : ""} ออกจากคำขอนี้?
          ข้อมูลและไฟล์แนบในแท็บนี้จะถูกลบทันที (สำหรับคำขอที่บันทึกร่างไว้แล้ว)
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setRemoveConfirmIndex(null)}
            className="text-[14px] font-medium px-4 py-2 rounded-lg cursor-pointer"
            style={{ color: "var(--text-secondary)", background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => {
              if (removeConfirmIndex != null) removeTab(removeConfirmIndex);
              setRemoveConfirmIndex(null);
            }}
            className="inline-flex items-center gap-1.5 text-[14px] font-bold px-4 py-2 rounded-lg cursor-pointer border-none"
            style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)" }}
          >
            ยืนยันลบทริป
          </button>
        </div>
      </Dialog>

      {/* กำลังส่งคำขอ — blocking progress modal (no close button, ignores dismiss attempts) */}
      <Dialog
        open={submitting}
        onOpenChange={() => {}}
        title="กำลังส่งคำขอ"
        uniformSurface
        hideCloseButton
      >
        <div className="flex flex-col gap-4">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            ระบบกำลังดำเนินการ {tabs.length > 1 ? `${tabs.length} ใบ` : ""} กรุณาอย่าปิดหน้านี้
          </p>

          <div className="flex flex-col gap-2.5">
            <SubmitStep
              label="บันทึกข้อมูลคำขอและไฟล์แนบ"
              state={submitPhase === "saving" ? "running" : "done"}
            />
            <SubmitStep
              label="ส่งเข้าระบบอนุมัติและออกเลขที่คำขอ"
              state={submitPhase === "submitting" ? "running" : "waiting"}
            />
          </div>

          {/* หลายใบ — list what is being sent so the requester can see the whole batch */}
          {tabs.length > 1 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
              <p
                className="text-[11px] font-bold m-0 px-3.5 py-2"
                style={{ background: "var(--bg-card-header)", color: "var(--text-secondary)", borderBottom: "1px solid var(--border-light)" }}
              >
                รายการที่กำลังส่ง ({tabs.length} ใบ)
              </p>
              <div className="flex flex-col">
                {tabs.map((t, i) => {
                  const province = provinces.find((p) => p.id === t.provinceId)?.nameTh ?? null;
                  const range = [t.departDate, t.returnDate]
                    .filter((d): d is string => !!d)
                    .map(fmtYmdDisplay)
                    .join(" – ");
                  return (
                    <div
                      key={i}
                      className="flex items-center gap-2.5 px-3.5 py-2.5"
                      style={i > 0 ? { borderTop: "1px solid var(--border-light)" } : undefined}
                    >
                      <span
                        className="w-5 h-5 shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold"
                        style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-[12.5px] font-semibold shrink-0" style={{ color: "var(--text-heading)" }}>
                        ทริป {i + 1}
                      </span>
                      <span className="text-[11.5px] truncate min-w-0" style={{ color: "var(--text-muted)" }}>
                        {[province, range].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </Dialog>

      <AllowanceHistoryModal open={allowanceHistoryOpen} onClose={() => setAllowanceHistoryOpen(false)} requesterStaffId={requesterStaffId} />
    </div>
  );
}

/** One line of the submit progress list: done ✓ / running ⟳ / not started ○. */
function SubmitStep({ label, state }: { label: string; state: "waiting" | "running" | "done" }) {
  return (
    <div className="flex items-center gap-2.5">
      {state === "done" ? (
        <Check size={15} className="shrink-0" style={{ color: "var(--text-info-green)" }} />
      ) : state === "running" ? (
        <Loader2 size={15} className="animate-spin shrink-0" style={{ color: "var(--nav-active-text)" }} />
      ) : (
        <Circle size={15} className="shrink-0" style={{ color: "var(--text-faint)" }} />
      )}
      <span
        className="text-[13px]"
        style={{
          color: state === "waiting" ? "var(--text-faint)" : "var(--text-primary)",
          fontWeight: state === "running" ? 700 : 400,
        }}
      >
        {label}
      </span>
    </div>
  );
}
