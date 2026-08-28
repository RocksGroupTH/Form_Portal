"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import {
  Save,
  Send,
  Check,
  User,
  MapPin,
  Car,
  Receipt,
  FileCheck,
  Copy,
  CircleCheck,
  CircleAlert,
  Briefcase,
  Lock,
  X,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  Mail,
  UserCog,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui";
import { Dialog } from "@/components/ui/Dialog";
import { Avatar } from "@/components/ui/Avatar";
import { RequesterPickerModal } from "@/components/RequesterPickerModal";
import { UatDataBanner } from "@/components/UatDataBanner";
import { useUserPhoto } from "@/lib/hooks/useUserPhoto";
import { useGoogleMapsApiKey } from "@/lib/hooks/useGoogleMapsApiKey";
import { useTravelExpenseForm } from "@/features/accounting/hooks/useTravelExpenseForm";
import { FilterMultiDatePicker } from "@/features/accounting/components/FilterMultiDatePicker";
import { fmtTravelDatesList } from "@/features/accounting/lib/format-travel-dates";
import { DistanceMapField } from "./DistanceMapField";
import { ExpenseRows } from "./ExpenseRows";
import { computeTotalAmount, computeTotalDistance } from "@/lib/acc/calc";
import {
  allDayItems,
  formatDayVehicleNames,
  hasRateVehicle,
  normalizeTravelDay,
  selectedVehicleCount,
} from "@/features/accounting/lib/travel-sections";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import type { AccRequest, TravelDraftSummary, TravelExpenseDetail, TravelExpenseItem, AccVehicle } from "@/features/accounting/types";
import { AP1_HEADER_MESSAGE_LINES, MAPS_UNAVAILABLE_USER_MESSAGE } from "@/features/accounting/constants";

/* ── Props ── */

interface TravelExpenseFormProps {
  initial?: AccRequest | null;
  onSaved?: (id: number) => void;
  onSubmitted?: (id: number) => void;
  /** Called when Save is blocked because the travel date already exists in another draft. */
  onDuplicateDraftDate?: (drafts: TravelDraftSummary[]) => void;
}

/* ── Helpers ── */

/** Format today as YYYY-MM-DD using local date getters */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Format date 1 month ago as YYYY-MM-DD */
function minDateStr(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

import { fmtDayChipDate } from "@/features/accounting/lib/format-travel-dates";

const inputClass = "w-full rounded-lg px-3 py-2 text-[14px] outline-none";
const inputStyle: React.CSSProperties = {
  background: "var(--bg-input)",
  color: "var(--text-primary)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-input)",
};
const readonlyStyle: React.CSSProperties = {
  background: "var(--bg-card-alt)",
  color: "var(--text-secondary)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "var(--border-card)",
};
const labelClass = "block text-[12px] font-semibold mb-1.5 uppercase tracking-wide";
const labelStyle: React.CSSProperties = { color: "var(--text-muted)" };
const requiredStar = (
  <span style={{ color: "var(--color-danger)" }}> *</span>
);

/* ── Section card wrapper ── */

function SectionCard({
  icon,
  title,
  extra,
  children,
  dataTour,
}: {
  icon: React.ReactNode;
  title: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className="w-full min-w-0 rounded-2xl overflow-hidden"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {/* Card header */}
      <div
        className="flex items-center gap-2.5 px-5 py-3 rounded-t-2xl"
        style={{
          borderBottom: "1px solid var(--border-card)",
          background: "var(--bg-card-header)",
        }}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: "var(--nav-active-bg)",
            color: "var(--nav-active-text)",
          }}
        >
          {icon}
        </span>
        <h3
          className="text-[14px] font-bold flex-1 min-w-0"
          style={{ color: "var(--text-heading)" }}
        >
          {title}
        </h3>
        {extra}
      </div>

      {/* Card body */}
      <div className="px-5 py-4 flex flex-col gap-4 min-w-0">{children}</div>
    </div>
  );
}

function SectionLockedHint({ message }: { message: string }) {
  return (
    <div
      className="rounded-xl px-4 py-3.5 text-[13px] leading-relaxed flex items-start gap-2.5"
      style={{
        background: "var(--bg-card-alt)",
        color: "var(--text-muted)",
        border: "1px solid var(--border-light)",
      }}
    >
      <Lock size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-faint)" }} />
      <span>{message}</span>
    </div>
  );
}

/* ── Direction segmented buttons ── */

const DIRECTIONS = [
  { value: "round", label: "ไป-กลับ" },
  { value: "onward", label: "ขาไป" },
  { value: "return", label: "ขากลับ" },
] as const;

/* ── Main Component ── */

export function TravelExpenseForm({
  initial,
  onSaved,
  onSubmitted,
  onDuplicateDraftDate,
}: TravelExpenseFormProps) {
  const [requestId, setRequestId] = useState<number | null>(
    initial?.id ?? null
  );
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  const [removeDateConfirm, setRemoveDateConfirm] = useState<string | null>(null);
  const [blockedTravelDates, setBlockedTravelDates] = useState<string[]>([]);

  // Refs for scrolling/focusing the first incomplete field on a submit attempt.
  const brandRef = useRef<HTMLDivElement>(null);
  const dateRef = useRef<HTMLDivElement>(null);
  const workDetailRef = useRef<HTMLTextAreaElement>(null);
  const vehicleRef = useRef<HTMLDivElement>(null);
  const managerRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLDivElement>(null);
  const activePillRef = useRef<HTMLButtonElement>(null);
  const dayStripRef = useRef<HTMLDivElement>(null);

  const {
    travel,
    travelDays,
    activeDayIndex,
    setActiveDayIndex,
    selectedTravelDates,
    setTravelDates,
    duplicateDay,
    setField,
    brandCode,
    setBrandCode,
    brands,
    vehicles,
    employee,
    employeeHint,
    employeeEmail,
    employeeLoading,
    manager,
    managerReason,
    colleagues,
    colleaguesLoading,
    requesterEnvironment,
    requesterStaffId,
    setRequesterStaffId,
    selectedRequester,
    requestTotalAmount,
    visible,
    addItem,
    updateItem,
    removeItem,
    toggleVehicle,
    isVehicleActive,
    hasAnyVehicle,
    manualSections,
    addSectionItem,
    updateSectionItem,
    removeSectionItem,
    setOnwardLeg,
    setReturnLeg,
    reloadFromServer,
  } = useTravelExpenseForm(initial);

  const { configured: mapsConfigured, loading: mapsKeyLoading } = useGoogleMapsApiKey();

  // Scroll active chip inside the strip only — avoid scrollIntoView (scrolls the whole page).
  useEffect(() => {
    const strip = dayStripRef.current;
    const pill = activePillRef.current;
    if (!strip || !pill) return;
    const stripRect = strip.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const delta =
      pillRect.left + pillRect.width / 2 - (stripRect.left + stripRect.width / 2);
    strip.scrollTo({ left: strip.scrollLeft + delta, behavior: "smooth" });
  }, [activeDayIndex]);

  const goToDay = useCallback(
    (delta: number) =>
      setActiveDayIndex(Math.min(travelDays.length - 1, Math.max(0, activeDayIndex + delta))),
    [setActiveDayIndex, travelDays.length, activeDayIndex],
  );

  const handleToggleVehicle = useCallback(
    (v: AccVehicle) => {
      if (!v.isManualEntry && !mapsKeyLoading && !mapsConfigured) {
        toast.error(MAPS_UNAVAILABLE_USER_MESSAGE);
      }
      toggleVehicle(v.id);
    },
    [toggleVehicle, mapsConfigured, mapsKeyLoading],
  );

  const showMapsUnavailableNotice =
    !mapsKeyLoading && !mapsConfigured && visible.direction;

  const travelDetailsReady = !!brandCode && selectedTravelDates.length > 0;
  const travelDetailsLockedMessage = !brandCode && selectedTravelDates.length === 0
    ? "กรุณาเลือกแบรนด์ที่เบิกและวันเดินทางในส่วนรายละเอียดการเดินทางด้านบนก่อน"
    : !brandCode
      ? "กรุณาเลือกแบรนด์ที่เบิกก่อน"
      : "กรุณาเลือกวันเดินทางก่อน";

  // Whose blocked days to grey out. `requesterStaffId` is in the dependency list
  // and in the query string because the answer changes the moment เปลี่ยนผู้ขอเบิก
  // picks somebody else: without it the picker showed the filer's own conflicts
  // while filing for a colleague — hiding the colleague's real ones, which then
  // surfaced as a rejection at submit.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (requestId != null) params.set("excludeId", String(requestId));
    if (brandCode) params.set("brandCode", brandCode);
    if (requesterStaffId) params.set("requesterStaffId", String(requesterStaffId));
    const qs = params.toString();
    fetch(`/api/request/accounting/requests/blocked-travel-dates${qs ? `?${qs}` : ""}`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: string[] }) => {
        if (cancelled) return;
        setBlockedTravelDates(json.ok && json.data ? json.data : []);
      })
      .catch(() => { if (!cancelled) setBlockedTravelDates([]); });
    return () => { cancelled = true; };
  }, [requestId, brandCode, requesterStaffId]);

  const sessionPhoto = useUserPhoto();
  const requesterPhoto = employee?.photoUrl ?? sessionPhoto;

  /* ── Computed onward / return leg values ── */
  const onwardLegValue =
    travel.onwardOrigin || travel.onwardDestination || (travel.onwardWaypoints?.length ?? 0) > 0
    ? {
        origin: travel.onwardOrigin ?? "",
        originLat: travel.onwardOriginLat ?? 0,
        originLng: travel.onwardOriginLng ?? 0,
        destination: travel.onwardDestination ?? "",
        destLat: travel.onwardDestLat ?? 0,
        destLng: travel.onwardDestLng ?? 0,
        distanceKm: travel.onwardDistanceKm ?? 0,
        waypoints: travel.onwardWaypoints ?? undefined,
      }
    : null;

  const returnLegValue =
    travel.returnOrigin || travel.returnDestination || (travel.returnWaypoints?.length ?? 0) > 0
    ? {
        origin: travel.returnOrigin ?? "",
        originLat: travel.returnOriginLat ?? 0,
        originLng: travel.returnOriginLng ?? 0,
        destination: travel.returnDestination ?? "",
        destLat: travel.returnDestLat ?? 0,
        destLng: travel.returnDestLng ?? 0,
        distanceKm: travel.returnDistanceKm ?? 0,
        waypoints: travel.returnWaypoints ?? undefined,
      }
    : null;

  /* ── Employee display name ── */
  const employeeName = employee
    ? employee.firstName && employee.lastName
      ? `${employee.firstName} ${employee.lastName}`
      : employee.fullName
    : "";

  /* ── "Open on behalf of" — colleague display name for the requester note ── */
  const onBehalfName = selectedRequester?.fullName ?? (requesterStaffId ? `#${requesterStaffId}` : "");
  const [requesterPickerOpen, setRequesterPickerOpen] = useState(false);
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

  /* ── Client-side completeness (mirrors server validateForSubmit) ── */
  function fmtDayTabLabel(d: TravelExpenseDetail, index: number): string {
    if (d.travelDate) {
      const p = d.travelDate.split("-");
      if (p.length === 3) return `${p[2]}/${p[1]}`;
    }
    return `วัน ${index + 1}`;
  }

  function fmtDayAmount(amount: number): string {
    return amount.toLocaleString("th-TH", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  const dayLabel = (i: number) =>
    travelDays.length > 1 ? ` (${fmtDayTabLabel(travelDays[i], i)})` : "";

  const missing: { key: string; label: string }[] = [];
  // `shownManager`, not `manager`: on behalf of a colleague the submit assigns
  // *their* manager, so gating on the actor's would both block a submit that is
  // fine and let one through whose requester has nobody to approve it.
  if (!employeeLoading && !colleaguesLoading && !shownManager) {
    missing.push({ key: "manager", label: "ผู้จัดการ (ManagerStaffId)" });
  }
  if (!brandCode) missing.push({ key: "brand", label: "แบรนด์ที่เบิก" });
  if (selectedTravelDates.length === 0) {
    missing.push({ key: "travelDate", label: "วันที่เดินทาง (เลือกอย่างน้อย 1 วัน)" });
  }

  if (travelDetailsReady) {
  for (let di = 0; di < travelDays.length; di++) {
    const day = normalizeTravelDay(travelDays[di]);
    const lbl = dayLabel(di);
    const dayKey = `day-${di}`;
    if (!day.workDetail?.trim()) missing.push({ key: `${dayKey}-workDetail`, label: `รายละเอียดการไปปฏิบัติงาน${lbl}` });
    if (selectedVehicleCount(day) === 0) {
      missing.push({ key: `${dayKey}-vehicle`, label: `พาหนะ${lbl}` });
    }
    if (hasRateVehicle(day)) {
      if (!day.direction) missing.push({ key: `${dayKey}-direction`, label: `ทิศทางการเดินทาง${lbl}` });
      if (day.direction !== "return" && !(day.onwardDistanceKm && day.onwardDistanceKm > 0)) {
        missing.push({ key: `${dayKey}-onward`, label: `ระยะทางขาไป${lbl}` });
      }
      if (day.direction !== "onward" && !(day.returnDistanceKm && day.returnDistanceKm > 0)) {
        missing.push({ key: `${dayKey}-return`, label: `ระยะทางขากลับ${lbl}` });
      }
    }
    for (let si = 0; si < (day.sections ?? []).length; si++) {
      const sec = day.sections![si];
      if (!sec.items.some((i) => i.itemType === "fare" && i.amount > 0)) {
        missing.push({
          key: `${dayKey}-fare-${si}`,
          label: `ค่าโดยสาร (${sec.vehicleName ?? "พาหนะ"})${lbl}`,
        });
      }
    }
    if (
      !hasRateVehicle(day) &&
      day.isManualEntry &&
      (!day.sections || day.sections.length === 0) &&
      !day.items.some((i) => i.itemType === "fare" && i.amount > 0)
    ) {
      missing.push({ key: `${dayKey}-fare`, label: `ค่าโดยสาร / ค่าเดินทาง${lbl}` });
    }
    const itemHasImage = (it: { files?: unknown[]; pendingFiles?: unknown[] }) =>
      (it.files?.length ?? 0) > 0 || (it.pendingFiles?.length ?? 0) > 0;
    if (allDayItems(day).some((it) => Number(it.amount) > 0 && !itemHasImage(it))) {
      missing.push({ key: `${dayKey}-receipt`, label: `แนบรูปใบเสร็จรายการค่าใช้จ่าย${lbl}` });
    }
  }
  }

  const requestLevelMissing = missing.filter((m) => !m.key.startsWith("day-"));
  const dayMissingByIndex = travelDays.map((_, i) =>
    missing.filter((m) => m.key.startsWith(`day-${i}-`)),
  );

  const canSubmit = missing.length === 0;
  const missingKeys = new Set(missing.map((m) => m.key));
  /** Red highlight only after a failed submit attempt, while still missing. */
  const showErr = (key: string) => triedSubmit && missingKeys.has(key);
  const showErrField = (key: string) => triedSubmit && missingKeys.has(key);
  const showErrDay = (suffix: string) =>
    triedSubmit && (
      (suffix === "travelDate" && missingKeys.has("travelDate")) ||
      (suffix === "brand" && missingKeys.has("brand")) ||
      missing.some((m) => m.key === `day-${activeDayIndex}-${suffix}`)
    );
  const errInputStyle = (suffix: string): React.CSSProperties =>
    showErrDay(suffix)
      ? {
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "var(--color-danger)",
          boxShadow: "0 0 0 1px var(--color-danger)",
        }
      : {};
  const errLabelStyle = (suffix: string): React.CSSProperties =>
    showErrField(suffix) || showErrDay(suffix) ? { color: "var(--color-danger)" } : labelStyle;

  const handleCopyDayClick = useCallback(() => {
    if (travelDays.length <= 1) return;
    setCopyPickerOpen(true);
  }, [travelDays.length]);

  const handleCopyFromDay = useCallback(
    (sourceIndex: number) => {
      if (sourceIndex === activeDayIndex) {
        toast.error("ไม่สามารถคัดลอกจากวันที่เลือกอยู่ได้");
        return;
      }
      duplicateDay(sourceIndex, activeDayIndex);
      setCopyPickerOpen(false);
      toast.success(
        `คัดลอกจาก ${fmtDayTabLabel(travelDays[sourceIndex], sourceIndex)} ไป ${fmtDayTabLabel(travel, activeDayIndex)} แล้ว`,
      );
    },
    [duplicateDay, activeDayIndex, travelDays, travel],
  );

  const copySourceDays = travelDays
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i !== activeDayIndex);

  const handleConfirmRemoveDate = useCallback(() => {
    if (!removeDateConfirm) return;
    setTravelDates(selectedTravelDates.filter((d) => d !== removeDateConfirm));
    setRemoveDateConfirm(null);
  }, [removeDateConfirm, selectedTravelDates, setTravelDates]);

  /** Scroll to + focus the first incomplete field. */
  const focusFirstMissing = useCallback(() => {
    const first = missing[0]?.key;
    if (!first) return;
    const dayMatch = first.match(/^day-(\d+)-/);
    if (dayMatch) setActiveDayIndex(Number(dayMatch[1]));
    const suffix = dayMatch ? first.replace(/^day-\d+-/, "") : first;

    // Deferred a frame: a `data-field` inside a per-day block does not exist in
    // the DOM until React has rendered the day just switched to above.
    requestAnimationFrame(() => {
      const el: HTMLElement | null =
        // Markup claims its own key first. The chain below only knows the
        // handful of names somebody remembered to add to it, and **everything
        // else fell through to `vehicleRef`** — so a missing ค่าโดยสาร, whose
        // key is `day-N-fare-0`, scrolled to the vehicle picker instead of to
        // the expense block that was actually incomplete. A new block now needs
        // a `data-field`, not an extra arm here.
        document.querySelector<HTMLElement>(`[data-field="${suffix}"]`)
        ?? (suffix === "manager" || first === "manager" ? managerRef.current
        : suffix === "travelDate" ? dateRef.current
        : suffix === "workDetail" ? workDetailRef.current
        : suffix === "brand" || first === "brand" ? brandRef.current
        : suffix === "receipt" ? receiptRef.current
        : vehicleRef.current);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus();
        else el.focus?.();
      }
    });
  }, [missing, setActiveDayIndex]);

  const buildItemsForSave = useCallback(
    (items: TravelExpenseItem[]) =>
      items.map((it, i) => ({
        id: it.id,
        itemType: it.itemType,
        amount: it.amount,
        sortOrder: i,
      })),
    [],
  );

  const buildTravelDaysForSave = useCallback(
    () =>
      travelDays.map((d, i) => {
        const day = normalizeTravelDay(d);
        return {
          ...day,
          sortOrder: i,
          items: buildItemsForSave(day.items),
          sections: (day.sections ?? []).map((sec, si) => ({
            id: sec.id,
            sortOrder: si,
            vehicleId: sec.vehicleId,
            vehicleName: sec.vehicleName,
            ratePerKm: sec.ratePerKm,
            isManualEntry: sec.isManualEntry,
            items: buildItemsForSave(sec.items ?? []),
          })),
        };
      }),
    [travelDays, buildItemsForSave],
  );

  /** Pending uploads aligned with allDayItems() order (rate items + manual sections). */
  const collectPendingByDay = useCallback(
    () =>
      travelDays.map((d) =>
        allDayItems(normalizeTravelDay(d)).map((it) => it.pendingFiles ?? []),
      ),
    [travelDays],
  );

  /* Upload images that were attached before the row had a server id. Called
     after a save has persisted the items (so ids exist). */
  const uploadPendingFiles = useCallback(
    async (id: number) => {
      const pendingByDay = collectPendingByDay();
      if (!pendingByDay.some((day) => day.some((arr) => arr.length > 0))) return;

      let serverDays: TravelExpenseDetail[] = [];
      try {
        const res = await fetch(`/api/request/accounting/requests/${id}`);
        const json = await res.json();
        serverDays = json?.data?.travelDays?.length
          ? json.data.travelDays
          : json?.data?.travel
            ? [json.data.travel]
            : [];
      } catch {
        toast.error("อัปโหลดรูปไม่สำเร็จ");
        return;
      }

      let failed = 0;
      let firstError: string | null = null;
      for (let di = 0; di < pendingByDay.length; di++) {
        const pendingPerIndex = pendingByDay[di];
        const serverDay = serverDays[di];
        const serverItems = serverDay ? allDayItems(normalizeTravelDay(serverDay)) : [];
        for (let i = 0; i < pendingPerIndex.length; i++) {
          const itemId = serverItems[i]?.id;
          if (!itemId) {
            failed += pendingPerIndex[i].length;
            continue;
          }
          for (const pf of pendingPerIndex[i]) {
            const fd = new FormData();
            fd.append("file", pf.file);
            fd.append("refId", String(itemId));
            try {
              const r = await fetch(`/api/request/accounting/requests/${id}/files`, {
                method: "POST",
                body: fd,
              });
              const j = await r.json();
              if (!j.ok) {
                failed++;
                // Keep the first reason. Every refusal here already carries one
                // — too large, request not editable, SharePoint unreachable —
                // and the count alone sent somebody hunting through the wrong
                // half of the system for it.
                if (!firstError) firstError = typeof j.error === "string" ? j.error : null;
              } else if (pf.previewUrl) {
                URL.revokeObjectURL(pf.previewUrl);
              }
            } catch {
              failed++;
            }
          }
        }
      }
      if (failed > 0) {
        toast.error(
          firstError
            ? `แนบไฟล์ไม่สำเร็จ ${failed} ไฟล์ — ${firstError}`
            : `แนบไฟล์ไม่สำเร็จ (${failed} ไฟล์)`,
        );
      }
    },
    [collectPendingByDay],
  );

  /* ── Save draft ── */
  const handleSaveDraft = useCallback(async () => {
    const datesToCheck = travelDays.map((d) => d.travelDate).filter(Boolean) as string[];
    if (datesToCheck.length > 0) {
      try {
        const res = await fetch("/api/request/accounting/requests/drafts");
        const json = await res.json();
        const drafts: TravelDraftSummary[] = json?.ok && json.data ? json.data : [];
        for (const date of datesToCheck) {
          const clash = drafts.filter(
            (d) => d.id !== requestId && d.travelDate === date,
          );
          if (clash.length > 0) {
            toast.error(`วันที่ ${date} มีอยู่ในแบบร่างอื่นแล้ว`);
            onDuplicateDraftDate?.(clash);
            return null;
          }
        }
      } catch {
        /* network issue — fall through */
      }
    }
    setSaving(true);
    try {
      const body = {
        id: requestId ?? undefined,
        brandCode,
        travelDays: buildTravelDaysForSave(),
        requesterStaffId,
      };
      const res = requestId
        ? await fetch(`/api/request/accounting/requests/${requestId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/request/accounting/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return null;
      }
      const id: number = json.data?.id ?? requestId;
      if (id && !requestId) setRequestId(id);
      // Upload any in-memory images now that item ids exist, then reload so the
      // form shows the saved files (and fresh item ids) instead of pending ones.
      if (id) {
        await uploadPendingFiles(id);
        toast.success("บันทึกร่างแล้ว");
        await reloadFromServer(id);
      }
      onSaved?.(id);
      return id;
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
      return null;
    } finally {
      setSaving(false);
    }
  }, [requestId, brandCode, travelDays, buildTravelDaysForSave, requesterStaffId, uploadPendingFiles, onSaved, reloadFromServer, onDuplicateDraftDate]);

  /* ── Submit ── */
  const handleSubmit = useCallback(async () => {
    setTriedSubmit(true);
    if (!canSubmit) {
      focusFirstMissing();
      toast.error("กรุณากรอกข้อมูลให้ครบก่อนส่งคำขอ");
      return;
    }
    setSubmitting(true);
    try {
      // First ensure we have a saved request
      let id = requestId;
      if (!id) {
        // handleSaveDraft also uploads pending images, so they're persisted.
        const savedId = await handleSaveDraft();
        if (!savedId) return;
        id = savedId;
      } else {
        // Re-save to flush latest changes, then upload any pending images.
        const body = { id, brandCode, travelDays: buildTravelDaysForSave(), requesterStaffId };
        const res = await fetch(`/api/request/accounting/requests/${id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error ?? "บันทึกไม่สำเร็จ");
          return;
        }
        await uploadPendingFiles(id);
      }

      // Submit
      const res = await fetch(
        `/api/request/accounting/requests/${id}/submit`,
        { method: "POST" }
      );
      const json = await res.json();
      if (!json.ok) {
        setTriedSubmit(true);
        toast.error(json.error ?? "ส่งคำขอไม่สำเร็จ");
        return;
      }
      toast.success("ส่งคำขอแล้ว");
      onSubmitted?.(id);
    } catch {
      toast.error("ส่งคำขอไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }, [requestId, brandCode, buildTravelDaysForSave, requesterStaffId, uploadPendingFiles, handleSaveDraft, onSubmitted, canSubmit, focusFirstMissing]);

  const requesterCard = (
    <SectionCard
      icon={<User size={15} />}
      title="ผู้ขอเบิก"
      dataTour="ap1-requester"
      extra={(
        /*
         * Not gated on `colleagues.length`: that list is the actor's own
         * department, and the picker has searched the whole company since its
         * `?q=` mode landed. Gating on it hid a working feature from anybody
         * who is the only person in their department.
         */
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
        <div className="flex items-center gap-4">
          <div
            className="shrink-0 w-14 h-14 rounded-2xl animate-pulse"
            style={{ background: "var(--bg-card-alt)" }}
          />
          <div className="flex-1 flex flex-col gap-2">
            <div className="h-3 w-32 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
            <div className="h-3 w-48 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
            <div className="h-3 w-40 rounded animate-pulse" style={{ background: "var(--bg-card-alt)" }} />
          </div>
        </div>
      ) : !employee ? (
        <div
          className="rounded-xl px-4 py-3 text-[13px] leading-relaxed"
          style={{
            background: "var(--bg-info-yellow)",
            color: "var(--text-info-yellow)",
            border: "1px solid var(--border-card)",
          }}
        >
          ไม่พบข้อมูลพนักงานสำหรับอีเมล <b>{employeeEmail ?? "-"}</b> ในระบบ HR
          {employeeHint ? ` — ${employeeHint}` : ""}
          {" "}· กรุณาตรวจสอบว่าอีเมลตรงกับ Employee ใน Rocks_Portal_HR
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          {/* requester */}
          <div className="flex flex-col gap-2.5 min-w-0">
            <RequesterPickerModal
              open={requesterPickerOpen}
              onClose={() => setRequesterPickerOpen(false)}
              colleagues={colleagues}
              searchEndpoint="/api/request/accounting/requesters"
              self={employee ? {
                staffId: employee.staffId,
                fullName: employeeName || employee.fullName,
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
                  <Avatar name={employeeName || employee?.fullName || "?"} size={48} photo={requesterPhoto} color="var(--nav-active-text)" />
                </div>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{employeeName || "-"}</span>
                    <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{employee.staffId}</span>
                  </div>
                  {(employee?.departmentName || employee?.position) && (
                    <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                      {[employee?.departmentName, employee?.position].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  {(employee?.email || employee?.emailCompBr) && (
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
          <div
            ref={managerRef}
            className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6"
            style={showErr("manager") ? { boxShadow: "0 0 0 1px var(--color-danger)", borderRadius: 10, padding: 12 } : {}}
          >
            {shownManager ? (
              <>
                <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                  <Avatar name={shownManager.fullName || "?"} size={48} photo={shownManager.photoUrl ?? undefined} color="var(--nav-active-text)" />
                </div>
                <div className="min-w-0 flex flex-col gap-0.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>หัวหน้างาน (ผู้จัดการ){requiredStar}</span>
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
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={errLabelStyle("manager")}>หัวหน้างาน (ผู้จัดการ){requiredStar}</span>
                <p className="text-[12.5px] leading-relaxed m-0" style={{ color: showErr("manager") ? "var(--color-danger)" : "var(--text-muted)" }}>
                  {showErr("manager")
                    ? (shownManagerReason ?? "ยังไม่ได้กำหนดผู้จัดการ (ManagerStaffId) ในระบบ HR")
                    : (shownManagerReason ?? "ไม่พบข้อมูลผู้จัดการ")}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );

  /* ── Render ── */
  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-4 min-w-0">
      {/*
        Which set of books this draft belongs to, before anything a reader could
        act on. Editing is where getting this wrong costs the most — Save and
        Submit below write for real — and until now the only hint was the
        manager card failing to resolve a UAT manager.

        `requestId`, not `initial?.id`: it starts as the resumed record's id and
        picks up the id the server hands back on first save, so a brand-new
        draft is labelled from the moment it becomes a row. A form with no id
        yet is blank and the banner renders nothing.
      */}
      {/* -mb-4 cancels the banner's own margin so the parent's gap-4 is the only
          spacing; empty:hidden keeps the wrapper from becoming a phantom flex
          child on every blank form, where the banner renders nothing. */}
      <div className="-mb-4 empty:hidden">
        <UatDataBanner requestId={requestId} holdSpace={false} />
      </div>

      {/* คำแนะนำ — AP-17's notice, same shape and same place. */}
      <div
        data-tour="ap1-notice"
        className="rounded-2xl px-4 py-3.5 flex items-start gap-2.5"
        style={{
          background: "color-mix(in srgb, var(--color-action) 8%, var(--bg-card))",
          border: "1px solid color-mix(in srgb, var(--color-action) 25%, var(--border-card))",
        }}
      >
        <Info size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-action)" }} />
        <div className="flex flex-col gap-1">
          {AP1_HEADER_MESSAGE_LINES.map((line, i) => (
            <p key={i} className="text-[12.5px] leading-relaxed m-0" style={{ color: "var(--text-secondary)" }}>
              {line}
            </p>
          ))}
        </div>
      </div>

      {requesterCard}

      {/* ── รายละเอียดการเดินทาง (แบรนด์ + วันที่) ── */}
      <SectionCard icon={<MapPin size={15} />} title="รายละเอียดการเดินทาง" dataTour="ap1-travel">
        {/* แบรนด์ที่เบิก — logo chips */}
        <div ref={brandRef}>
          <label className={labelClass} style={errLabelStyle("brand")}>
            แบรนด์ที่เบิก{requiredStar}
          </label>
          {brands.length === 0 ? (
            <p className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
              ยังไม่ได้ตั้งค่าแบรนด์ที่เบิกได้ — ติดต่อผู้ดูแลระบบ
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
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
                    {b.brandLogo && (
                      <img
                        src={b.brandLogo}
                        alt=""
                        className="h-5 w-auto object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                      />
                    )}
                    {b.brandName}
                    {active && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div ref={dateRef}>
          <FilterMultiDatePicker
            label="วันที่เดินทาง *"
            selected={selectedTravelDates}
            onChange={setTravelDates}
            placeholder="คลิกเลือกวันเดินทาง (หลายวันได้)..."
            minDate={minDateStr()}
            maxDate={todayStr()}
            disabledDates={blockedTravelDates}
            hasError={showErrDay("travelDate")}
          />
          {selectedTravelDates.length > 0 && (
            <p
              className="text-[12px] mt-1.5 m-0 break-words"
              style={{ color: "var(--text-muted)" }}
            >
              {selectedTravelDates.length} วัน · {fmtTravelDatesList(selectedTravelDates)}
              {selectedTravelDates.length > 1
                ? " · กรอกรายละเอียดแยกตามแท็บด้านล่าง"
                : ""}
            </p>
          )}
        </div>

        {!travelDetailsReady && (
          <p
            className="text-[12px] m-0 flex items-center gap-1.5"
            style={{ color: "var(--text-faint)" }}
          >
            <Lock size={12} className="shrink-0" />
            เลือกแบรนด์และวันเดินทางให้ครบเพื่อเปิดส่วนถัดไป
          </p>
        )}
      </SectionCard>

      {/* แถบไทม์ไลน์รายวัน — sticky */}
      {travelDays.length > 1 && (() => {
        const doneCount = travelDetailsReady
          ? dayMissingByIndex.filter((m) => m.length === 0).length
          : 0;
        const allDone = travelDetailsReady && doneCount === travelDays.length;
        const navBtnClass =
          "shrink-0 w-10 h-10 rounded-xl flex items-center justify-center cursor-pointer border transition-all disabled:opacity-35 disabled:cursor-not-allowed";
        const navBtnStyle: React.CSSProperties = {
          background: "var(--bg-card)",
          borderColor: "var(--border-card)",
          color: "var(--text-secondary)",
        };

        return (
          <div
            className="sticky top-14 md:top-12 z-40 w-full max-w-full min-w-0 overflow-hidden rounded-2xl"
            style={{
              background: "color-mix(in srgb, var(--bg-card) 92%, transparent)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--border-card)",
              boxShadow: "0 4px 16px -8px rgba(0,0,0,0.12)",
            }}
          >
            {/* หัวแถบ */}
            <div
              className="flex items-center justify-between gap-3 px-3 py-2.5 min-w-0"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <CalendarRange size={15} style={{ color: "var(--nav-active-text)" }} />
                <span className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
                  วันเดินทาง
                </span>
                <span className="text-[12px] font-medium" style={{ color: "var(--text-muted)" }}>
                  {activeDayIndex + 1}/{travelDays.length}
                </span>
              </div>
              {travelDetailsReady && (
                <span
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap shrink-0"
                  style={{
                    background: allDone
                      ? "color-mix(in srgb, var(--positive, #15b357) 12%, transparent)"
                      : "var(--bg-card-alt)",
                    color: allDone ? "var(--positive, #15b357)" : "var(--text-muted)",
                  }}
                >
                  {allDone ? "ครบทุกวัน" : `กรอกแล้ว ${doneCount}/${travelDays.length} วัน`}
                </span>
              )}
            </div>

            {/* นำทาง: < · [วันที่ + คัดลอก] · > — overflow-hidden บีบ strip ให้ scroll ภายใน ไม่ดันทั้งหน้า */}
            <div className="flex items-center gap-2 px-3 py-2.5 min-w-0 w-full max-w-full overflow-hidden">
              <button
                type="button"
                onClick={() => goToDay(-1)}
                disabled={activeDayIndex === 0}
                className={navBtnClass}
                style={navBtnStyle}
                aria-label="วันก่อนหน้า"
                title="วันก่อนหน้า"
              >
                <ChevronLeft size={18} />
              </button>

              <div
                ref={dayStripRef}
                className="flex-1 basis-0 w-0 min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                role="tablist"
                aria-label="เลือกวันเดินทาง"
              >
                <div className="flex w-max items-center gap-1.5 min-h-10 py-px pr-0.5">
                  {travelDays.map((d, i) => {
                    const active = i === activeDayIndex;
                    const dayMiss = travelDetailsReady ? (dayMissingByIndex[i]?.length ?? 0) : 0;
                    const complete = travelDetailsReady && dayMiss === 0;
                    const showRemain = triedSubmit && dayMiss > 0;
                    const cd = fmtDayChipDate(d.travelDate);
                    const ymd = d.travelDate;

                    return (
                      <div
                        key={d.travelDate ?? i}
                        className="flex items-stretch shrink-0 h-10 rounded-xl overflow-hidden"
                        style={{
                          borderWidth: 1.5,
                          borderStyle: "solid",
                          borderColor: showRemain
                            ? "var(--color-danger)"
                            : active
                              ? "var(--nav-active-text)"
                              : "var(--border-card)",
                          background: active
                            ? "var(--nav-active-bg)"
                            : complete
                              ? "color-mix(in srgb, var(--positive, #15b357) 5%, var(--bg-card))"
                              : "var(--bg-card)",
                        }}
                      >
                        <button
                          ref={active ? activePillRef : undefined}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setActiveDayIndex(i)}
                          className="flex items-center gap-1.5 h-full pl-2 pr-1 min-w-[96px] max-w-[132px] cursor-pointer transition-all text-left border-none bg-transparent"
                        >
                          <span
                            className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                            style={
                              complete
                                ? { background: "var(--positive, #15b357)", color: "#fff" }
                                : active
                                  ? { background: "var(--nav-active-text)", color: "#fff" }
                                  : { background: "var(--bg-card-alt)", color: "var(--text-muted)" }
                            }
                          >
                            {complete ? <Check size={12} /> : i + 1}
                          </span>
                          <span
                            className="flex-1 min-w-0 text-[12px] font-semibold truncate leading-none"
                            style={{ color: active ? "var(--nav-active-text)" : "var(--text-primary)" }}
                          >
                            {cd ? `${cd.weekday} ${cd.dayMonth}` : `วัน ${i + 1}`}
                          </span>
                        </button>
                        {ymd && (
                          <button
                            type="button"
                            onClick={() => setRemoveDateConfirm(ymd)}
                            className="shrink-0 w-7 h-full flex items-center justify-center cursor-pointer border-none bg-transparent opacity-50 hover:opacity-100"
                            style={{
                              color: active ? "var(--nav-active-text)" : "var(--text-faint)",
                              borderLeft: "1px solid var(--border-light)",
                            }}
                            aria-label={`ลบวัน ${cd ? cd.dayMonth : i + 1}`}
                            title="ลบวันนี้"
                          >
                            <X size={11} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopyDayClick}
                className="shrink-0 h-10 flex items-center gap-1.5 rounded-xl px-3 cursor-pointer border transition-all"
                style={{
                  background: "var(--bg-card)",
                  borderColor: "var(--border-card)",
                  color: "var(--text-secondary)",
                }}
                title="คัดลอกรายละเอียดจากวันอื่น (ไม่รวมไฟล์แนบ)"
              >
                <Copy size={14} style={{ color: "var(--nav-active-text)" }} />
                <span className="text-[12px] font-semibold whitespace-nowrap hidden sm:inline">
                  คัดลอกข้อมูลวัน
                </span>
              </button>

              <button
                type="button"
                onClick={() => goToDay(1)}
                disabled={activeDayIndex === travelDays.length - 1}
                className={navBtnClass}
                style={navBtnStyle}
                aria-label="วันถัดไป"
                title="วันถัดไป"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        );
      })()}

      {/* ── รายละเอียดการปฏิบัติงาน (ต่อวัน) ── */}
      <SectionCard
        icon={<Briefcase size={15} />}
        title={
          travelDetailsReady && travelDays.length > 1
            ? `รายละเอียดการปฏิบัติงาน · ${fmtDayTabLabel(travel, activeDayIndex)}`
            : "รายละเอียดการไปปฏิบัติงานและสถานที่"
        }
        dataTour="ap1-work"
      >
        {travelDetailsReady ? (
          <div>
            <label className={labelClass} style={errLabelStyle("workDetail")}>
              รายละเอียดการไปปฏิบัติงานและสถานที่{requiredStar}
            </label>
            <textarea
              ref={workDetailRef}
              rows={3}
              className={inputClass}
              style={{ ...inputStyle, resize: "vertical", ...errInputStyle("workDetail") }}
              value={travel.workDetail ?? ""}
              placeholder="อธิบายจุดประสงค์การเดินทางและสถานที่ในวันนี้..."
              onChange={(e) => setField("workDetail", e.target.value || null)}
            />
          </div>
        ) : (
          <SectionLockedHint message={travelDetailsLockedMessage} />
        )}
      </SectionCard>

      {/* ── Section 3: พาหนะ & ระยะทาง ── */}
      <SectionCard icon={<Car size={15} />} title="พาหนะ & ระยะทาง" dataTour="ap1-vehicle">
        {travelDetailsReady ? (
          <>
        {/* พาหนะ — icon cards */}
        <div ref={vehicleRef}>
          <label className={labelClass} style={errLabelStyle("vehicle")}>
            พาหนะ{requiredStar}
          </label>
          <p className="text-[12px] mb-1.5 m-0" style={{ color: "var(--text-faint)" }}>
            เลือกได้หลายพาหนะต่อวัน (เช่น รถส่วนตัว + แท็กซี่ / เครื่องบิน)
          </p>
          {vehicles.length === 0 ? (
            <p className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
              ยังไม่ได้ตั้งค่าพาหนะ — ติดต่อผู้ดูแลระบบ
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
              {vehicles.map((v) => {
                const active = isVehicleActive(v.id);
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleToggleVehicle(v)}
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer text-left transition-all"
                    style={{
                      borderWidth: 2,
                      borderStyle: "solid",
                      borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                      background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                    }}
                  >
                    <span
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-[18px] shrink-0"
                      style={{ background: "var(--bg-card)", color: "var(--nav-active-text)" }}
                    >
                      {v.icon ? <span>{v.icon}</span> : <Car size={18} />}
                    </span>
                    <span className="min-w-0">
                      <span
                        className="block text-[14px] font-bold truncate"
                        style={{ color: active ? "var(--nav-active-text)" : "var(--text-primary)" }}
                      >
                        {v.name}
                      </span>
                      <span className="block text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                        {v.isManualEntry ? "กรอกเอง" : `฿${v.ratePerKm ?? 0}/กม.`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {showMapsUnavailableNotice && (
            <div
              className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2.5 text-[13px]"
              style={{
                background: "color-mix(in srgb, var(--color-danger) 8%, var(--bg-card-alt))",
                border: "1px solid color-mix(in srgb, var(--color-danger) 25%, var(--border-card))",
                color: "var(--color-danger)",
              }}
            >
              <CircleAlert size={15} className="shrink-0 mt-0.5" />
              <span>{MAPS_UNAVAILABLE_USER_MESSAGE}</span>
            </div>
          )}
        </div>

        {/* ทิศทางการเดินทาง — styled segmented buttons */}
        {visible.direction && (
          <div>
            <label className={labelClass} style={labelStyle}>
              ทิศทางการเดินทาง
            </label>
            <div
              className="inline-flex rounded-xl p-1 gap-1"
              style={{
                background: "var(--bg-card-alt)",
                border: "1px solid var(--border-card)",
              }}
            >
              {DIRECTIONS.map(({ value, label }) => {
                const active = travel.direction === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setField("direction", value)}
                    className="px-4 py-1.5 rounded-lg text-[13px] font-semibold transition-all cursor-pointer border-none"
                    style={
                      active
                        ? {
                            background: "var(--nav-active-bg)",
                            color: "var(--nav-active-text)",
                            boxShadow: "var(--shadow-sm)",
                          }
                        : {
                            background: "transparent",
                            color: "var(--text-secondary)",
                          }
                    }
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* แผนที่ขาไป */}
        {visible.onwardLeg && (
          <DistanceMapField
            label="เส้นทางขาไป"
            value={onwardLegValue}
            onChange={setOnwardLeg}
            hqEnd="origin"
          />
        )}

        {/* ระยะทางขาไป (read-only) */}
        {visible.onwardLeg && travel.onwardDistanceKm !== null && (
          <div>
            <label className={labelClass} style={labelStyle}>
              ระยะทางขาไป (กม.)
            </label>
            <input
              className={inputClass}
              style={readonlyStyle}
              value={travel.onwardDistanceKm?.toFixed(1) ?? ""}
              readOnly
            />
          </div>
        )}

        {/* แผนที่ขากลับ */}
        {visible.returnLeg && (
          <DistanceMapField
            label="เส้นทางขากลับ"
            value={returnLegValue}
            onChange={setReturnLeg}
            allowWaypoints={false}
          />
        )}

        {/* ระยะทางขากลับ (read-only) */}
        {visible.returnLeg && travel.returnDistanceKm !== null && (
          <div>
            <label className={labelClass} style={labelStyle}>
              ระยะทางขากลับ (กม.)
            </label>
            <input
              className={inputClass}
              style={readonlyStyle}
              value={travel.returnDistanceKm?.toFixed(1) ?? ""}
              readOnly
            />
          </div>
        )}

        {/* ระยะทางรวม — rate-based vehicles only.

            Read from `computeTotalDistance`, the same function the payable amount
            is computed from, so the two cannot disagree. This box used to add both
            legs inline regardless of direction: picking ขาไป displayed the round
            trip while the claim was calculated — correctly — on the onward leg
            alone. The number on screen was not the number being paid, and it
            silently stopped updating when the direction changed, which is what
            was reported. */}
        {hasRateVehicle(travel) && (
          <div>
            <label className={labelClass} style={labelStyle}>
              ระยะทางรวม (กม.)
            </label>
            <input
              className={inputClass}
              style={readonlyStyle}
              value={computeTotalDistance(travel)}
              readOnly
            />
          </div>
        )}
          </>
        ) : (
          <SectionLockedHint message={travelDetailsLockedMessage} />
        )}
      </SectionCard>

      {/* ── Section 4: ค่าใช้จ่าย ── */}
      <div ref={receiptRef} className="min-w-0">
      <SectionCard icon={<Receipt size={15} />} title="ค่าใช้จ่าย" dataTour="ap1-expense">
        {travelDetailsReady ? (
          <>
        {manualSections.map((sec, si) => (
          <div
            key={`${sec.vehicleId ?? "sec"}-${si}`}
            className="rounded-xl px-4 py-3 flex flex-col gap-3"
            style={{
              // White, matching the expense rows inside it — the frame and its
              // rows read as one surface, separated by their borders rather
              // than by two shades of grey stacked on each other.
              background: "var(--bg-card)",
              border: "1px solid var(--border-card)",
            }}
          >
            <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              {sec.vehicleName ?? "พาหนะ"}
            </p>
            <ExpenseRows
              label="ค่าโดยสาร / ค่าเดินทาง"
              type="fare"
              dataField={`fare-${si}`}
              items={sec.items}
              onAdd={() => addSectionItem(si, "fare")}
              onUpdate={(idx, patch) => updateSectionItem(si, idx, patch)}
              onRemove={(idx) => removeSectionItem(si, idx)}
              highlightMissingReceipt={triedSubmit}
              requestId={requestId ?? undefined}
            />
            <ExpenseRows
              label="ค่าผ่านทาง / ทางด่วน"
              type="toll"
              items={sec.items}
              onAdd={() => addSectionItem(si, "toll")}
              onUpdate={(idx, patch) => updateSectionItem(si, idx, patch)}
              onRemove={(idx) => removeSectionItem(si, idx)}
              highlightMissingReceipt={triedSubmit}
              requestId={requestId ?? undefined}
            />
          </div>
        ))}

        {hasRateVehicle(travel) && (
          <>
            <ExpenseRows
              label={`ค่าผ่านทาง / ทางด่วน (${travel.vehicleName ?? "รถ"})`}
              type="toll"
              items={travel.items}
              onAdd={() => addItem("toll")}
              onUpdate={updateItem}
              onRemove={removeItem}
              highlightMissingReceipt={triedSubmit}
              requestId={requestId ?? undefined}
            />
            {visible.parking && (
              <ExpenseRows
                label={`ค่าจอดรถ (${travel.vehicleName ?? "รถ"})`}
                type="parking"
                items={travel.items}
                onAdd={() => addItem("parking")}
                onUpdate={updateItem}
                onRemove={removeItem}
                highlightMissingReceipt={triedSubmit}
                requestId={requestId ?? undefined}
              />
            )}
          </>
        )}

        {/* Legacy single manual vehicle without sections */}
        {visible.fareRows && manualSections.length === 0 && (
          <ExpenseRows
            label="ค่าโดยสาร / ค่าเดินทาง"
            type="fare"
            dataField="fare"
            items={travel.items}
            onAdd={() => addItem("fare")}
            onUpdate={updateItem}
            onRemove={removeItem}
            highlightMissingReceipt={triedSubmit}
            requestId={requestId ?? undefined}
          />
        )}

        {!hasAnyVehicle && (
          <p className="text-[13px] text-center py-4" style={{ color: "var(--text-faint)" }}>
            เลือกพาหนะก่อนเพื่อดูรายการค่าใช้จ่าย
          </p>
        )}
          </>
        ) : (
          <SectionLockedHint message={travelDetailsLockedMessage} />
        )}
      </SectionCard>
      </div>

      {/* ── Section 5: สรุป & ส่งคำขอ ── */}
      <SectionCard icon={<FileCheck size={15} />} title="สรุป & ส่งคำขอ" dataTour="ap1-summary">
        {travelDetailsReady ? (
          <>
        {/* Per-day breakdown — multi-day only */}
        {travelDays.length > 1 && (
          <div
            className="rounded-xl px-4 py-3 flex flex-col gap-2"
            style={{
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            <p
              className="text-[12px] font-semibold uppercase tracking-wide m-0"
              style={{ color: "var(--text-muted)" }}
            >
              รายละเอียดแต่ละวัน
            </p>
            {travelDays.map((d, i) => {
              const dayAmount = computeTotalAmount(d);
              const dayMissing = dayMissingByIndex[i];
              const dayOk = dayMissing.length === 0;
              return (
                <div
                  key={d.travelDate ?? i}
                  className="flex items-center gap-2 py-1"
                  style={{
                    borderTop: i > 0 ? "1px solid var(--border-light)" : undefined,
                    paddingTop: i > 0 ? 8 : 0,
                  }}
                >
                  <span
                    className="text-[13px] font-semibold shrink-0 min-w-[52px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtDayTabLabel(d, i)}
                  </span>
                  {formatDayVehicleNames(d) && (
                    <span
                      className="text-[12px] truncate flex-1 min-w-0"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {formatDayVehicleNames(d)}
                    </span>
                  )}
                  <span
                    className="text-[14px] font-bold tabular-nums shrink-0"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {fmtDayAmount(dayAmount)} บาท
                  </span>
                  {dayOk ? (
                    <CircleCheck size={15} className="shrink-0" style={{ color: "var(--color-success)" }} />
                  ) : (
                    <CircleAlert size={15} className="shrink-0" style={{ color: "var(--color-danger)" }} />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Total amount — prominent accent card */}
        <div
          className="rounded-xl px-5 py-4 flex items-center justify-between"
          style={{
            background: "var(--nav-active-bg)",
            border: "1px solid var(--border-card)",
          }}
        >
          <div>
            <p
              className="text-[12px] font-semibold uppercase tracking-wide mb-0.5"
              style={{ color: "var(--nav-active-text)", opacity: 0.75 }}
            >
              ค่าเดินทางรวม{travelDays.length > 1 ? ` (${travelDays.length} วัน)` : ""}
            </p>
            <p
              className="text-[28px] font-bold leading-none"
              style={{ color: "var(--nav-active-text)" }}
            >
              {fmtDayAmount(requestTotalAmount)}
              <span
                className="text-[14px] font-semibold ml-1.5"
                style={{ opacity: 0.7 }}
              >
                บาท
              </span>
            </p>
          </div>
          {/* Decorative icon */}
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: "var(--nav-active-text)",
              color: "var(--nav-active-bg)",
              opacity: 0.15,
            }}
          >
            <Receipt size={22} />
          </div>
        </div>

        {/* Readiness check */}
        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-2"
          style={{
            background: canSubmit ? "var(--bg-info-green)" : "var(--bg-card-alt)",
            border: `1px solid ${canSubmit ? "var(--color-success)" : "var(--border-card)"}`,
          }}
        >
          <p
            className="text-[12px] font-semibold uppercase tracking-wide m-0"
            style={{ color: "var(--text-muted)" }}
          >
            ตรวจสอบความครบถ้วน
          </p>
          {canSubmit ? (
            <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--color-success)" }}>
              <CircleCheck size={15} />
              ข้อมูลครบถ้วน — พร้อมส่งคำขอ
            </p>
          ) : (
            <ul className="m-0 pl-4 flex flex-col gap-1">
              {requestLevelMissing.map((m) => (
                <li key={m.key} className="text-[12px]" style={{ color: "var(--color-danger)" }}>
                  {m.label}
                </li>
              ))}
              {travelDays.map((d, i) => {
                const dayMissing = dayMissingByIndex[i];
                if (dayMissing.length === 0) return null;
                const suffix = dayLabel(i);
                return (
                  <li key={`day-miss-${i}`} className="text-[12px]" style={{ color: "var(--color-danger)" }}>
                    {fmtDayTabLabel(d, i)}:{" "}
                    {dayMissing
                      .map((m) => (suffix ? m.label.replace(suffix, "").trim() : m.label))
                      .join(", ")}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer notes */}
        <div
          className="rounded-xl px-4 py-3 flex flex-col gap-1.5"
          style={{
            background: "var(--bg-card-alt)",
            border: "1px solid var(--border-card)",
          }}
        >
          {[
            "รอบการเบิกจ่ายค่าเดินทาง ตัดรอบวันจันทร์ (แบบฟอร์มที่ได้รับการอนุมัติแล้ว) และจ่ายตามปฏิทินการชำระของบริษัท (ทุกศุกร์ที่ 2 และ 4 ของเดือน)",
            "สำหรับพนักงานออฟฟิศที่กลับบ้านเกิน 21.00 หรือ Working hour > 8h สามารถเบิกค่าเดินทางกลับบ้านได้",
            "หากติดวันหยุดจะเลื่อนการเบิกจ่ายเป็นวันทำการถัดไป",
            "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม",
          ].map((note, i) => (
            <p
              key={i}
              className="text-[12px] leading-relaxed"
              style={{ color: "var(--text-muted)" }}
            >
              • {note}
            </p>
          ))}
        </div>

          </>
        ) : (
          <SectionLockedHint message={travelDetailsLockedMessage} />
        )}
      </SectionCard>

      {/* Sticky summary + actions (matches AP-17) — OUTSIDE the card so `position: sticky`
          isn't clipped by SectionCard's overflow-hidden */}
      <div
        className="sticky bottom-3 rounded-2xl px-4 py-3.5 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex flex-col">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
            ค่าเดินทางรวม{travelDays.length > 1 ? ` (${travelDays.length} วัน)` : ""}
          </span>
          <span className="text-[16px] font-bold" style={{ color: "var(--text-heading)" }}>
            ฿{fmtDayAmount(requestTotalAmount)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="lg"
            icon={<Save size={15} />}
            loading={saving}
            disabled={saving || submitting || !travelDetailsReady}
            onClick={handleSaveDraft}
            type="button"
          >
            บันทึกร่าง
          </Button>
          <Button
            variant="primary"
            size="lg"
            icon={<Send size={15} />}
            loading={submitting}
            disabled={saving || submitting || !travelDetailsReady}
            onClick={handleSubmit}
            type="button"
          >
            ส่งคำขอ
          </Button>
        </div>
      </div>

      <Dialog
        open={copyPickerOpen}
        onOpenChange={setCopyPickerOpen}
        title="เลือกวันที่ต้องการคัดลอก"
        description="เลือกวันต้นทาง — คัดลอกรายละเอียดงาน เส้นทาง และยอดค่าใช้จ่าย (ไม่รวมไฟล์แนบ)"
        contentClassName="max-w-sm"
      >
        <div className="flex flex-col gap-2">
          <div
            className="text-[13px] font-semibold px-4 py-3 rounded-xl"
            style={{
              background: "var(--nav-active-bg)",
              color: "var(--nav-active-text)",
              border: "2px solid var(--nav-active-text)",
            }}
          >
            {fmtDayTabLabel(travel, activeDayIndex)}
            {travel.travelDate ? ` (${travel.travelDate.split("-").reverse().join("/")})` : ""}
            <span className="block text-[11px] font-medium mt-0.5 opacity-80">แท็บที่เลือกอยู่ — คัดลอกมาที่นี่</span>
          </div>
          {copySourceDays.map(({ d, i }) => (
            <button
              key={d.travelDate ?? i}
              type="button"
              onClick={() => handleCopyFromDay(i)}
              className="w-full text-left text-[14px] font-semibold px-4 py-3 rounded-xl cursor-pointer border-none transition-colors"
              style={{
                background: "var(--bg-card-alt)",
                color: "var(--text-primary)",
              }}
            >
              {fmtDayTabLabel(d, i)}
              {d.travelDate ? ` (${d.travelDate.split("-").reverse().join("/")})` : ""}
            </button>
          ))}
        </div>
      </Dialog>

      <Dialog
        open={removeDateConfirm !== null}
        onOpenChange={(open) => { if (!open) setRemoveDateConfirm(null); }}
        title="ลบวันที่เดินทาง"
        description={
          removeDateConfirm
            ? `ต้องการลบวันที่ ${removeDateConfirm.split("-").slice(1).reverse().join("/")} ออกจากคำขอหรือไม่? ข้อมูลที่กรอกไว้ในวันนี้จะหาย`
            : ""
        }
        contentClassName="max-w-sm"
      >
        <div className="flex gap-2 justify-end pt-1">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRemoveDateConfirm(null)}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={handleConfirmRemoveDate}
          >
            ลบวันนี้
          </Button>
        </div>
      </Dialog>

      {submitting ? (
        <TravelExpenseLoadingPopup
          label="กำลังส่งคำขอ..."
          subtitle="กรุณารอสักครู่ อย่าปิดหน้านี้"
        />
      ) : null}
    </div>
  );
}
