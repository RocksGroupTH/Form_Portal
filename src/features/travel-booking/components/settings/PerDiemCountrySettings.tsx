"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Check, Info, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { countryNames } from "@/lib/acc/country-currency";
import { claimCountryOptions } from "@/features/accounting/lib/claim-currency";
import type { AccBrandOption } from "@/features/accounting/types";
import { PER_DIEM_HOME_COUNTRY } from "@/lib/acc/travel-booking/perdiem-country";

/**
 * AP-17's per-diem rate per country.
 *
 * Ships empty and inert: with no rows, every trip is priced by the employee's
 * own HR allowance exactly as it was before this existed. Thailand is absent
 * from the picker because it is where that HR allowance applies — a TH row would
 * be a second answer to a question that already has one.
 */

const ENDPOINT = "/api/request/travel-booking/settings/per-diem";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface RateRow {
  id: number;
  countryCode: string;
  effectiveDate: string;
  amount: number;
  note: string | null;
  isActive: boolean;
}

type Draft = { countryCode: string; effectiveDate: string; amount: string; note: string };

/**
 * Every country ANY AP-17 brand can travel to, minus home.
 *
 * The rate is stored per country and not per brand — `AccTravelPerDiemCountry`
 * is unique on `(CountryCode, EffectiveDate)` — so the picker asks for a country
 * and nothing else. It is still not all 25: the union of the brands' own
 * `claimCountryOptions` is what a trip can actually be filed against, and
 * offering more would let somebody configure a rate that could never price
 * anything.
 *
 * Thailand is always excluded: the employee's HR allowance answers there, and a
 * TH row would be a second answer to a question that already has one.
 * `upsertPerDiemCountryRate` refuses it server-side regardless.
 */
function reachableCountries(brands: readonly AccBrandOption[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const b of brands) {
    for (const c of claimCountryOptions(b)) {
      if (c === PER_DIEM_HOME_COUNTRY || seen[c]) continue;
      seen[c] = true;
      out.push(c);
    }
  }
  out.sort();
  return out;
}

const emptyDraft = (): Draft => ({
  countryCode: "",
  effectiveDate: "",
  amount: "",
  note: "",
});

const fmtBaht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Flag({ code }: { code: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={"/flags/" + code.toLowerCase() + ".svg"}
      alt=""
      aria-hidden
      className="shrink-0 h-[11px] w-[16px] rounded-[2px] object-cover"
      style={{ border: "1px solid var(--border-card)" }}
      onError={(e) => {
        (e.target as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

export function PerDiemCountrySettings() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: RateRow[] }>(ENDPOINT, fetcher);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const rows = useMemo(() => data?.data ?? [], [data]);

  // The brands AP-17 can be claimed against, with their configured currencies —
  // the same list the form's brand chips come from.
  const { data: brandData } = useSWR<{ ok: boolean; data?: AccBrandOption[] }>(
    draft ? "/api/request/travel-booking/options/brands" : null,
    fetcher,
  );
  const brands = useMemo(() => brandData?.data ?? [], [brandData]);
  const countries = useMemo(() => reachableCountries(brands), [brands]);
  // Distinguishes "still fetching" from "fetched, and there are none" — an
  // empty list means something specific here and must not be claimed while the
  // request is still in flight.
  const brandsLoaded = brandData !== undefined;

  const save = async () => {
    if (!draft) return;
    const amount = Number(draft.amount);
    if (!draft.countryCode) {
      toast.error("กรุณาเลือกประเทศ");
      return;
    }
    if (!draft.effectiveDate) {
      toast.error("กรุณาเลือกวันที่เริ่มมีผล");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("จำนวนเงินต่อวันต้องมากกว่า 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryCode: draft.countryCode,
          effectiveDate: draft.effectiveDate,
          amount,
          note: draft.note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกแล้ว");
      setDraft(null);
      await mutate();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: RateRow) => {
    setBusyId(row.id);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, isActive: !row.isActive }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "เปลี่ยนสถานะไม่สำเร็จ");
        return;
      }
      await mutate();
    } catch {
      toast.error("เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Two facts a person setting a rate has to know before they set one, and
          neither is discoverable from the grid: what happens to a country with
          no row, and that the figure is baht. */}
      <div
        className="flex items-start gap-2.5 rounded-xl px-3.5 py-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}
      >
        <Info size={15} className="shrink-0 mt-0.5" style={{ color: "var(--nav-active-text)" }} />
        <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-secondary)" }}>
          ประเทศที่ไม่ได้กำหนดเรทที่นี่ จะใช้<strong>เบี้ยเลี้ยงตามข้อมูล HR ของพนักงานแต่ละคน</strong> เหมือนเดิม ·
          ประเทศไทยกำหนดที่นี่ไม่ได้ เพราะใช้ข้อมูล HR เสมอ · จำนวนเงินเป็น<strong>บาทต่อวัน</strong> ·
          เรทมีผลตั้งแต่วันที่ระบุ ทริปที่คร่อมวันเปลี่ยนเรทจะคิดทั้งสองเรทตามวัน
        </p>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setDraft(emptyDraft())}
          className="flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-3.5 py-2.5 cursor-pointer"
          style={{ background: "var(--color-action)", color: "#fff" }}
        >
          <Plus size={15} /> เพิ่มเรท
        </button>
      </div>

      {isLoading ? (
        <div
          className="flex items-center gap-2 text-[13px] py-8 justify-center"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 size={15} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-center py-8 m-0" style={{ color: "var(--text-faint)" }}>
          ยังไม่ได้กำหนดเรทประเทศใดเลย — ทุกทริปใช้เบี้ยเลี้ยงตามข้อมูล HR
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => {
            const names = countryNames(row.countryCode);
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  opacity: row.isActive ? 1 : 0.55,
                }}
              >
                <Flag code={row.countryCode} />
                <div className="min-w-0 flex-1">
                  <span
                    className="text-[13px] font-semibold block truncate"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {names ? names.en : row.countryCode}
                    <span
                      className="text-[11px] font-medium ml-1.5"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {names?.th}
                    </span>
                  </span>
                  <span className="text-[11px] block truncate" style={{ color: "var(--text-muted)" }}>
                    มีผล {row.effectiveDate}
                    {row.note ? " · " + row.note : ""}
                  </span>
                </div>
                <span
                  className="text-[13px] font-bold tabular-nums shrink-0"
                  style={{ color: "var(--color-action)" }}
                >
                  {fmtBaht(row.amount)}
                  <span className="text-[10px] font-semibold ml-1" style={{ color: "var(--text-muted)" }}>
                    บาท/วัน
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={busyId === row.id}
                  className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 cursor-pointer shrink-0"
                  style={{
                    background: row.isActive ? "var(--status-ok-bg)" : "var(--bg-card)",
                    color: row.isActive ? "var(--status-ok-text)" : "var(--text-faint)",
                    border: "1px solid var(--border-card)",
                  }}
                >
                  {busyId === row.id ? "..." : row.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.35)" }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-3.5"
            style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
                เพิ่ม / แก้เรทเบี้ยเลี้ยง
              </h3>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="ปิด"
                className="p-1 rounded-lg cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={16} />
              </button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                ประเทศ <span style={{ color: "var(--text-danger)" }}>*</span>
              </span>
              <select
                value={draft.countryCode}
                disabled={!brandsLoaded || countries.length === 0}
                onChange={(e) => setDraft({ ...draft, countryCode: e.target.value })}
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              >
                <option value="">— เลือกประเทศ —</option>
                {countries.map((code) => {
                  const n = countryNames(code);
                  return (
                    <option key={code} value={code}>
                      {n ? `${n.en} · ${n.th}` : code}
                    </option>
                  );
                })}
              </select>
              {/* An empty list is the configuration speaking, not a fault, and it
                  names the remedy — otherwise it reads as a broken dropdown. */}
              {brandsLoaded && countries.length === 0 && (
                <span className="text-[11px]" style={{ color: "var(--text-warning)" }}>
                  ยังไม่มีแบรนด์ไหนผูกสกุลเงินต่างประเทศไว้ จึงเดินทางได้เฉพาะในไทย —
                  เพิ่มได้ที่แท็บ “แบรนด์ที่เบิก”
                </span>
              )}
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                มีผลตั้งแต่วันที่ <span style={{ color: "var(--text-danger)" }}>*</span>
              </span>
              <input
                type="date"
                value={draft.effectiveDate}
                onChange={(e) => setDraft({ ...draft, effectiveDate: e.target.value })}
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              />
              <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                เรทเดิมของประเทศนี้ยังอยู่ ทริปก่อนวันนี้จะคิดตามเรทเดิม
              </span>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                จำนวนเงิน (บาท/วัน) <span style={{ color: "var(--text-danger)" }}>*</span>
              </span>
              <input
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
                placeholder="เช่น 1500"
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none tabular-nums"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                หมายเหตุ
              </span>
              <input
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                placeholder="เช่น ตามประกาศบริษัทเลขที่ ..."
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              />
            </label>

            <div className="flex items-center gap-2 justify-end mt-1">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-[13px] font-semibold rounded-xl px-4 py-2.5 cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-card)",
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-4 py-2.5 cursor-pointer"
                style={{
                  background: "var(--color-action)",
                  color: "#fff",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
