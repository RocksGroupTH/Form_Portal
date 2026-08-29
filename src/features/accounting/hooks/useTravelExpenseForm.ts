"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import useSWR from "swr";
import { computeTotalDistance, computeTotalAmount, computeRequestTotalAmount, computeRequestTotalDistance } from "@/lib/acc/calc";
import {
  normalizeTravelDay,
  hasRateVehicle,
  isVehicleSelected,
  selectedVehicleCount,
  toggleVehicleOnDay,
  addSectionItem as addSectionItemOnDay,
  updateSectionItem as updateSectionItemOnDay,
  removeSectionItem as removeSectionItemOnDay,
  cloneSectionsForDayCopy,
} from "@/features/accounting/lib/travel-sections";
import { syncReturnOriginFromOnward } from "@/features/accounting/lib/route-waypoints";
import { THB } from "@/lib/acc/currency";
import { rateAsOfYmd } from "@/lib/acc/currency-display";
import {
  DEFAULT_COUNTRY,
  claimCountryOptions,
  effectiveClaimCountry,
  lineCurrencyOptions,
  type LineCurrencyContext,
} from "@/features/accounting/lib/claim-currency";
import type {
  TravelExpenseDetail,
  TravelExpenseItem,
  TravelVehicleSection,
  AccVehicle,
  AccBrandOption,
  AccRequest,
} from "@/features/accounting/types";
import type { Direction, TravelItemType } from "@/features/accounting/constants";

/* ── Types ── */

export interface EmployeeData {
  staffId: number;
  firstName: string | null;
  lastName: string | null;
  fullName: string;
  departmentName?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  emailCompBr?: string | null;
}

export interface ManagerData {
  staffId: number;
  fullName: string | null;
  email: string | null;
  position?: string | null;
  photoUrl?: string | null;
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

export interface VisibilityFlags {
  direction: boolean;
  onwardLeg: boolean;
  returnLeg: boolean;
  fareRows: boolean;
  manualKm: boolean;
  parking: boolean;
}

import type { RouteWaypoint } from "@/features/accounting/types";

export interface LegValue {
  origin: string;
  originLat: number;
  originLng: number;
  destination: string;
  destLat: number;
  destLng: number;
  distanceKm: number;
  waypoints?: RouteWaypoint[];
}

interface UseTravelExpenseFormResult {
  travel: TravelExpenseDetail;
  travelDays: TravelExpenseDetail[];
  activeDayIndex: number;
  setActiveDayIndex: (index: number) => void;
  travelDateFrom: string;
  travelDateTo: string;
  /** Sorted YYYY-MM-DD for all selected travel days. */
  selectedTravelDates: string[];
  setTravelDates: (dates: string[]) => void;
  duplicateDay: (sourceIndex: number, targetIndex: number) => void;
  setField: <K extends keyof TravelExpenseDetail>(key: K, value: TravelExpenseDetail[K]) => void;
  setTravel: (updater: (prev: TravelExpenseDetail) => TravelExpenseDetail) => void;

  brandCode: string | null;
  setBrandCode: (code: string | null) => void;

  /**
   * The country this trip was to — always one of `countryOptions`, and the
   * brand's own default whenever nothing else has been answered.
   *
   * Derived rather than stored raw, so a brand whose currency an admin has since
   * switched off can never leave the form posting a country the server refuses
   * with no control on screen to change it.
   */
  countryCode: string;
  setCountryCode: (code: string) => void;
  /**
   * The countries the picker offers. **One option means render nothing** — for
   * a brand with no currency configured that option is Thailand, and the form
   * looks exactly as it did before the feature shipped; for a brand claiming in
   * one foreign currency and no baht it is that country, and there is still
   * nothing to choose between.
   */
  countryOptions: string[];
  /**
   * What each expense line's money controls need. `options` empty is the
   * Thailand answer: no currency control, no rate column, no conversion note anywhere.
   */
  lineCurrency: LineCurrencyContext;

  brands: AccBrandOption[];
  vehicles: AccVehicle[];
  employee: EmployeeData | null;
  /** Reason employee couldn't be matched (from /api/me/employee), if any. */
  employeeHint: string | null;
  /** Login email used for the HR match. */
  employeeEmail: string | null;
  manager: ManagerData | null;
  managerReason: string | null;
  /** Employee fetch in flight (independent of brands/vehicles). */
  employeeLoading: boolean;
  loading: boolean;

  /** Same-department colleagues this user may open a request "on behalf of". */
  colleagues: RequesterColleague[];
  /** Colleague fetch in flight — their manager is not yet known. */
  colleaguesLoading: boolean;
  /** Which environment the colleague picker's managers were resolved in. */
  requesterEnvironment: "Production" | "UAT";
  /** Selected on-behalf requester's StaffId, or null to submit as self. */
  requesterStaffId: number | null;
  setRequesterStaffId: (staffId: number | null) => void;
  /** Resolved colleague record for `requesterStaffId`, or null when submitting as self. */
  selectedRequester: RequesterColleague | null;

  selectedVehicle: AccVehicle | undefined;
  totalDistance: number;
  totalAmount: number;
  requestTotalDistance: number;
  requestTotalAmount: number;

  visible: VisibilityFlags;

  addItem: (type: TravelItemType) => void;
  updateItem: (idx: number, patch: Partial<TravelExpenseItem>) => void;
  removeItem: (idx: number) => void;

  toggleVehicle: (vehicleId: number) => void;
  isVehicleActive: (vehicleId: number) => boolean;
  hasAnyVehicle: boolean;
  manualSections: TravelVehicleSection[];
  addSectionItem: (sectionIndex: number, type: TravelItemType) => void;
  updateSectionItem: (sectionIndex: number, itemIdx: number, patch: Partial<TravelExpenseItem>) => void;
  removeSectionItem: (sectionIndex: number, itemIdx: number) => void;

  setOnwardLeg: (val: LegValue | null) => void;
  setReturnLeg: (val: LegValue | null) => void;

  /**
   * Reload travel state from the server after a save so item ids
   * and existing files are up to date.  Call right after a successful save.
   */
  reloadFromServer: (id: number) => Promise<void>;
}

/* ── Default empty travel ── */

/** Default pinned location (company office / HQ). Onward trips start here by default. */
export const OFFICE_LOCATION = {
  label: "อาคารสิริภิญโญ",
  lat: 13.75805,
  lng: 100.53552,
} as const;

function emptyTravel(): TravelExpenseDetail {
  return {
    sortOrder: 0,
    travelDate: null,
    workDetail: null,
    vehicleId: null,
    vehicleName: null,
    ratePerKm: null,
    isManualEntry: false,
    direction: "round",
    // Onward leg: origin defaults to the office.
    onwardOrigin: OFFICE_LOCATION.label,
    onwardOriginLat: OFFICE_LOCATION.lat,
    onwardOriginLng: OFFICE_LOCATION.lng,
    onwardDestination: null, onwardDestLat: null, onwardDestLng: null,
    onwardDistanceKm: null,
    onwardWaypoints: null,
    // Return leg: no default pins — user selects both ends.
    returnOrigin: null, returnOriginLat: null, returnOriginLng: null,
    returnDestination: null, returnDestLat: null, returnDestLng: null,
    returnDistanceKm: null,
    returnWaypoints: null,
    totalDistanceKm: null,
    totalAmount: null,
    sections: [],
    items: [],
  };
}

function revokeSectionPendingFiles(sections: TravelExpenseDetail["sections"]) {
  for (const sec of sections ?? []) {
    revokeItemPendingFiles(sec.items ?? []);
  }
}

function revokeItemPendingFiles(items: TravelExpenseItem[]) {
  for (const it of items) {
    for (const pf of it.pendingFiles ?? []) {
      URL.revokeObjectURL(pf.previewUrl);
    }
  }
}

/** Clone expense rows for day copy — amounts/types only (no attachments). */
function cloneItemsForDayCopy(items: TravelExpenseItem[]): TravelExpenseItem[] {
  return items.map((it, i) => ({
    itemType: it.itemType,
    amount: Number(it.amount) || 0,
    sortOrder: i,
    files: [],
    pendingFiles: [],
  }));
}

function seedTravelDays(initial?: AccRequest | null): TravelExpenseDetail[] {
  if (initial?.travelDays?.length) {
    return initial.travelDays.map((d, i) => ({ ...emptyTravel(), ...d, sortOrder: d.sortOrder ?? i }));
  }
  if (initial?.travel) {
    return [{ ...emptyTravel(), ...initial.travel, sortOrder: initial.travel.sortOrder ?? 0 }];
  }
  return [{ ...emptyTravel(), travelDate: null }];
}

/** Inclusive list of YYYY-MM-DD from lo to hi. @deprecated import from format-travel-dates */
export { enumerateTravelDates } from "@/features/accounting/lib/format-travel-dates";

function syncDaysToSelectedDates(
  prev: TravelExpenseDetail[],
  wantedDates: string[],
): TravelExpenseDetail[] {
  if (wantedDates.length === 0) {
    return [{ ...emptyTravel(), travelDate: null }];
  }
  const byDate = new Map<string, TravelExpenseDetail>();
  for (const d of prev) {
    if (d.travelDate) byDate.set(d.travelDate, d);
  }
  return wantedDates.map((date, i) => {
    const existing = byDate.get(date);
    if (existing) return { ...existing, sortOrder: i, travelDate: date };
    return { ...emptyTravel(), travelDate: date, sortOrder: i };
  });
}

/* ── SWR fetcher ── */

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return json.data as T;
}

/* ── Hook ── */

export function useTravelExpenseForm(
  initial?: AccRequest | null,
): UseTravelExpenseFormResult {
  const [travelDays, setTravelDays] = useState<TravelExpenseDetail[]>(() => seedTravelDays(initial));
  const [activeDayIndex, setActiveDayIndex] = useState(0);
  const [brandCode, setBrandCode] = useState<string | null>(
    initial?.brandCode ?? null
  );
  // What the user picked. `countryCode` below is this reconciled against what
  // the brand actually offers — never this value raw.
  //
  // **Blank, not `"TH"`, for a claim nobody has answered yet.** The two were
  // the same thing until migration 131; they are not now, because a brand may
  // switch baht off and open on somewhere else. Seeding `"TH"` would look like
  // a deliberate choice of Thailand and beat the brand's own default wherever
  // Thailand happened to still be offered. `effectiveClaimCountry` reads blank
  // as "unanswered" and answers `defaultClaimCountry`.
  const [pickedCountry, setPickedCountry] = useState<string>(
    initial?.countryCode ?? "",
  );

  const activeIndex = Math.min(activeDayIndex, Math.max(0, travelDays.length - 1));
  const travel = travelDays[activeIndex] ?? travelDays[0] ?? emptyTravel();

  const patchActiveDay = useCallback(
    (updater: (prev: TravelExpenseDetail) => TravelExpenseDetail) => {
      setTravelDays((prev) => {
        const copy = Array.from(prev);
        const idx = Math.min(activeDayIndex, copy.length - 1);
        copy[idx] = updater(copy[idx] ?? emptyTravel());
        return copy;
      });
    },
    [activeDayIndex],
  );

  // SWR data fetching
  const { data: brandsData } = useSWR<AccBrandOption[]>(
    "/api/request/accounting/options/brands",
    jsonFetcher,
    { revalidateOnFocus: false }
  );
  const { data: vehiclesData } = useSWR<AccVehicle[]>(
    "/api/request/accounting/options/vehicles",
    jsonFetcher,
    { revalidateOnFocus: false }
  );
  // NOTE: use a feature-scoped SWR key (not the bare "/api/me/employee" string).
  // useUserPhoto + UserProfileModal also fetch that URL but with a fetcher that
  // returns the raw { ok, data } envelope. SWR caches by key, so sharing the
  // string key would hand this hook the wrong shape (employee nested under .data).
  // A tuple key gives us an isolated cache entry with the unwrapped shape.
  // The record being resumed, when there is one. Both fetches below carry it so
  // the manager they preview is resolved by the same id rule the submit will use:
  // the resume href puts the id in the query, which per-form routing strips, and
  // neither of these routes is AP-1's own. A brand-new request has no id.
  const resumedIdParam = initial?.id ? `&id=${initial.id}` : "";
  const { data: employeeApiData, error: employeeError } = useSWR<{
    email: string | null;
    employee: {
      staffId: number;
      firstName: string | null;
      lastName: string | null;
      fullName: string;
      departmentName?: string | null;
      position?: string | null;
      photoUrl?: string | null;
    } | null;
    matchMethod: string | null;
    hint: string | null;
    manager: ManagerData | null;
    managerReason: string | null;
  }>(
    // ?form=AP-1 so the manager card previews the person this form will actually
    // assign: /api/me/employee is not a form route, so without the hint a tester
    // in UAT mode is shown their real HR manager instead of their UAT one.
    [`/api/me/employee?form=AP-1${resumedIdParam}`, "acc-travel-form"],
    ([url]: [string, string]) => jsonFetcher(url),
    { revalidateOnFocus: false }
  );
  // Same-department colleagues, for the "open on behalf of" requester picker.
  // jsonFetcher already unwraps the { ok, data } envelope, so this resolves
  // straight to the `data` payload (matches the /api/me/employee SWR above).
  const { data: requesterOptsData, error: requesterOptsError } = useSWR<{
    colleagues: RequesterColleague[];
    environment?: "Production" | "UAT";
  }>(
    [
      initial?.id
        ? `/api/request/accounting/requesters?id=${initial.id}`
        : "/api/request/accounting/requesters",
      "acc-travel-form",
    ],
    ([url]: [string, string]) => jsonFetcher(url),
    { revalidateOnFocus: false },
  );

  const brands = brandsData ?? [];
  const vehicles = vehiclesData ?? [];

  /* ── The selected brand's currency configuration, and what follows from it ──
   *
   * Derived on every render rather than mirrored into state: the brands list
   * arrives asynchronously and an admin may change it under a resumed draft, and
   * a mirrored copy would go stale in exactly those two cases.
   *
   * **`brandsData` being undefined is not "no currency".** Nothing disables Save
   * while the brands list is in flight, and `brandCode` is seeded from the
   * resumed draft synchronously — so a foreign draft is savable for the moment
   * before SWR answers. Reconciling against an empty list there would post `TH`
   * for a trip to Malaysia and silently re-read every ringgit line as baht.
   * Until the list is known the draft's own stored country stands.
   *
   * The server re-derives all of this from the registry regardless
   * (`resolveClaimCountry`), so this cannot widen where a claim may be filed
   * from — only narrow it wrongly, which is what the guard prevents.
   */
  const brandsKnown = !!brandsData;
  const selectedBrand = brandsKnown
    ? brands.find((b) => b.brandCode === brandCode) ?? null
    : null;
  const countryOptions = brandsKnown
    ? claimCountryOptions(selectedBrand)
    : [DEFAULT_COUNTRY];
  const countryCode = brandsKnown
    ? effectiveClaimCountry(pickedCountry, selectedBrand)
    : (pickedCountry || DEFAULT_COUNTRY).trim().toUpperCase();

  /* ── The preview rate ──
   *
   * Display only, and the client's single currency-shaped fetch. The server
   * fetches its own rate on every save and never trusts one from here — AP-2
   * stores whatever the browser posted, which is the one part of its approach
   * this feature deliberately does not reuse.
   *
   * **A Thai claim passes `null` as the SWR key, so it makes no request at
   * all.** That is what keeps the promise that Thailand looks and behaves
   * exactly as it did before this feature shipped.
   */
  const foreignCurrency = lineCurrencyOptions(countryCode)[0] ?? null;
  const { data: fxData } = useSWR<{ rate: number; asOf?: string | null }>(
    foreignCurrency ? `/api/request/accounting/fx-rate?currency=${foreignCurrency}` : null,
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const previewRate =
    fxData && Number.isFinite(fxData.rate) && fxData.rate > 0 ? fxData.rate : null;
  /* Which day's rate that is. The route has always answered it — `resolveRate`
     returns `{ rate, asOf, source }` — and this is where it stops being thrown
     away. The ECB publishes on working days only, so the figure a Saturday
     preview shows is Friday's, and the note is where somebody can see that. */
  const previewRateAsOf = previewRate === null ? null : rateAsOfYmd(fxData?.asOf ?? null);
  const lineCurrency: LineCurrencyContext = useMemo(
    () => ({
      options: lineCurrencyOptions(countryCode),
      defaultCurrency: foreignCurrency ?? THB,
      rate: previewRate,
      rateAsOf: previewRateAsOf,
    }),
    [countryCode, foreignCurrency, previewRate, previewRateAsOf],
  );

  const loading = !brandsData || !vehiclesData || !employeeApiData;

  const employee = employeeApiData?.employee ?? null;
  const employeeHint = employeeApiData?.hint ?? null;
  const employeeEmail = employeeApiData?.email ?? null;
  const manager = employeeApiData?.manager ?? null;
  const managerReason = employeeApiData?.managerReason ?? null;
  // Employee display is independent of brands/vehicles (those query the
  // accounting DB on 161 and may not be ready). Resolve as soon as HR responds.
  const employeeLoading = !employeeApiData && !employeeError;

  const colleagues = requesterOptsData?.colleagues ?? [];
  // The on-behalf manager comes from this fetch, so the submit gate must not call
  // it missing while it is still in flight.
  const colleaguesLoading = !requesterOptsData && !requesterOptsError;
  const requesterEnvironment = requesterOptsData?.environment ?? "Production";

  // "Open on behalf of" — null means submitting as self.
  const [requesterStaffId, setRequesterStaffId] = useState<number | null>(null);

  // Seed from a resumed draft/request's saved requester (AccRequest.staffId),
  // once both the draft's staff id and our own staff id are known — but only
  // when it differs from the logged-in user (self-authored requests stay null).
  useEffect(() => {
    const draftStaffId = initial?.staffId ?? null;
    const selfStaffId = employeeApiData?.employee?.staffId ?? null;
    if (draftStaffId != null && selfStaffId != null && draftStaffId !== selfStaffId) {
      setRequesterStaffId(draftStaffId);
    }
  }, [initial?.staffId, employeeApiData?.employee?.staffId]);

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
    fetch(`/api/request/accounting/requesters?staffId=${requesterStaffId}`)
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

  const travelNorm = useMemo(() => normalizeTravelDay(travel), [travel]);

  // Derived: rate vehicle (car/motorcycle with map)
  const selectedVehicle = useMemo(
    () => (hasRateVehicle(travelNorm) ? vehicles.find((v) => v.id === travelNorm.vehicleId) : undefined),
    [vehicles, travelNorm],
  );

  const manualSections = travelNorm.sections ?? [];
  const hasAnyVehicle = selectedVehicleCount(travelNorm) > 0;

  const isVehicleActive = useCallback(
    (vehicleId: number) => isVehicleSelected(travelNorm, vehicleId),
    [travelNorm],
  );

  // Derived: live totals
  const totalDistance = useMemo(() => computeTotalDistance(travelNorm), [travelNorm]);
  const totalAmount = useMemo(() => computeTotalAmount(travelNorm), [travelNorm]);
  const requestTotalDistance = useMemo(() => computeRequestTotalDistance(travelDays), [travelDays]);
  const requestTotalAmount = useMemo(() => computeRequestTotalAmount(travelDays), [travelDays]);

  const selectedTravelDates = useMemo(
    () =>
      travelDays
        .map((d) => d.travelDate)
        .filter((d): d is string => !!d)
        .sort(),
    [travelDays],
  );
  const travelDateFrom = selectedTravelDates[0] ?? "";
  const travelDateTo = selectedTravelDates[selectedTravelDates.length - 1] ?? "";

  const setTravelDates = useCallback((dates: string[]) => {
    const sorted = Array.from(new Set(dates)).sort();
    setTravelDays((prev) => syncDaysToSelectedDates(prev, sorted));
    setActiveDayIndex((i) => (sorted.length === 0 ? 0 : Math.min(i, sorted.length - 1)));
  }, []);

  // Derived: visibility flags (rate vehicle route + per-section manual expenses in UI)
  const visible = useMemo<VisibilityFlags>(() => {
    if (!hasAnyVehicle) {
      return {
        direction: false,
        onwardLeg: false,
        returnLeg: false,
        fareRows: false,
        manualKm: false,
        parking: false,
      };
    }
    if (selectedVehicle && !selectedVehicle.isManualEntry) {
      const dir: Direction | null = travelNorm.direction;
      return {
        direction: true,
        onwardLeg: dir !== "return",
        returnLeg: dir !== "onward",
        fareRows: false,
        manualKm: false,
        parking: true,
      };
    }
    return {
      direction: false,
      onwardLeg: false,
      returnLeg: false,
      fareRows: manualSections.length > 0,
      manualKm: manualSections.length > 0,
      parking: false,
    };
  }, [hasAnyVehicle, selectedVehicle, travelNorm.direction, manualSections.length]);

  // Field setter
  const setField = useCallback(
    <K extends keyof TravelExpenseDetail>(key: K, value: TravelExpenseDetail[K]) => {
      patchActiveDay((prev) => ({ ...prev, [key]: value }));
    },
    [patchActiveDay]
  );

  const setTravel = useCallback(
    (updater: (prev: TravelExpenseDetail) => TravelExpenseDetail) => {
      patchActiveDay(updater);
    },
    [patchActiveDay]
  );

  const duplicateDay = useCallback((sourceIndex: number, targetIndex: number) => {
    setTravelDays((prev) => {
      const src = prev[sourceIndex];
      const target = prev[targetIndex];
      if (!src || !target || sourceIndex === targetIndex) return prev;
      revokeItemPendingFiles(target.items ?? []);
      revokeSectionPendingFiles(target.sections);
      const copy = Array.from(prev);
      copy[targetIndex] = normalizeTravelDay({
        ...target,
        workDetail: src.workDetail,
        vehicleId: src.vehicleId,
        vehicleName: src.vehicleName,
        ratePerKm: src.ratePerKm,
        isManualEntry: src.isManualEntry,
        direction: src.direction,
        onwardOrigin: src.onwardOrigin,
        onwardOriginLat: src.onwardOriginLat,
        onwardOriginLng: src.onwardOriginLng,
        onwardDestination: src.onwardDestination,
        onwardDestLat: src.onwardDestLat,
        onwardDestLng: src.onwardDestLng,
        onwardDistanceKm: src.onwardDistanceKm,
        onwardWaypoints: src.onwardWaypoints ? Array.from(src.onwardWaypoints) : null,
        returnOrigin: src.returnOrigin,
        returnOriginLat: src.returnOriginLat,
        returnOriginLng: src.returnOriginLng,
        returnDestination: src.returnDestination,
        returnDestLat: src.returnDestLat,
        returnDestLng: src.returnDestLng,
        returnDistanceKm: src.returnDistanceKm,
        returnWaypoints: src.returnWaypoints ? Array.from(src.returnWaypoints) : null,
        totalDistanceKm: src.totalDistanceKm,
        sections: cloneSectionsForDayCopy(src.sections),
        items: cloneItemsForDayCopy(src.items ?? []),
      });
      return copy;
    });
  }, []);

  const toggleVehicle = useCallback(
    (vehicleId: number) => {
      setTravelDays((prev) => {
        const copy = Array.from(prev);
        const idx = Math.min(activeDayIndex, copy.length - 1);
        const cur = copy[idx] ?? emptyTravel();
        if (isVehicleSelected(cur, vehicleId)) {
          const v = vehicles.find((veh) => veh.id === vehicleId);
          if (v?.isManualEntry) {
            const sec = (cur.sections ?? []).find((s) => s.vehicleId === vehicleId);
            revokeItemPendingFiles(sec?.items ?? []);
          } else {
            revokeItemPendingFiles(cur.items ?? []);
          }
        }
        copy[idx] = toggleVehicleOnDay(cur, vehicleId, vehicles);
        return copy;
      });
    },
    [vehicles, activeDayIndex],
  );

  const setFieldOverridden = useCallback(
    <K extends keyof TravelExpenseDetail>(key: K, value: TravelExpenseDetail[K]) => {
      patchActiveDay((prev) => {
        const next = { ...prev, [key]: value };
        if (key === "direction" && value === "round") {
          return normalizeTravelDay(syncReturnOriginFromOnward(next));
        }
        return normalizeTravelDay(next);
      });
    },
    [patchActiveDay],
  );

  const addSectionItem = useCallback((sectionIndex: number, type: TravelItemType) => {
    patchActiveDay((prev) => addSectionItemOnDay(prev, sectionIndex, type));
  }, [patchActiveDay]);

  const updateSectionItem = useCallback(
    (sectionIndex: number, itemIdx: number, patch: Partial<TravelExpenseItem>) => {
      patchActiveDay((prev) => updateSectionItemOnDay(prev, sectionIndex, itemIdx, patch));
    },
    [patchActiveDay],
  );

  const removeSectionItem = useCallback((sectionIndex: number, itemIdx: number) => {
    patchActiveDay((prev) => removeSectionItemOnDay(prev, sectionIndex, itemIdx));
  }, [patchActiveDay]);

  // Items helpers — new rows go to the FRONT so the latest entry shows on top.
  // (SortOrder is renormalized to the array index on save, so order persists.)
  const addItem = useCallback((type: TravelItemType) => {
    patchActiveDay((prev) => ({
      ...prev,
      items: [
        // `localId` because this prepends: without a stable identity the rows
        // below would all shift index and React would rebind each component —
        // and its in-flight receipt read — to a different row.
        {
          itemType: type,
          amount: 0,
          sortOrder: 0,
          files: [],
          localId: `row_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        },
        ...prev.items,
      ],
    }));
  }, [patchActiveDay]);

  const updateItem = useCallback((idx: number, patch: Partial<TravelExpenseItem>) => {
    patchActiveDay((prev) => {
      const items = Array.from(prev.items);
      items[idx] = { ...items[idx], ...patch };
      return { ...prev, items };
    });
  }, [patchActiveDay]);

  const removeItem = useCallback((idx: number) => {
    patchActiveDay((prev) => {
      const items = Array.from(prev.items).filter((_, i) => i !== idx);
      return { ...prev, items };
    });
  }, [patchActiveDay]);

  const reloadFromServer = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/request/accounting/requests/${id}`);
      const json: { ok: boolean; data?: AccRequest; error?: string } = await res.json();
      if (!json.ok || !json.data) return;
      // The country as the **server** reconciled it. A draft naming one the
      // brand no longer offers comes back as the brand's default, so the picker
      // and the stored row cannot disagree after a save. Each line's own
      // currency and rate arrive with the items below. A null lands as blank,
      // which is "unanswered" and resolves to that same default.
      setPickedCountry((json.data.countryCode ?? "").trim().toUpperCase());
      const days = json.data.travelDays?.length
        ? json.data.travelDays
        : json.data.travel
          ? [json.data.travel]
          : null;
      if (days) {
        setTravelDays(
          days.map((d, i) =>
            normalizeTravelDay({ ...emptyTravel(), ...d, sortOrder: d.sortOrder ?? i }),
          ),
        );
        setActiveDayIndex(0);
      }
    } catch {
      // Non-fatal — item ids may not be refreshed, but form is still usable
    }
  }, []);

  const setOnwardLeg = useCallback((val: LegValue | null) => {
    patchActiveDay((prev) => {
      const next: TravelExpenseDetail = {
        ...prev,
        onwardOrigin: val?.origin ?? null,
        onwardOriginLat: val?.originLat ?? null,
        onwardOriginLng: val?.originLng ?? null,
        onwardDestination: val?.destination ?? null,
        onwardDestLat: val?.destLat ?? null,
        onwardDestLng: val?.destLng ?? null,
        onwardDistanceKm: val?.distanceKm ?? null,
        onwardWaypoints: val?.waypoints?.length ? Array.from(val.waypoints) : null,
      };
      if (next.direction === "round") {
        return normalizeTravelDay(syncReturnOriginFromOnward(next));
      }
      return normalizeTravelDay(next);
    });
  }, [patchActiveDay]);

  const setReturnLeg = useCallback((val: LegValue | null) => {
    patchActiveDay((prev) => ({
      ...prev,
      returnOrigin: val?.origin ?? null,
      returnOriginLat: val?.originLat ?? null,
      returnOriginLng: val?.originLng ?? null,
      returnDestination: val?.destination ?? null,
      returnDestLat: val?.destLat ?? null,
      returnDestLng: val?.destLng ?? null,
      returnDistanceKm: val?.distanceKm ?? null,
      returnWaypoints: val?.waypoints?.length ? Array.from(val.waypoints) : null,
    }));
  }, [patchActiveDay]);

  return {
    travel,
    travelDays,
    activeDayIndex: activeIndex,
    setActiveDayIndex,
    travelDateFrom,
    travelDateTo,
    selectedTravelDates,
    setTravelDates,
    duplicateDay,
    setField: setFieldOverridden,
    setTravel,
    brandCode,
    setBrandCode,
    countryCode,
    setCountryCode: setPickedCountry,
    countryOptions,
    lineCurrency,
    brands,
    vehicles,
    employee,
    employeeHint,
    employeeEmail,
    manager,
    managerReason,
    employeeLoading,
    loading,
    colleagues,
    colleaguesLoading,
    requesterEnvironment,
    requesterStaffId,
    setRequesterStaffId,
    selectedRequester,
    selectedVehicle,
    totalDistance,
    totalAmount,
    requestTotalDistance,
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
  };
}
