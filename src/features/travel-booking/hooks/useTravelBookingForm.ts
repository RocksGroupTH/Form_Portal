"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { computePerDiem, type AllowanceLogEntry } from "@/lib/acc/travel-booking/perdiem";
import type {
  Accommodation,
  ProvinceOption,
  RentVehicle,
  SaveTravelBookingGroupInput,
  SaveTravelBookingInput,
  TravelBookingFileMeta,
  TravelBookingGroup,
  TravelBookingRequest,
  TravelDirection,
  TravelReasonOption,
  VehicleOption,
} from "@/features/travel-booking/types";
import type { EmployeeContext } from "@/lib/hr/types";

/* ── Client-side editable tab state ──
   Writable subset of TravelBookingRequest (mirrors SaveTravelBookingInput) plus
   idCardFiles, which the form needs to display/gate on even though the server
   derives it from AccRequestFile rather than accepting it on save. */

export interface WorkLocationInput {
  name: string;
  sortOrder: number;
}

export interface DepartureLocationInput {
  direction: TravelDirection;
  name: string;
  sortOrder: number;
}

/** Legs of a submit: persist every tab, then hand the group to the approval flow. */
export type SubmitPhase = "saving" | "submitting";

export interface TabFormState {
  /** AccRequest.Id — set once this tab has been persisted by a save. */
  id?: number;

  reasonId: number | null;
  reasonCustomText: string | null;

  workDetail: string | null;

  provinceId: number | null;
  workLocations: WorkLocationInput[];

  accommodationId: number | null;
  accommodationCustomText: string | null;
  needsRoomBooking: boolean;

  departDate: string | null;
  returnDate: string | null;
  departTime: string | null;
  returnTime: string | null;

  goVehicleId: number | null;
  goVehicleCustomText: string | null;
  goNeedsDepartureLocations: boolean;
  goNeedsTicketBooking: boolean;
  goNeedsDepartTime: boolean;
  goNeedsVehicleRent: boolean;

  returnVehicleId: number | null;
  returnVehicleCustomText: string | null;
  returnNeedsDepartureLocations: boolean;
  returnNeedsTicketBooking: boolean;
  returnNeedsDepartTime: boolean;
  returnNeedsVehicleRent: boolean;

  departureLocations: DepartureLocationInput[];
  /**
   * What the จุดขึ้นรถ default last wrote into each direction, so a province
   * change can tell its own earlier fill apart from a place the requester
   * typed. UI-only — `buildSaveInput` never sends it. See
   * `../lib/departure-default.ts`.
   */
  goAppliedDeparturePlace: string | null;
  returnAppliedDeparturePlace: string | null;

  rentVehicleId: number | null;
  rentVehicleCustomText: string | null;
  needsRentBooking: boolean;
  rentStartDate: string | null;
  rentEndDate: string | null;

  notes: string | null;

  idCardFiles: TravelBookingFileMeta[];
  /** Picked-but-not-yet-uploaded ID card — held in memory and uploaded on save (like AP-1). */
  pendingIdCard: File | null;
}

export function emptyTab(): TabFormState {
  return {
    reasonId: null,
    reasonCustomText: null,
    workDetail: null,
    provinceId: null,
    workLocations: [{ name: "", sortOrder: 0 }],
    accommodationId: null,
    accommodationCustomText: null,
    needsRoomBooking: false,
    departDate: null,
    returnDate: null,
    departTime: null,
    returnTime: null,
    goVehicleId: null,
    goVehicleCustomText: null,
    goNeedsDepartureLocations: false,
    goNeedsTicketBooking: false,
    goNeedsDepartTime: false,
    goNeedsVehicleRent: false,
    returnVehicleId: null,
    returnVehicleCustomText: null,
    returnNeedsDepartureLocations: false,
    returnNeedsTicketBooking: false,
    returnNeedsDepartTime: false,
    returnNeedsVehicleRent: false,
    departureLocations: [],
    goAppliedDeparturePlace: null,
    returnAppliedDeparturePlace: null,
    rentVehicleId: null,
    rentVehicleCustomText: null,
    needsRentBooking: false,
    rentStartDate: null,
    rentEndDate: null,
    notes: null,
    idCardFiles: [],
    pendingIdCard: null,
  };
}

/** Map a loaded (server) tab down to the editable client shape. */
function tabFromRequest(r: TravelBookingRequest): TabFormState {
  return {
    id: r.id,
    reasonId: r.reasonId,
    reasonCustomText: r.reasonCustomText,
    workDetail: r.workDetail,
    provinceId: r.provinceId,
    workLocations: r.workLocations.length
      ? r.workLocations.map((w, i) => ({ name: w.name, sortOrder: w.sortOrder ?? i }))
      : [{ name: "", sortOrder: 0 }],
    accommodationId: r.accommodationId,
    accommodationCustomText: r.accommodationCustomText,
    needsRoomBooking: r.needsRoomBooking,
    departDate: r.departDate,
    returnDate: r.returnDate,
    departTime: r.departTime,
    returnTime: r.returnTime,
    goVehicleId: r.goVehicleId,
    goVehicleCustomText: r.goVehicleCustomText,
    goNeedsDepartureLocations: r.goNeedsDepartureLocations,
    goNeedsTicketBooking: r.goNeedsTicketBooking,
    goNeedsDepartTime: r.goNeedsDepartTime,
    goNeedsVehicleRent: r.goNeedsVehicleRent,
    returnVehicleId: r.returnVehicleId,
    returnVehicleCustomText: r.returnVehicleCustomText,
    returnNeedsDepartureLocations: r.returnNeedsDepartureLocations,
    returnNeedsTicketBooking: r.returnNeedsTicketBooking,
    returnNeedsDepartTime: r.returnNeedsDepartTime,
    returnNeedsVehicleRent: r.returnNeedsVehicleRent,
    departureLocations: r.departureLocations.map((d, i) => ({
      direction: d.direction, name: d.name, sortOrder: d.sortOrder ?? i,
    })),
    // Null on purpose: a saved place is the requester's, whatever first wrote
    // it, so a province change on a resumed draft must leave it alone.
    goAppliedDeparturePlace: null,
    returnAppliedDeparturePlace: null,
    rentVehicleId: r.rentVehicleId,
    rentVehicleCustomText: r.rentVehicleCustomText,
    needsRentBooking: r.needsRentBooking,
    rentStartDate: r.rentStartDate,
    rentEndDate: r.rentEndDate,
    notes: r.notes,
    idCardFiles: r.idCardFiles,
    pendingIdCard: null,
  };
}

function buildSaveInput(tab: TabFormState, sortOrder: number): SaveTravelBookingInput {
  return {
    id: tab.id,
    reasonId: tab.reasonId,
    reasonCustomText: tab.reasonCustomText,
    workDetail: tab.workDetail,
    provinceId: tab.provinceId,
    workLocations: tab.workLocations
      .filter((w) => w.name?.trim())
      .map((w, i) => ({ name: w.name.trim(), sortOrder: i })),
    accommodationId: tab.accommodationId,
    accommodationCustomText: tab.accommodationCustomText,
    needsRoomBooking: tab.needsRoomBooking,
    departDate: tab.departDate,
    returnDate: tab.returnDate,
    departTime: tab.departTime,
    returnTime: tab.returnTime,
    goVehicleId: tab.goVehicleId,
    goVehicleCustomText: tab.goVehicleCustomText,
    goNeedsDepartureLocations: tab.goNeedsDepartureLocations,
    goNeedsTicketBooking: tab.goNeedsTicketBooking,
    goNeedsDepartTime: tab.goNeedsDepartTime,
    goNeedsVehicleRent: tab.goNeedsVehicleRent,
    returnVehicleId: tab.returnVehicleId,
    returnVehicleCustomText: tab.returnVehicleCustomText,
    returnNeedsDepartureLocations: tab.returnNeedsDepartureLocations,
    returnNeedsTicketBooking: tab.returnNeedsTicketBooking,
    returnNeedsDepartTime: tab.returnNeedsDepartTime,
    returnNeedsVehicleRent: tab.returnNeedsVehicleRent,
    departureLocations: tab.departureLocations
      .filter((d) => d.name?.trim())
      .map((d, i) => ({ direction: d.direction, name: d.name.trim(), sortOrder: i })),
    rentVehicleId: tab.rentVehicleId,
    rentVehicleCustomText: tab.rentVehicleCustomText,
    needsRentBooking: tab.needsRentBooking,
    rentStartDate: tab.rentStartDate,
    rentEndDate: tab.rentEndDate,
    notes: tab.notes,
    sortOrder,
  };
}

/* ── Validation — mirrors the server's validateTravelBookingTab (spec §6), but
   accumulates every failing rule (not just the first) for inline field hints. ── */

/** Sentinel option name for AccTravelRentVehicle's default "no rental" choice (spec §2.4) — mirrors request-service.ts's NO_RENT_VEHICLE_NAME. */
const NO_RENT_VEHICLE_NAME = "ไม่เช่า";

export interface TabSettingsMaps {
  reasonById: Map<number, TravelReasonOption>;
  accommodationById: Map<number, Accommodation>;
  vehicleById: Map<number, VehicleOption>;
  rentVehicleById: Map<number, RentVehicle>;
}

export interface FieldIssue {
  key: string;
  label: string;
}

export function validateTab(tab: TabFormState, settings: TabSettingsMaps): FieldIssue[] {
  const issues: FieldIssue[] = [];

  if (!tab.reasonId) {
    issues.push({ key: "reason", label: "เหตุผลการเดินทาง" });
  } else if (settings.reasonById.get(tab.reasonId)?.requiresCustomReason && !tab.reasonCustomText?.trim()) {
    issues.push({ key: "reasonCustom", label: "เหตุผลการเดินทาง (ระบุเพิ่มเติม)" });
  }

  if (!tab.workDetail?.trim()) issues.push({ key: "workDetail", label: "รายละเอียดการไปปฏิบัติงาน" });

  if (!tab.provinceId) issues.push({ key: "province", label: "จังหวัด" });

  if (!tab.workLocations.some((w) => w.name?.trim())) {
    issues.push({ key: "workLocations", label: "สถานที่ไปปฏิบัติงาน (อย่างน้อย 1 แห่ง)" });
  }

  if (!tab.departDate || !tab.returnDate) {
    issues.push({ key: "dateRange", label: "วันเดินทางไป-กลับ" });
  } else if (tab.returnDate < tab.departDate) {
    issues.push({ key: "dateRange", label: "วันที่เดินทางกลับต้องไม่ก่อนวันที่เดินทางไป" });
  }

  if (tab.goNeedsDepartTime && !tab.departTime) issues.push({ key: "departTime", label: "เวลาออกเดินทางขาไป" });
  if (tab.returnNeedsDepartTime && !tab.returnTime) issues.push({ key: "returnTime", label: "เวลาออกเดินทางขากลับ" });

  if (!tab.accommodationId) {
    issues.push({ key: "accommodation", label: "ที่พักค้างคืน" });
  } else if (settings.accommodationById.get(tab.accommodationId)?.requiresCustomReason && !tab.accommodationCustomText?.trim()) {
    issues.push({ key: "accommodationCustom", label: "ที่พักค้างคืน (ระบุเพิ่มเติม)" });
  }

  if (!tab.goVehicleId) {
    issues.push({ key: "goVehicle", label: "ยานพาหนะขาไป" });
  } else if (settings.vehicleById.get(tab.goVehicleId)?.requiresCustomReason && !tab.goVehicleCustomText?.trim()) {
    issues.push({ key: "goVehicleCustom", label: "ยานพาหนะขาไป (ระบุเพิ่มเติม)" });
  }
  if (!tab.returnVehicleId) {
    issues.push({ key: "returnVehicle", label: "ยานพาหนะขากลับ" });
  } else if (settings.vehicleById.get(tab.returnVehicleId)?.requiresCustomReason && !tab.returnVehicleCustomText?.trim()) {
    issues.push({ key: "returnVehicleCustom", label: "ยานพาหนะขากลับ (ระบุเพิ่มเติม)" });
  }

  if (tab.goNeedsDepartureLocations && !tab.departureLocations.some((d) => d.direction === "go" && d.name?.trim())) {
    issues.push({ key: "goDepartureLocations", label: "จุดขึ้นรถ/ขึ้นเครื่องขาไป (อย่างน้อย 1 แห่ง)" });
  }
  if (tab.returnNeedsDepartureLocations && !tab.departureLocations.some((d) => d.direction === "return" && d.name?.trim())) {
    issues.push({ key: "returnDepartureLocations", label: "จุดขึ้นรถ/ขึ้นเครื่องขากลับ (อย่างน้อย 1 แห่ง)" });
  }

  if (tab.goNeedsVehicleRent || tab.returnNeedsVehicleRent) {
    if (!tab.rentVehicleId) {
      issues.push({ key: "rentVehicle", label: "ยานพาหนะที่ต้องการเช่า" });
    } else {
      const rentOption = settings.rentVehicleById.get(tab.rentVehicleId);
      if (rentOption?.requiresCustomReason && !tab.rentVehicleCustomText?.trim()) {
        issues.push({ key: "rentVehicleCustom", label: "ยานพาหนะที่ต้องการเช่า (ระบุเพิ่มเติม)" });
      }
      if (rentOption?.name !== NO_RENT_VEHICLE_NAME) {
        if (!tab.rentStartDate || !tab.rentEndDate) {
          issues.push({ key: "rentDateRange", label: "วันที่เช่ายานพาหนะ" });
        } else if (tab.rentEndDate < tab.rentStartDate) {
          issues.push({ key: "rentDateRange", label: "วันที่คืนรถเช่าต้องไม่ก่อนวันที่เริ่มเช่า" });
        } else if (tab.departDate && tab.returnDate && (tab.rentStartDate < tab.departDate || tab.rentEndDate > tab.returnDate)) {
          issues.push({ key: "rentDateRange", label: "วันที่เช่ายานพาหนะต้องอยู่ในช่วงวันเดินทาง" });
        }
      }
    }
  }

  if ((!tab.idCardFiles || tab.idCardFiles.length === 0) && !tab.pendingIdCard) {
    issues.push({ key: "idCard", label: "รูปบัตรประชาชน (อย่างน้อย 1 ไฟล์)" });
  }

  return issues;
}

/* ── SWR fetchers ── */

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return json.data as T;
}

interface SettingsPayload {
  reasons: TravelReasonOption[];
  accommodations: Accommodation[];
  vehicles: VehicleOption[];
  rentVehicles: RentVehicle[];
}

interface EmployeeApiPayload {
  email: string | null;
  employee: EmployeeContext | null;
  matchMethod: string | null;
  hint: string | null;
  manager: { staffId: number; fullName: string | null; email: string | null; position: string | null; photoUrl: string | null } | null;
  managerReason: string | null;
}

/** Same-department colleague — for the "on behalf of" requester picker. */
export interface RequesterColleague {
  staffId: number;
  fullName: string | null;
  nickname: string | null;
  position: string | null;
  departmentId: number | null;
  departmentName: string | null;
  email: string | null;
  photoUrl: string | null;
  /** The colleague's own manager — the approver when opening a request on their behalf. */
  manager: { staffId: number; fullName: string | null; email: string | null; position: string | null; photoUrl: string | null } | null;
}

/* ── Hook ── */

export function useTravelBookingForm(initial?: TravelBookingGroup | null) {
  const [groupKey, setGroupKey] = useState<string | null>(initial?.groupKey ?? null);
  const [anchorRequestId, setAnchorRequestId] = useState<number | null>(
    initial?.requests?.[0]?.id ?? null,
  );
  const [tabs, setTabs] = useState<TabFormState[]>(() =>
    initial?.requests?.length ? initial.requests.map(tabFromRequest) : [emptyTab()],
  );
  // Live mirrors so imperative flows (removeTab → save) read the latest values, not stale closures.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const anchorRef = useRef(anchorRequestId);
  anchorRef.current = anchorRequestId;
  const saveDraftRef = useRef<(() => Promise<unknown>) | null>(null);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  /** Which leg of `submitAll` is running — drives the progress modal. */
  const [submitPhase, setSubmitPhase] = useState<SubmitPhase | null>(null);

  const { data: provinceData } = useSWR<ProvinceOption[]>(
    "/api/request/travel-booking/options/provinces", jsonFetcher, { revalidateOnFocus: false },
  );
  const { data: settingsData } = useSWR<SettingsPayload>(
    "/api/request/travel-booking/options/settings", jsonFetcher, { revalidateOnFocus: false },
  );
  // The record being resumed, when there is one. Both fetches below carry it so
  // the manager they preview is resolved by the same id rule the submit will use:
  // neither of these routes is AP-17's own, so without the id the card and the
  // submit can land in different databases.
  const resumedId = initial?.requests?.[0]?.id ?? null;
  const { data: employeeData, error: employeeError } = useSWR<EmployeeApiPayload>(
    // ?form=AP-17 so the manager card previews the person this form will actually
    // assign: /api/me/employee is not a form route, so without the hint a tester
    // in UAT mode is shown their real HR manager instead of their UAT one.
    [`/api/me/employee?form=AP-17${resumedId ? `&id=${resumedId}` : ""}`, "travel-booking-form"],
    ([url]: [string, string]) => jsonFetcher(url),
    { revalidateOnFocus: false },
  );
  // Same-department colleagues, for the "open on behalf of" requester picker.
  // jsonFetcher already unwraps the { ok, data } envelope, so this resolves
  // straight to the `data` payload (matches the /api/me/employee SWR above).
  const { data: requesterOptsData, error: requesterOptsError } = useSWR<{
    colleagues: RequesterColleague[];
    environment?: "Production" | "UAT";
  }>(
    [
      resumedId
        ? `/api/request/travel-booking/requesters?id=${resumedId}`
        : "/api/request/travel-booking/requesters",
      "travel-booking-form",
    ],
    ([url]: [string, string]) => jsonFetcher(url),
    { revalidateOnFocus: false },
  );

  const provinces = provinceData ?? [];
  const reasons = settingsData?.reasons ?? [];
  const accommodations = settingsData?.accommodations ?? [];
  const vehicles = settingsData?.vehicles ?? [];
  const rentVehicles = settingsData?.rentVehicles ?? [];
  const optionsLoading = !provinceData || !settingsData;

  const employee = employeeData?.employee ?? null;
  const employeeHint = employeeData?.hint ?? null;
  const employeeEmail = employeeData?.email ?? null;
  const employeeLoading = !employeeData && !employeeError;
  const manager = employeeData?.manager ?? null;
  const managerReason = employeeData?.managerReason ?? null;

  const colleagues = requesterOptsData?.colleagues ?? [];
  // The on-behalf manager comes from this fetch, so the submit gate must not call
  // it missing while it is still in flight.
  const colleaguesLoading = !requesterOptsData && !requesterOptsError;
  const requesterEnvironment: "Production" | "UAT" = requesterOptsData?.environment ?? "Production";

  // "Open on behalf of" — null means submitting as self.
  const [requesterStaffId, setRequesterStaffId] = useState<number | null>(null);

  // Seed from a resumed group's saved requester (TravelBookingRequest.staffId,
  // shared by every tab in the group), once both the group's staff id and our
  // own staff id are known — but only when it differs from the logged-in user
  // (self-authored requests stay null).
  const draftRequesterStaffId = initial?.requests?.[0]?.staffId ?? null;
  useEffect(() => {
    const selfStaffId = employeeData?.employee?.staffId ?? null;
    if (draftRequesterStaffId != null && selfStaffId != null && draftRequesterStaffId !== selfStaffId) {
      setRequesterStaffId(draftRequesterStaffId);
    }
  }, [draftRequesterStaffId, employeeData?.employee?.staffId]);

  /**
   * The chosen requester, resolved from HR when the department list does not
   * hold them.
   *
   * `colleagues` is the actor's own department. The picker's rows are not:
   * search returns people from anywhere, and a resumed draft can name somebody
   * who has since moved. Looking only in `colleagues` left this null in both
   * cases, and the requester card rendered a bare `#10075` — no name, no
   * department, no email, no manager to approve it.
   */
  const [fetchedRequester, setFetchedRequester] = useState<RequesterColleague | null>(null);
  useEffect(() => {
    if (!requesterStaffId) {
      setFetchedRequester(null);
      return;
    }
    if (colleagues.some((c) => c.staffId === requesterStaffId)) {
      setFetchedRequester(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/request/travel-booking/requesters?staffId=${requesterStaffId}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        setFetchedRequester(json?.ok ? (json.data?.colleagues?.[0] ?? null) : null);
      })
      .catch(() => {
        if (!cancelled) setFetchedRequester(null);
      });
    return () => {
      cancelled = true;
    };
  }, [requesterStaffId, colleagues]);

  const selectedRequester = requesterStaffId
    ? (colleagues.find((c) => c.staffId === requesterStaffId) ?? fetchedRequester)
    : null;

  // The requester's other (non-rejected) travel-date ranges — used to lock overlapping days.
  const { data: dateRangesData } = useSWR<{ departDate: string; returnDate: string }[]>(
    ["/api/request/travel-booking/date-ranges", requesterStaffId ?? 0, groupKey ?? ""],
    ([url, sid, gk]: [string, number, string]) =>
      jsonFetcher(`${url}?requesterStaffId=${sid || ""}&excludeGroupKey=${gk || ""}`),
    { revalidateOnFocus: false },
  );
  const existingRanges = dateRangesData ?? [];

  const settingsMaps = useMemo<TabSettingsMaps>(
    () => ({
      reasonById: new Map(reasons.map((r) => [r.id, r])),
      accommodationById: new Map(accommodations.map((a) => [a.id, a])),
      vehicleById: new Map(vehicles.map((v) => [v.id, v])),
      rentVehicleById: new Map(rentVehicles.map((v) => [v.id, v])),
    }),
    [reasons, accommodations, vehicles, rentVehicles],
  );

  /* ── Continuation + live per-diem estimate (spec §5), mirroring the server's
     computePerDiem exactly for day-count/continuation, but using the requester's
     CURRENT allowance rate as a flat estimate (the authoritative amount uses the
     effective-dated EmployeeAllowanceLog and is computed at submit). ── */
  const flatRateLog: AllowanceLogEntry[] = useMemo(
    () => (employee?.allowance != null ? [{ effectiveDate: "0001-01-01", amount: employee.allowance }] : []),
    [employee?.allowance],
  );
  // Real effective-dated allowance history for the requester (rates change over time), so the
  // estimate uses the rate for each travel day — not just the current rate. Falls back to the
  // flat current rate only while the log is still loading.
  const { data: allowanceLogData } = useSWR<{ entries: AllowanceLogEntry[] }>(
    ["/api/request/travel-booking/allowance-log", requesterStaffId ?? 0],
    ([url, sid]: [string, number]) => jsonFetcher(`${url}?requesterStaffId=${sid || ""}`),
    { revalidateOnFocus: false },
  );
  const estimateLog = allowanceLogData?.entries?.length ? allowanceLogData.entries : flatRateLog;

  const continuationFlags = useMemo(
    () =>
      tabs.map((t, i) => {
        const prev = i > 0 ? tabs[i - 1] : null;
        return !!(prev && t.departDate && prev.returnDate && t.departDate === prev.returnDate);
      }),
    [tabs],
  );

  const perDiemEstimates = useMemo(
    () =>
      tabs.map((t, i) => {
        if (!t.departDate || !t.returnDate || t.returnDate < t.departDate) return { days: 0, total: 0, groups: [] };
        return computePerDiem(t.departDate, t.returnDate, continuationFlags[i], estimateLog);
      }),
    [tabs, continuationFlags, estimateLog],
  );

  const totalPerDiemEstimate = useMemo(
    () => perDiemEstimates.reduce((sum, p) => sum + p.total, 0),
    [perDiemEstimates],
  );

  /* ── Validation across all tabs ── */
  const tabIssues = useMemo(() => tabs.map((t) => validateTab(t, settingsMaps)), [tabs, settingsMaps]);
  const canSubmit = tabs.length > 0 && tabIssues.every((issues) => issues.length === 0);

  /* ── Tab CRUD ── */

  const addTab = useCallback(() => {
    setTabs((prev) => [...prev, emptyTab()]);
    setActiveTabIndex(tabs.length);
  }, [tabs.length]);

  const removeTab = useCallback((index: number) => {
    const current = tabsRef.current;
    if (current.length <= 1) return;
    const newTabs = current.filter((_, i) => i !== index);
    tabsRef.current = newTabs; // sync now so an immediate save sees the reduced list
    setTabs(newTabs);
    const newLen = newTabs.length;
    setActiveTabIndex((i) => {
      if (index < i) return i - 1; // a tab before the active one shifts everything left
      if (index > i) return i; // a tab after the active one doesn't move it
      return Math.min(i, newLen - 1); // removed the active tab itself — clamp into range
    });
    // Persist the deletion when this group is already saved (server drops the orphan request).
    if (anchorRef.current) void saveDraftRef.current?.();
  }, []);

  const updateTab = useCallback((index: number, patch: Partial<TabFormState>) => {
    setTabs((prev) => prev.map((t, i) => (i === index ? { ...t, ...patch } : t)));
  }, []);

  /* ── Save (whole group) ── */

  const saveDraft = useCallback(async (): Promise<{ groupKey: string; requestIds: number[] } | null> => {
    setSaving(true);
    try {
      const payload: SaveTravelBookingGroupInput = {
        id: groupKey ?? undefined,
        tabs: tabsRef.current.map((t, i) => buildSaveInput(t, i)),
        requesterStaffId,
      };
      const res = anchorRequestId
        ? await fetch(`/api/request/travel-booking/requests/${anchorRequestId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/request/travel-booking/requests`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกร่างไม่สำเร็จ");
        return null;
      }
      const { groupKey: gk, requestIds } = json.data as { groupKey: string; requestIds: number[] };
      setGroupKey(gk);
      setAnchorRequestId(requestIds[0] ?? null);
      setTabs((prev) => prev.map((t, i) => (requestIds[i] != null ? { ...t, id: requestIds[i] } : t)));
      // Flush any ID cards that were picked but not yet uploaded (AP-1-style pending files).
      await Promise.all(
        tabsRef.current.map(async (t, i) => {
          const rid = requestIds[i];
          if (rid == null || !t.pendingIdCard) return;
          const fd = new FormData();
          fd.append("refType", "idcard");
          fd.append("files", t.pendingIdCard);
          try {
            const upRes = await fetch(`/api/request/travel-booking/requests/${rid}/files`, { method: "POST", body: fd });
            const upJson = await upRes.json();
            if (upJson.ok) {
              const created = upJson.data as TravelBookingFileMeta[];
              setTabs((prev) =>
                prev.map((tt, ii) =>
                  ii === i ? { ...tt, idCardFiles: [...tt.idCardFiles, ...created], pendingIdCard: null } : tt,
                ),
              );
            } else {
              toast.error(upJson.error ?? "อัปโหลดรูปบัตรไม่สำเร็จ");
            }
          } catch {
            toast.error("อัปโหลดรูปบัตรไม่สำเร็จ");
          }
        }),
      );
      return { groupKey: gk, requestIds };
    } catch {
      toast.error("บันทึกร่างไม่สำเร็จ");
      return null;
    } finally {
      setSaving(false);
    }
  }, [groupKey, anchorRequestId, requesterStaffId]);
  saveDraftRef.current = saveDraft;

  /* ── Submit (whole group → N documents) ── */

  const submitAll = useCallback(async (): Promise<{
    ok: boolean;
    count?: number;
    firstRequestId?: number;
    error?: string;
  }> => {
    setSubmitting(true);
    // Both legs act on the whole group at once: one save call for every tab, then one submit
    // call that allocates every running number — so the phase, not a per-document counter,
    // is what actually moves. The UI lists the documents alongside it.
    setSubmitPhase("saving");
    try {
      const saved = await saveDraft();
      if (!saved) return { ok: false, error: "บันทึกร่างไม่สำเร็จ" };
      const anchor = saved.requestIds[0];
      if (anchor == null) return { ok: false, error: "ไม่พบคำขอ" };
      setSubmitPhase("submitting");
      const res = await fetch(`/api/request/travel-booking/requests/${anchor}/submit`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) return { ok: false, error: json.error ?? "ส่งคำขอไม่สำเร็จ" };
      const submitted = json.data as TravelBookingRequest[];
      return { ok: true, count: submitted.length, firstRequestId: submitted[0]?.id };
    } catch {
      return { ok: false, error: "ส่งคำขอไม่สำเร็จ" };
    } finally {
      setSubmitting(false);
      setSubmitPhase(null);
    }
  }, [saveDraft]);

  /* ── ID-card upload (per tab — requires a saved request id) ── */

  const uploadIdCard = useCallback(
    async (tabIndex: number, files: File[]): Promise<boolean> => {
      const tab = tabs[tabIndex];
      if (!tab?.id) {
        toast.error("กรุณาบันทึกร่างก่อนแนบไฟล์");
        return false;
      }
      const fd = new FormData();
      fd.append("refType", "idcard");
      for (const f of files) fd.append("files", f);
      try {
        const res = await fetch(`/api/request/travel-booking/requests/${tab.id}/files`, {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error ?? "อัปโหลดไฟล์ไม่สำเร็จ");
          return false;
        }
        const created = json.data as TravelBookingFileMeta[];
        setTabs((prev) =>
          prev.map((t, i) => (i === tabIndex ? { ...t, idCardFiles: [...t.idCardFiles, ...created] } : t)),
        );
        return true;
      } catch {
        toast.error("อัปโหลดไฟล์ไม่สำเร็จ");
        return false;
      }
    },
    [tabs],
  );

  const removeIdCardFile = useCallback(
    async (tabIndex: number, fileId: number): Promise<boolean> => {
      const tab = tabs[tabIndex];
      if (!tab?.id) return false;
      try {
        const res = await fetch(
          `/api/request/travel-booking/requests/${tab.id}/files?fileId=${fileId}`,
          { method: "DELETE" },
        );
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error ?? "ลบไฟล์ไม่สำเร็จ");
          return false;
        }
        setTabs((prev) =>
          prev.map((t, i) =>
            i === tabIndex ? { ...t, idCardFiles: t.idCardFiles.filter((f) => f.id !== fileId) } : t,
          ),
        );
        return true;
      } catch {
        toast.error("ลบไฟล์ไม่สำเร็จ");
        return false;
      }
    },
    [tabs],
  );

  const reuseIdCard = useCallback(
    async (tabIndex: number, sourceFileId: number): Promise<boolean> => {
      const tab = tabs[tabIndex];
      if (!tab?.id) {
        toast.error("กรุณาบันทึกร่างก่อน");
        return false;
      }
      try {
        const res = await fetch(`/api/request/travel-booking/requests/${tab.id}/files/reuse-idcard`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sourceFileId }),
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error ?? "ใช้บัตรเดิมไม่สำเร็จ");
          return false;
        }
        const created = json.data as TravelBookingFileMeta;
        setTabs((prev) =>
          prev.map((t, i) => (i === tabIndex ? { ...t, idCardFiles: [...t.idCardFiles, created] } : t)),
        );
        toast.success("ใช้บัตรที่เคยแนบแล้ว");
        return true;
      } catch {
        toast.error("ใช้บัตรเดิมไม่สำเร็จ");
        return false;
      }
    },
    [tabs],
  );

  return {
    // options
    provinces,
    reasons,
    accommodations,
    vehicles,
    rentVehicles,
    optionsLoading,
    settingsMaps,

    // requester
    employee,
    employeeHint,
    employeeEmail,
    employeeLoading,
    manager,
    managerReason,

    // on-behalf-of requester picker
    colleagues,
    colleaguesLoading,
    requesterEnvironment,
    existingRanges,
    requesterStaffId,
    setRequesterStaffId,
    selectedRequester,

    // tabs
    groupKey,
    // The group's first request id — the resumed record's, or the one the
    // server hands back on first save. Exposed so the form can say which
    // database the group on screen belongs to: a groupKey names no
    // environment, but an id does (UAT identities start at 900000).
    anchorRequestId,
    tabs,
    activeTabIndex,
    setActiveTabIndex,
    addTab,
    removeTab,
    updateTab,

    // derived
    continuationFlags,
    perDiemEstimates,
    totalPerDiemEstimate,
    tabIssues,
    canSubmit,

    // actions
    saving,
    submitting,
    submitPhase,
    saveDraft,
    submitAll,
    uploadIdCard,
    removeIdCardFile,
    reuseIdCard,
  };
}

export type UseTravelBookingFormResult = ReturnType<typeof useTravelBookingForm>;
