"use client";

import { useMemo } from "react";
import { Briefcase, Calendar, Car, FileCheck, Hotel, MapPin, StickyNote } from "lucide-react";
import { LocalSearchSelect } from "./LocalSearchSelect";
import { WorkLocationList } from "./WorkLocationList";
import { DateRangeField } from "./DateRangeField";
import { TransportSection } from "./TransportSection";
import { IdCardUpload } from "./IdCardUpload";
import {
  OptionCardSelect,
  SectionCard,
  errInputStyle,
  errLabelStyle,
  fmtBaht,
  inputClass,
  inputStyle,
  labelClass,
  labelStyle,
  requiredStar,
} from "./shared";
import type { FieldIssue, TabFormState } from "@/features/travel-booking/hooks/useTravelBookingForm";
import type {
  Accommodation,
  ProvinceOption,
  RentVehicle,
  TravelReasonOption,
  VehicleOption,
} from "@/features/travel-booking/types";

/** Sentinel option name for AccTravelRentVehicle's default "no rental" choice — mirrors the server. */
const NO_RENT_VEHICLE_NAME = "ไม่เช่า";

interface TravelBookingTabProps {
  tab: TabFormState;
  isContinuation: boolean;
  perDiemEstimate: { days: number; total: number; groups: { rate: number; days: number }[] };
  allowanceRate: number | null;
  reasons: TravelReasonOption[];
  accommodations: Accommodation[];
  vehicles: VehicleOption[];
  rentVehicles: RentVehicle[];
  provinces: ProvinceOption[];
  /** Days locked in the วันเดินทาง picker (already booked by other trips). */
  disabledTravelDates?: string[];
  issues: FieldIssue[];
  triedSubmit: boolean;
  /** ผู้ขอเบิก (self = null) — keys the ID-card reuse/consent lookup. */
  requesterStaffId?: number | null;
  onChange: (patch: Partial<TabFormState>) => void;
  onSelectPendingIdCard: (file: File | null) => void;
  onRemoveIdCardFile: (fileId: number) => Promise<boolean>;
}

export function TravelBookingTab({
  tab,
  isContinuation,
  perDiemEstimate,
  allowanceRate,
  reasons,
  accommodations,
  vehicles,
  rentVehicles,
  provinces,
  disabledTravelDates,
  issues,
  triedSubmit,
  requesterStaffId,
  onChange,
  onSelectPendingIdCard,
  onRemoveIdCardFile,
}: TravelBookingTabProps) {
  const errorKeys = useMemo(() => new Set(issues.map((i) => i.key)), [issues]);
  const hasErr = (key: string) => triedSubmit && errorKeys.has(key);
  // TransportSection applies error styling unconditionally on the keys it's given,
  // so only hand it the issue set once the user has attempted a submit.
  const displayErrorKeys = useMemo(() => (triedSubmit ? errorKeys : new Set<string>()), [triedSubmit, errorKeys]);

  const selectedReason = reasons.find((r) => r.id === tab.reasonId);
  const selectedAccommodation = accommodations.find((a) => a.id === tab.accommodationId);
  const selectedGoVehicle = vehicles.find((v) => v.id === tab.goVehicleId);
  const selectedReturnVehicle = vehicles.find((v) => v.id === tab.returnVehicleId);
  const selectedRentVehicle = rentVehicles.find((v) => v.id === tab.rentVehicleId);

  const showRentBlock = tab.goNeedsVehicleRent || tab.returnNeedsVehicleRent;
  const showRentDates = showRentBlock && !!selectedRentVehicle && selectedRentVehicle.name !== NO_RENT_VEHICLE_NAME;

  /**
   * One vehicle is chosen for the whole trip (ไป-กลับ) — it drives both directions.
   * Inherits the vehicle's admin config into both go/return flags and clears the
   * per-direction place/time so stale picks can't linger when the vehicle changes.
   */
  const selectVehicleBoth = (id: number | null) => {
    const v = id ? vehicles.find((x) => x.id === id) : undefined;
    const needDep = !!(v?.needsDepartureLocations && v.places.length);
    const needTime = !!v?.needsDepartTime;
    onChange({
      goVehicleId: id,
      returnVehicleId: id,
      goVehicleCustomText: null,
      returnVehicleCustomText: null,
      goNeedsDepartureLocations: needDep,
      returnNeedsDepartureLocations: needDep,
      goNeedsTicketBooking: !!v?.needsTicketBooking,
      returnNeedsTicketBooking: !!v?.needsTicketBooking,
      goNeedsDepartTime: needTime,
      returnNeedsDepartTime: needTime,
      goNeedsVehicleRent: !!v?.needsVehicleRent,
      returnNeedsVehicleRent: !!v?.needsVehicleRent,
      departTime: needTime ? tab.departTime : null,
      returnTime: needTime ? tab.returnTime : null,
      departureLocations: [],
    });
  };

  const provinceOptions = provinces.map((p) => ({ value: String(p.id), label: p.nameTh, subLabel: p.nameEn }));
  const reasonOptions = reasons.map((r) => ({ value: String(r.id), label: r.name, icon: r.icon }));
  const accommodationOptions = accommodations.map((a) => ({ value: String(a.id), label: a.name, icon: a.icon }));
  const vehicleOptions = vehicles.map((v) => ({ value: String(v.id), label: v.name, icon: v.icon }));
  const rentVehicleOptions = rentVehicles.map((v) => ({ value: String(v.id), label: v.name, icon: v.icon }));

  return (
    <div className="w-full max-w-full mx-auto flex flex-col gap-4 min-w-0">
      {/* เหตุผล + รายละเอียด + จังหวัด/สถานที่ */}
      <SectionCard icon={<Briefcase size={15} />} title="เหตุผลและรายละเอียดการเดินทาง">
        <div data-field="reason">
          <label className={labelClass} style={errLabelStyle(hasErr("reason"))}>
            เหตุผลการเดินทาง{requiredStar}
          </label>
          <OptionCardSelect
            options={reasonOptions}
            value={tab.reasonId != null ? String(tab.reasonId) : ""}
            onChange={(v) => onChange({ reasonId: Number(v), reasonCustomText: tab.reasonCustomText })}
            hasError={hasErr("reason")}
          />
        </div>

        {selectedReason?.requiresCustomReason && (
          <div data-field="reasonCustom">
            <label className={labelClass} style={errLabelStyle(hasErr("reasonCustom"))}>
              ระบุเหตุผลเพิ่มเติม{requiredStar}
            </label>
            <input
              value={tab.reasonCustomText ?? ""}
              onChange={(e) => onChange({ reasonCustomText: e.target.value || null })}
              placeholder="ระบุรายละเอียด..."
              className={inputClass}
              style={{ ...inputStyle, ...errInputStyle(hasErr("reasonCustom")) }}
            />
          </div>
        )}

        <div data-field="workDetail">
          <label className={labelClass} style={errLabelStyle(hasErr("workDetail"))}>
            รายละเอียดการไปปฏิบัติงาน{requiredStar}
          </label>
          <textarea
            rows={3}
            value={tab.workDetail ?? ""}
            onChange={(e) => onChange({ workDetail: e.target.value || null })}
            placeholder="อธิบายจุดประสงค์การเดินทางและงานที่ไปปฏิบัติ..."
            className={inputClass}
            style={{ ...inputStyle, resize: "vertical", ...errInputStyle(hasErr("workDetail")) }}
          />
        </div>

        <div data-field="workLocations">
          <label className={labelClass} style={errLabelStyle(hasErr("workLocations"))}>
            <MapPin size={11} className="inline mr-1 -mt-0.5" />
            สถานที่ไปปฏิบัติงาน{requiredStar}
          </label>
          <WorkLocationList
            items={tab.workLocations}
            onChange={(workLocations) => onChange({ workLocations })}
            hasError={hasErr("workLocations")}
            onProvinceDetected={({ label, region }) => {
              // Prefer the region field, else scan the label (Bangkok often has no region).
              // English province names first (ORS labels are English) — they're less ambiguous
              // than short Thai names — with a Thai fallback.
              const matchIn = (hay: string) => {
                const h = hay.toLowerCase();
                return (
                  provinces.find((p) => {
                    const en = (p.nameEn ?? "").trim().toLowerCase();
                    return en.length >= 3 && h.includes(en);
                  }) ?? provinces.find((p) => h.includes(p.nameTh.trim().toLowerCase()))
                );
              };
              const match = (region ? matchIn(region) : undefined) ?? matchIn(label);
              if (match && match.id !== tab.provinceId) onChange({ provinceId: match.id });
            }}
          />
        </div>

        <div data-field="province">
          <label className={labelClass} style={errLabelStyle(hasErr("province"))}>
            จังหวัด{requiredStar}
          </label>
          <LocalSearchSelect
            options={provinceOptions}
            value={tab.provinceId != null ? String(tab.provinceId) : ""}
            onChange={(v) => onChange({ provinceId: v ? Number(v) : null })}
            placeholder="พิมพ์ค้นหาจังหวัด..."
            emptyLabel="ไม่พบจังหวัด"
            hasError={hasErr("province")}
          />
        </div>
      </SectionCard>

      {/* วันเดินทาง + ที่พัก */}
      <SectionCard icon={<Calendar size={15} />} title="วันเดินทางและที่พัก">
        <div data-field="dateRange">
          <DateRangeField
            label="วันเดินทาง (ไป–กลับ)"
            departDate={tab.departDate}
            returnDate={tab.returnDate}
            onChange={({ departDate, returnDate }) => onChange({ departDate, returnDate })}
            hasError={hasErr("dateRange")}
            disabledDates={disabledTravelDates}
            continuationHint={
              isContinuation
                ? "ต่อเนื่องจากคำขอก่อนหน้า — วันแรกนับ Per diem ให้แล้วในคำขอก่อนหน้า (-1 วัน)"
                : null
            }
          />
        </div>

        <div data-field="accommodation">
          <label className={labelClass} style={errLabelStyle(hasErr("accommodation"))}>
            <Hotel size={11} className="inline mr-1 -mt-0.5" />
            ที่พักค้างคืน{requiredStar}
          </label>
          <OptionCardSelect
            options={accommodationOptions}
            value={tab.accommodationId != null ? String(tab.accommodationId) : ""}
            onChange={(v) => {
              const id = Number(v);
              const a = accommodations.find((x) => x.id === id);
              onChange({ accommodationId: id, accommodationCustomText: null, needsRoomBooking: !!a?.needsRoomBooking });
            }}
            hasError={hasErr("accommodation")}
          />
        </div>

        {selectedAccommodation?.needsRoomBooking && (
          <div
            className="flex items-center gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            <Hotel size={14} /> ทีม Admin จะจองห้องพักให้สำหรับที่พักนี้
          </div>
        )}
      </SectionCard>

      {/* ยานพาหนะ (ไป-กลับ ตัวเดียว) + จุดขึ้น/เวลา แยกทิศ + เช่ารถ */}
      <SectionCard icon={<Car size={15} />} title="ยานพาหนะ">
        <div data-field="goVehicle">
          <label className={labelClass} style={errLabelStyle(hasErr("goVehicle"))}>
            เลือกยานพาหนะ (ใช้ทั้งขาไป–ขากลับ){requiredStar}
          </label>
          <OptionCardSelect
            options={vehicleOptions}
            value={tab.goVehicleId != null ? String(tab.goVehicleId) : ""}
            onChange={(v) => selectVehicleBoth(Number(v))}
            hasError={hasErr("goVehicle")}
          />
        </div>

        {selectedGoVehicle?.needsTicketBooking && (
          <div
            className="flex items-center gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            <Car size={14} /> ทีม Admin จะจองตั๋วให้สำหรับยานพาหนะนี้
          </div>
        )}

        {selectedGoVehicle && (selectedGoVehicle.needsDepartureLocations || selectedGoVehicle.needsDepartTime) && (
          <>
            <TransportSection
              direction="go"
              vehicle={selectedGoVehicle}
              time={tab.departTime}
              departureLocations={tab.departureLocations}
              onChangeTime={(v) => onChange({ departTime: v })}
              onChangeDepartureLocations={(all) => onChange({ departureLocations: all })}
              errorKeys={displayErrorKeys}
            />
            <TransportSection
              direction="return"
              vehicle={selectedGoVehicle}
              time={tab.returnTime}
              departureLocations={tab.departureLocations}
              onChangeTime={(v) => onChange({ returnTime: v })}
              onChangeDepartureLocations={(all) => onChange({ departureLocations: all })}
              errorKeys={displayErrorKeys}
            />
          </>
        )}

        {showRentBlock && (
          <div
            className="rounded-xl px-4 py-3.5 flex flex-col gap-3"
            style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
          >
            <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
              เช่ายานพาหนะ
            </p>
            <div data-field="rentVehicle">
              <label className={labelClass} style={errLabelStyle(hasErr("rentVehicle"))}>
                เลือกยานพาหนะที่ต้องการเช่า{requiredStar}
              </label>
              <OptionCardSelect
                options={rentVehicleOptions}
                value={tab.rentVehicleId != null ? String(tab.rentVehicleId) : ""}
                onChange={(v) => {
                  const id = Number(v);
                  const rv = rentVehicles.find((x) => x.id === id);
                  onChange({ rentVehicleId: id, rentVehicleCustomText: null, needsRentBooking: !!rv?.needsRentBooking });
                }}
                hasError={hasErr("rentVehicle")}
              />
            </div>

            {selectedRentVehicle?.needsRentBooking && (
              <div
                className="flex items-center gap-2 text-[12px] font-medium rounded-lg px-3 py-2"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                <Car size={14} /> ทีม Admin จะจัดการเช่ายานพาหนะให้
              </div>
            )}

            {showRentDates && (
              <div data-field="rentDateRange">
                <DateRangeField
                  label="วันที่เช่ายานพาหนะ (ต้องอยู่ในช่วงวันเดินทาง)"
                  startLabel="เริ่มเช่า"
                  endLabel="คืนรถ"
                  departDate={tab.rentStartDate}
                  returnDate={tab.rentEndDate}
                  onChange={({ departDate, returnDate }) => onChange({ rentStartDate: departDate, rentEndDate: returnDate })}
                  hasError={hasErr("rentDateRange")}
                  minDate={tab.departDate}
                  maxDate={tab.returnDate}
                  disabled={!tab.departDate || !tab.returnDate}
                  disabledHint="กรุณาเลือกวันเดินทางก่อน"
                />
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* เอกสารแนบ */}
      <SectionCard icon={<FileCheck size={15} />} title="เอกสารแนบ">
        <div data-field="idCard">
          <IdCardUpload
            files={tab.idCardFiles}
            requestId={tab.id ?? null}
            requesterStaffId={requesterStaffId}
            pendingFile={tab.pendingIdCard}
            onSelectPending={onSelectPendingIdCard}
            onRemove={onRemoveIdCardFile}
            hasError={hasErr("idCard")}
          />
        </div>
      </SectionCard>

      {/* หมายเหตุ + สรุป Per diem */}
      <SectionCard icon={<StickyNote size={15} />} title="หมายเหตุและสรุป">
        <div>
          <label className={labelClass} style={labelStyle}>
            หมายเหตุ
          </label>
          <textarea
            rows={2}
            value={tab.notes ?? ""}
            onChange={(e) => onChange({ notes: e.target.value || null })}
            placeholder="ระบุหมายเหตุเพิ่มเติม (ถ้ามี)..."
            className={inputClass}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>

        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "var(--nav-active-bg)" }}
        >
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
            สรุป Per diem (ประมาณการ)
          </span>
          <span className="text-[14px] font-bold" style={{ color: "var(--nav-active-text)" }}>
            {perDiemEstimate.groups.length > 0 ? (
              <>
                {perDiemEstimate.groups.map((g, i) => (
                  <span key={i}>
                    {i > 0 ? " + " : ""}
                    {g.days} วัน × ฿{fmtBaht(g.rate)}
                  </span>
                ))}
                {" = "}฿{fmtBaht(perDiemEstimate.total)}
              </>
            ) : (
              <>{perDiemEstimate.days} วัน = ฿{fmtBaht(perDiemEstimate.total)}</>
            )}
          </span>
        </div>
        <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
          * ยอดจริงคำนวณจากอัตราเบี้ยเลี้ยงย้อนหลังตามวันที่ในระบบ HR เมื่อกด &quot;ส่งคำขอ&quot;
        </p>
      </SectionCard>
    </div>
  );
}
