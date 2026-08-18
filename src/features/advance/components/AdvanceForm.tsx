"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, User, Mail, UserCog } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { RequesterPickerModal, type RequesterOption } from "@/components/RequesterPickerModal";
import { TravelExpenseLoadingPopup } from "@/features/accounting/components/TravelExpenseLoadingPopup";
import type { AccBrandOption } from "@/features/accounting/types";
import type { AdvancePayeeType, AdvanceRequest, AdvanceSaveInput } from "@/features/advance/types";
import { AP2_DEFAULT_CURRENCY } from "@/features/advance/constants";
import type { BankOption } from "@/lib/adv/bank-master-service";

interface Props {
  initial: AdvanceRequest | null;
  onSaved: (id: number) => void;
  onSubmitted: (id: number) => void;
}

const labelStyle = { color: "var(--text-secondary)" } as const;
const fieldClass = "w-full text-[13px] px-3 py-2 rounded-xl outline-none";
const fieldStyle = {
  background: "var(--bg-input, var(--bg-card))",
  color: "var(--text-primary)",
  border: "1px solid var(--border-card)",
} as const;

export function AdvanceForm({ initial, onSaved, onSubmitted }: Props) {
  const [brands, setBrands] = useState<AccBrandOption[]>([]);
  const [banks, setBanks] = useState<BankOption[]>([]);
  // Requester = the logged-in user (auto from HR), same as AP-1's ผู้ขอเบิก part.
  const [emp, setEmp] = useState<{
    staffId: number | null; fullName: string | null; position: string | null;
    departmentName: string | null; email: string | null; photoUrl: string | null;
  } | null>(null);
  // On-behalf: same-department colleagues + the selected requester (null = self).
  const [colleagues, setColleagues] = useState<RequesterOption[]>([]);
  const [requesterStaffId, setRequesterStaffId] = useState<number | null>(null);
  const [requesterPickerOpen, setRequesterPickerOpen] = useState(false);

  const [brandCode, setBrandCode] = useState(initial?.brandCode ?? "");
  const [payeeType, setPayeeType] = useState<AdvancePayeeType>(initial?.advance?.payeeType ?? "employee");
  const [payeeName, setPayeeName] = useState(initial?.advance?.payeeName ?? "");
  const [payeeBankAccount, setPayeeBankAccount] = useState(initial?.advance?.payeeBankAccount ?? "");
  const [payeeBankCode, setPayeeBankCode] = useState(initial?.advance?.payeeBankCode ?? "");
  const [needByDate, setNeedByDate] = useState(initial?.advance?.needByDate ?? "");
  const [expectedClearDate, setExpectedClearDate] = useState(initial?.advance?.expectedClearDate ?? "");
  const [purpose, setPurpose] = useState(initial?.advance?.purpose ?? "");
  const initialCurrency = initial?.advance?.currency ?? AP2_DEFAULT_CURRENCY;
  const [foreign, setForeign] = useState(initialCurrency.toUpperCase() !== AP2_DEFAULT_CURRENCY);
  const [currencyCode, setCurrencyCode] = useState(
    initialCurrency.toUpperCase() === AP2_DEFAULT_CURRENCY ? "" : initialCurrency,
  );
  const [amount, setAmount] = useState(initial?.advance?.amount != null ? String(initial.advance.amount) : "");
  const [exchangeRate, setExchangeRate] = useState(
    initial?.advance?.exchangeRate != null ? String(initial.advance.exchangeRate) : "",
  );
  const [fxLoading, setFxLoading] = useState(false);
  const [fxAsOf, setFxAsOf] = useState<string | null>(null);
  const [whtNote, setWhtNote] = useState(initial?.advance?.whtNote ?? "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);

  const requestId = initial?.id ?? null;
  const readOnly = !!initial && initial.status !== "Draft" && initial.status !== "Returned";

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/request/advance/options/brands").then((r) => r.json()),
      fetch("/api/request/advance/options/banks").then((r) => r.json()),
      fetch("/api/me/employee").then((r) => r.json()),
      fetch("/api/request/advance/requesters").then((r) => r.json()),
    ])
      .then(([b, bk, m, rq]) => {
        if (cancelled) return;
        if (b.ok) setBrands(b.data);
        if (bk.ok) setBanks(bk.data);
        // AP-1 logic: requester is the logged-in user, resolved from HR.
        const e = m?.data?.employee;
        if (e) setEmp({
          staffId: e.staffId ?? null, fullName: e.fullName ?? null,
          position: e.position ?? null, departmentName: e.departmentName ?? null,
          email: m?.data?.email ?? e.email ?? null, photoUrl: e.photoUrl ?? null,
        });
        if (rq?.ok) {
          setColleagues(rq.data?.colleagues ?? []);
          // Resume an on-behalf draft: seed the selected requester when the saved
          // staffId differs from the logged-in user.
          const selfId = e?.staffId ?? null;
          if (initial?.staffId != null && selfId != null && initial.staffId !== selfId) {
            setRequesterStaffId(initial.staffId);
          }
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, [initial]);

  async function fetchFxRate(code: string) {
    const cur = code.trim().toUpperCase();
    if (!cur || cur === AP2_DEFAULT_CURRENCY) return;
    setFxLoading(true);
    try {
      const res = await fetch(`/api/request/advance/fx-rate?currency=${encodeURIComponent(cur)}`);
      const json = (await res.json()) as { ok: boolean; data?: { rate: number; asOf: string; source?: string }; error?: string };
      if (json.ok && json.data) {
        const src = json.data.source === "BOT" ? "ธปท." : "ECB";
        setExchangeRate(String(json.data.rate));
        setFxAsOf(`${json.data.asOf} (${src})`);
        toast.success(`อัตรา ${src} ${cur} = ${json.data.rate} (ณ ${json.data.asOf})`);
      } else {
        toast.error(json.error ?? "ดึงอัตราแลกเปลี่ยนไม่สำเร็จ");
      }
    } catch {
      toast.error("ดึงอัตราแลกเปลี่ยนไม่สำเร็จ");
    } finally {
      setFxLoading(false);
    }
  }

  // Employee payee name mirrors the requester; vendor is typed in.
  // Requester display: a resumed request keeps its stamped requester; a new form
  // shows the logged-in user.
  // On-behalf: a selected colleague overrides the display; else self (or a
  // resumed draft's stamped requester).
  const selectedColleague = requesterStaffId
    ? (colleagues.find((c) => c.staffId === requesterStaffId) ?? null)
    : null;
  const reqStaffId = requesterStaffId ?? initial?.staffId ?? emp?.staffId ?? null;
  const reqName = selectedColleague?.fullName ?? initial?.requesterFullName ?? emp?.fullName ?? "";
  const reqPos = selectedColleague?.position ?? initial?.requesterPosition ?? emp?.position ?? "";
  const reqDept = selectedColleague?.departmentName ?? initial?.requesterDepartmentName ?? emp?.departmentName ?? "";
  const reqEmail = selectedColleague?.email ?? initial?.requesterEmail ?? emp?.email ?? null;
  const reqPhoto = selectedColleague?.photoUrl ?? emp?.photoUrl ?? null;

  const effectivePayeeName = payeeType === "employee" ? reqName : payeeName;

  const baseAmount = useMemo(() => {
    const amt = amount ? Number(amount) : 0;
    const rate = foreign ? (exchangeRate ? Number(exchangeRate) : 0) : 1;
    return Math.round(amt * rate * 100) / 100;
  }, [amount, exchangeRate, foreign]);

  function buildInput(): AdvanceSaveInput {
    return {
      id: requestId ?? undefined,
      brandCode: brandCode || null,
      staffId: requesterStaffId ?? null,
      advance: {
        payeeType,
        payeeName: effectivePayeeName || null,
        payeeBankAccount: payeeType === "vendor" ? payeeBankAccount || null : null,
        payeeBankCode: payeeType === "vendor" ? payeeBankCode || null : null,
        needByDate: needByDate || null,
        expectedClearDate: expectedClearDate || null,
        purpose: purpose || null,
        currency: foreign ? (currencyCode || "USD").toUpperCase() : AP2_DEFAULT_CURRENCY,
        amount: amount ? Number(amount) : null,
        exchangeRate: foreign ? (exchangeRate ? Number(exchangeRate) : null) : 1,
        baseAmount,
        whtNote: whtNote || null,
      },
    };
  }

  async function persist(): Promise<number> {
    const url = requestId
      ? `/api/request/advance/requests/${requestId}`
      : "/api/request/advance/requests";
    const res = await fetch(url, {
      method: requestId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildInput()),
    });
    const json = (await res.json()) as { ok: boolean; data?: { id: number }; error?: string };
    if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
    return json.data?.id ?? requestId!;
  }

  async function handleSave() {
    setSaving(true);
    try {
      const id = await persist();
      toast.success("บันทึกแบบร่างแล้ว");
      onSaved(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const id = await persist();
      const res = await fetch(`/api/request/advance/requests/${id}/submit`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "ส่งคำขอไม่สำเร็จ");
      toast.success("ส่งคำขอแล้ว");
      onSubmitted(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ส่งคำขอไม่สำเร็จ");
    } finally {
      setSubmitting(false);
    }
  }

  const box = { background: "var(--bg-card)", boxShadow: "var(--shadow-card)" } as const;

  if (!ready) {
    return (
      <TravelExpenseLoadingPopup
        label="กำลังเตรียมแบบฟอร์ม..."
        subtitle="แบบฟอร์มขอเบิกเงินทดรองจ่าย (AP-2)"
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Requester (รหัสพนักงาน กรอกเอง → auto ดึง HR) + brand chips like AP-1 */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
        {/* ผู้ขอเบิก — same card + on-behalf picker as AP-1 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
            <User size={15} /> ผู้ขอเบิก
          </div>
          {!readOnly && colleagues.length > 0 && (
            <button type="button" onClick={() => setRequesterPickerOpen(true)}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--nav-active-text)" }}>
              <UserCog size={13} /> เปลี่ยนผู้ขอเบิก
            </button>
          )}
        </div>
        <RequesterPickerModal
          open={requesterPickerOpen}
          onClose={() => setRequesterPickerOpen(false)}
          colleagues={colleagues}
          self={emp ? {
            staffId: emp.staffId ?? 0, fullName: emp.fullName, position: emp.position,
            departmentName: emp.departmentName, email: emp.email, photoUrl: emp.photoUrl,
          } : null}
          value={requesterStaffId}
          onSelect={setRequesterStaffId}
        />
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 rounded-full overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
            <Avatar name={reqName || "?"} size={48} photo={reqPhoto ?? undefined} color="var(--nav-active-text)" />
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2 min-w-0">
              <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{reqName || "-"}</span>
              {reqStaffId != null && (
                <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>#{reqStaffId}</span>
              )}
            </div>
            {(reqDept || reqPos) && (
              <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                {[reqDept, reqPos].filter(Boolean).join(" · ")}
              </span>
            )}
            {reqEmail && (
              <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                <Mail size={11} className="shrink-0" /> <span className="truncate">{reqEmail}</span>
              </span>
            )}
          </div>
        </div>
        {requesterStaffId != null && (
          <span className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
            กำลังกรอกแทน {reqName || `#${requesterStaffId}`} — คำขอจะอยู่ใน "คำขอของฉัน" ของคุณ และผู้อนุมัติจะเป็นหัวหน้าของผู้ขอเบิก
          </span>
        )}

        <div>
          <label className="text-[12px] font-bold" style={labelStyle}>แบรนด์ที่เบิก *</label>
          {brands.length === 0 ? (
            <p className="text-[13px] mt-1" style={{ color: "var(--text-faint)" }}>
              กำลังโหลดแบรนด์...
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 mt-1">
              {brands.map((b) => {
                const active = brandCode === b.brandCode;
                return (
                  <button key={b.brandCode} type="button" disabled={readOnly}
                    onClick={() => setBrandCode(active ? "" : b.brandCode)}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer text-[14px] font-semibold transition-all disabled:cursor-not-allowed"
                    style={{
                      borderWidth: 2, borderStyle: "solid",
                      borderColor: active ? "var(--nav-active-text)" : "var(--border-card)",
                      background: active ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
                      color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                    }}>
                    {b.brandLogo && (
                      <img src={b.brandLogo} alt="" className="h-5 w-auto object-contain"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    )}
                    {b.brandName}
                    {active && <Check size={14} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Payee (โอนให้) */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box}>
        <Field label="โอนให้ *">
          <select className={fieldClass} style={fieldStyle} value={payeeType} disabled={readOnly}
            onChange={(e) => setPayeeType(e.target.value as AdvancePayeeType)}>
            <option value="employee">พนักงาน (ผู้ขอเบิก)</option>
            <option value="vendor">คู่ค้า</option>
          </select>
        </Field>
        {payeeType === "vendor" && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="ชื่อคู่ค้า *">
              <input className={fieldClass} style={fieldStyle} value={payeeName} disabled={readOnly}
                onChange={(e) => setPayeeName(e.target.value)} />
            </Field>
            <Field label="เลขที่บัญชี *">
              <input className={fieldClass} style={fieldStyle} value={payeeBankAccount} disabled={readOnly}
                onChange={(e) => setPayeeBankAccount(e.target.value)} />
            </Field>
            <Field label="ธนาคาร *">
              <select className={fieldClass} style={fieldStyle} value={payeeBankCode} disabled={readOnly}
                onChange={(e) => setPayeeBankCode(e.target.value)}>
                <option value="">— เลือกธนาคาร —</option>
                {banks.map((bk) => <option key={bk.bankCode} value={bk.bankCode}>{bk.bankName}</option>)}
              </select>
            </Field>
          </div>
        )}
        {payeeType === "employee" && (
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            โอนเข้าบัญชีของผู้ขอเบิก ({effectivePayeeName || "—"}) ตามข้อมูล HR
          </p>
        )}
      </div>

      {/* Advance detail */}
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-4" style={box}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="วันที่ต้องการเริ่มใช้เงิน *">
            <input type="date" className={fieldClass} style={fieldStyle} value={needByDate}
              disabled={readOnly} onChange={(e) => setNeedByDate(e.target.value)} />
          </Field>
          <Field label="วันที่คาดว่าจะเคลียร์ * (≤ 30 วัน)">
            <input type="date" className={fieldClass} style={fieldStyle} value={expectedClearDate}
              disabled={readOnly} onChange={(e) => setExpectedClearDate(e.target.value)} />
          </Field>
        </div>

        {/* Currency + amount */}
        <div className="flex flex-col gap-2">
          <label className="text-[12px] font-bold flex items-center gap-3" style={labelStyle}>
            สกุลเงิน
            <span className="flex items-center gap-1 font-normal">
              <input type="checkbox" checked={foreign} disabled={readOnly}
                onChange={(e) => setForeign(e.target.checked)} />
              สกุลต่างประเทศ
            </span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            {foreign && (
              <Field label="สกุลเงิน *">
                <input className={fieldClass} style={fieldStyle} value={currencyCode} disabled={readOnly}
                  placeholder="USD" maxLength={3}
                  onChange={(e) => setCurrencyCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                  onBlur={(e) => fetchFxRate(e.target.value)} />
              </Field>
            )}
            <Field label={foreign ? "จำนวนเงิน (สกุลนั้น) *" : "จำนวนเงิน (บาท) *"}>
              <input type="number" min="0" step="0.01" className={fieldClass} style={fieldStyle} value={amount}
                disabled={readOnly} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </Field>
            {foreign && (
              <Field label="อัตราแลกเปลี่ยน *">
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" step="0.000001" className={fieldClass} style={fieldStyle}
                    value={exchangeRate} disabled={readOnly}
                    onChange={(e) => setExchangeRate(e.target.value)} placeholder="เช่น 36.50" />
                  <Button variant="secondary" size="sm" type="button" loading={fxLoading}
                    disabled={readOnly || !currencyCode.trim()}
                    onClick={() => fetchFxRate(currencyCode)}>ดึงอัตรา</Button>
                </div>
                {fxAsOf && (
                  <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    อัตรา ธปท. ณ {fxAsOf}
                  </span>
                )}
              </Field>
            )}
            <Field label="ยอดที่เบิก (บาท)">
              <input className={fieldClass} style={fieldStyle} disabled
                value={baseAmount ? baseAmount.toLocaleString(undefined, { minimumFractionDigits: 2 }) : ""} />
            </Field>
          </div>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            ยอดเกิน 3,000 บาท ควรผ่านกระบวนการ PR/PO · สกุลต่างประเทศใช้ rate ธปท. วันศุกร์ก่อนจ่าย
          </span>
        </div>

        <Field label="รายละเอียดค่าใช้จ่าย *">
          <textarea rows={3} className={fieldClass} style={fieldStyle} value={purpose} disabled={readOnly}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="ระบุรายการค่าใช้จ่ายและจำนวนเงินประมาณการของแต่ละรายการ เช่น ค่าจัดกิจกรรมพนักงาน" />
        </Field>

        <Field label="หมายเหตุ หัก ณ ที่จ่าย (ถ้ามี)">
          <textarea rows={2} className={fieldClass} style={fieldStyle} value={whtNote} disabled={readOnly}
            onChange={(e) => setWhtNote(e.target.value)}
            placeholder="กรณีจ่ายค่าบริการเกิน 1,000 บาท ติดต่อบัญชีเพื่อออกหนังสือรับรองหัก ณ ที่จ่าย" />
        </Field>

        {/* Attachment — quote/supporting doc. Upload wiring pending (files endpoint). */}
        <Field label="แนบไฟล์ประกอบ (ใบเสนอราคา ฯลฯ)">
          <input type="file" disabled className="text-[12px]" style={{ color: "var(--text-muted)" }} />
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>ระบบอัปโหลดไฟล์กำลังพัฒนา</span>
        </Field>
      </div>

      {!readOnly && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleSave} loading={saving} disabled={submitting}>บันทึกแบบร่าง</Button>
          <Button variant="primary" onClick={handleSubmit} loading={submitting} disabled={saving}>ส่งคำขอ</Button>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-bold" style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
