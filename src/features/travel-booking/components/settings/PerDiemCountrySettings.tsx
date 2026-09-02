"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { History, Info, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { countryNames } from "@/lib/acc/country-currency";
import { claimCountryOptions } from "@/features/accounting/lib/claim-currency";
import type { AccBrandOption } from "@/features/accounting/types";
import { PER_DIEM_HOME_COUNTRY } from "@/lib/acc/travel-booking/perdiem-country";
import {
  perDiemCountryRows,
  type PerDiemCountryRow,
  type PerDiemRateLike,
} from "@/features/travel-booking/lib/perdiem-rows";

/**
 * AP-17's per-diem rate per country.
 *
 * **A row per country, saved one at a time.** There is no "เพิ่มเรท" button and
 * no dialog: the countries this form can travel to are already known — they are
 * derived from the brands' own currencies — so listing them and letting an admin
 * type into the one they want is fewer steps than choosing from a picker that
 * only ever held the same list. `perdiem-rows.ts` owns which countries appear.
 *
 * **History survives, because the save key is `(country, date)`.**
 * `upsertPerDiemCountryRate` MERGEs on that pair, so saving a row with the date
 * it was loaded with EDITS that rate, and saving it with a different date ADDS
 * one. That is also how a second dated rate is created now the dialog is gone —
 * change the date, save — and it is the safe direction to be wrong in: a
 * mistyped date leaves an extra rate to deactivate rather than overwriting the
 * one a trip was already priced at.
 *
 * Ships empty and inert: with no rates, every trip is priced by the employee's
 * own HR allowance exactly as it was before this existed. Thailand never
 * appears, here or in `perdiem-rows` — that HR allowance is the answer there and
 * `upsertPerDiemCountryRate` refuses a TH row server-side.
 */

const ENDPOINT = "/api/request/travel-booking/settings/per-diem";
const BRANDS_ENDPOINT = "/api/request/travel-booking/options/brands";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

const fmtBaht = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What the inputs on one row hold, before it is saved. */
interface Draft {
  amount: string;
  effectiveDate: string;
  note: string;
}

/**
 * Every country ANY AP-17 brand can travel to, minus home.
 *
 * The union of the brands' own `claimCountryOptions` — the rate is stored per
 * country and not per brand (`AccTravelPerDiemCountry` is unique on
 * `(CountryCode, EffectiveDate)`), so the brands only decide which countries are
 * worth offering. Anything wider would list a country no trip can be filed
 * against, where a rate could never price anything.
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
  return out;
}

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
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
}

const inputStyle = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-card)",
  color: "var(--text-primary)",
} as const;

export function PerDiemCountrySettings() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: PerDiemRateLike[] }>(
    ENDPOINT,
    fetcher,
  );
  /* Fetched unconditionally now, not only while a dialog is open: the country
     list IS the page. */
  const { data: brandData } = useSWR<{ ok: boolean; data?: AccBrandOption[] }>(
    BRANDS_ENDPOINT,
    fetcher,
  );

  const rates = useMemo(() => data?.data ?? [], [data]);
  const brands = useMemo(() => brandData?.data ?? [], [brandData]);
  const rows = useMemo(
    () => perDiemCountryRows(reachableCountries(brands), rates),
    [brands, rates],
  );
  /* Distinguishes "still fetching" from "fetched, and there are none" — an empty
     list means something specific here and must not be claimed while either
     request is still in flight. */
  const loading = isLoading || brandData === undefined;

  /** Per-country edits, keyed on the country code. Absent = untouched. */
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [openHistory, setOpenHistory] = useState<Record<string, true>>({});

  /* The row's live values: what has been typed, else what is stored. Derived on
     read rather than seeded into `drafts` from the fetch, so a refetch cannot
     quietly discard something half-typed. */
  const valueOf = (row: PerDiemCountryRow): Draft => {
    const d = drafts[row.countryCode];
    if (d) return d;
    return {
      amount: row.latest ? String(row.latest.amount) : "",
      effectiveDate: row.latest?.effectiveDate ?? "",
      note: row.latest?.note ?? "",
    };
  };

  const setField = (row: PerDiemCountryRow, patch: Partial<Draft>) => {
    setDrafts((prev) => ({ ...prev, [row.countryCode]: { ...valueOf(row), ...patch } }));
  };

  const save = async (row: PerDiemCountryRow) => {
    const v = valueOf(row);
    const amount = Number(v.amount);
    if (!v.effectiveDate) {
      toast.error("กรุณาเลือกวันที่เริ่มมีผล");
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("จำนวนเงินต่อวันต้องมากกว่า 0");
      return;
    }
    setSavingCode(row.countryCode);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countryCode: row.countryCode,
          effectiveDate: v.effectiveDate,
          amount,
          note: v.note.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกแล้ว");
      /* Drop the draft so the row falls back to what was just stored — keeping
         it would leave the inputs showing a value the server may have trimmed. */
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[row.countryCode];
        return next;
      });
      await mutate();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSavingCode(null);
    }
  };

  const toggle = async (rate: PerDiemRateLike) => {
    setBusyId(rate.id);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rate.id, isActive: !rate.isActive }),
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
      {/* Facts a person setting a rate has to know before they set one, none of
          them discoverable from the rows: what happens to a country left blank,
          that the figure is baht, and — since the Add button went — that the
          date is what decides between editing a rate and adding one. */}
      <div
        className="flex items-start gap-2.5 rounded-xl px-3.5 py-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}
      >
        <Info size={15} className="shrink-0 mt-0.5" style={{ color: "var(--nav-active-text)" }} />
        <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-secondary)" }}>
          ประเทศที่เว้นว่างไว้ จะใช้<strong>เบี้ยเลี้ยงตามข้อมูล HR ของพนักงานแต่ละคน</strong> เหมือนเดิม ·
          ประเทศไทยกำหนดที่นี่ไม่ได้ เพราะใช้ข้อมูล HR เสมอ · จำนวนเงินเป็น<strong>บาทต่อวัน</strong> ·
          เรทมีผลตั้งแต่วันที่ระบุ ทริปที่คร่อมวันเปลี่ยนเรทจะคิดทั้งสองเรทตามวัน ·
          บันทึกด้วย<strong>วันที่เดิม</strong>คือการแก้เรทนั้น ส่วน<strong>วันที่ใหม่</strong>คือการเพิ่มเรทใหม่
        </p>
      </div>

      {loading ? (
        <div
          className="flex items-center gap-2 text-[13px] py-8 justify-center"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 size={15} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : rows.length === 0 ? (
        /* Not "no rates" — no countries. Every brand is baht-only, so there is
           nowhere a foreign rate could apply, and the remedy is on another tab. */
        <p className="text-[13px] text-center py-8 m-0" style={{ color: "var(--text-faint)" }}>
          ยังไม่มีแบรนด์ไหนผูกสกุลเงินต่างประเทศไว้ จึงเดินทางได้เฉพาะในไทย — เพิ่มได้ที่แท็บ “แบรนด์ที่เบิก”
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const names = countryNames(row.countryCode);
            const v = valueOf(row);
            const busy = savingCode === row.countryCode;
            const older = row.history.filter((h) => h.id !== row.latest?.id);
            const historyOpen = !!openHistory[row.countryCode];
            return (
              <div
                key={row.countryCode}
                className="rounded-xl px-3.5 py-3 flex flex-col gap-2.5"
                style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Flag code={row.countryCode} />
                  <span
                    className="text-[13px] font-semibold truncate"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {names ? names.en : row.countryCode}
                    <span className="text-[11px] font-medium ml-1.5" style={{ color: "var(--text-muted)" }}>
                      {names?.th}
                    </span>
                  </span>
                  {/* A country listed only because a rate exists for it. Said out
                      loud: the row is otherwise identical, and an admin would
                      reasonably read it as somewhere trips still go. */}
                  {!row.reachable && (
                    <span
                      className="text-[10.5px] font-semibold rounded-md px-1.5 py-0.5 shrink-0"
                      style={{ background: "var(--status-draft-bg)", color: "var(--status-draft-text)" }}
                    >
                      ไม่มีแบรนด์ใดเดินทางไปแล้ว
                    </span>
                  )}
                  {row.latest && (
                    <span
                      className="text-[11px] font-bold tabular-nums ml-auto shrink-0"
                      style={{ color: "var(--color-action)" }}
                    >
                      ใช้อยู่ {fmtBaht(row.latest.amount)}
                      <span className="text-[10px] font-semibold ml-1" style={{ color: "var(--text-muted)" }}>
                        บาท/วัน
                      </span>
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-[130px_150px_1fr_auto] gap-2 items-end">
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                      บาท/วัน
                    </span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={v.amount}
                      onChange={(e) => setField(row, { amount: e.target.value })}
                      disabled={busy}
                      className="rounded-lg px-3 py-2 text-[13px] outline-none tabular-nums text-right disabled:opacity-60"
                      style={inputStyle}
                      placeholder="0.00"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                      มีผลตั้งแต่
                    </span>
                    <input
                      type="date"
                      value={v.effectiveDate}
                      onChange={(e) => setField(row, { effectiveDate: e.target.value })}
                      disabled={busy}
                      className="rounded-lg px-3 py-2 text-[13px] outline-none disabled:opacity-60"
                      style={inputStyle}
                    />
                  </label>
                  <label className="flex flex-col gap-1 col-span-2 sm:col-span-1">
                    <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                      หมายเหตุ
                    </span>
                    <input
                      type="text"
                      value={v.note}
                      onChange={(e) => setField(row, { note: e.target.value })}
                      disabled={busy}
                      maxLength={300}
                      className="rounded-lg px-3 py-2 text-[13px] outline-none disabled:opacity-60"
                      style={inputStyle}
                      placeholder="ไม่บังคับ"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => save(row)}
                    disabled={busy}
                    className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 text-[12.5px] font-semibold rounded-lg px-3.5 py-2 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                    style={{ background: "var(--color-action)", color: "#fff" }}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    บันทึก
                  </button>
                </div>

                {older.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenHistory((prev) => {
                          const next = { ...prev };
                          if (next[row.countryCode]) delete next[row.countryCode];
                          else next[row.countryCode] = true;
                          return next;
                        })
                      }
                      className="flex items-center gap-1.5 text-[11.5px] font-semibold cursor-pointer self-start"
                      style={{ color: "var(--text-muted)" }}
                    >
                      <History size={12} />
                      {historyOpen ? "ซ่อนเรทก่อนหน้า" : "เรทก่อนหน้า " + older.length + " รายการ"}
                    </button>
                    {historyOpen &&
                      older.map((h) => (
                        <div
                          key={h.id}
                          className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12px]"
                          style={{
                            background: "var(--bg-card)",
                            border: "1px solid var(--border-light)",
                            opacity: h.isActive ? 1 : 0.55,
                          }}
                        >
                          <span className="tabular-nums shrink-0" style={{ color: "var(--text-muted)" }}>
                            {h.effectiveDate}
                          </span>
                          <span className="tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                            {fmtBaht(h.amount)}
                          </span>
                          <span className="truncate min-w-0" style={{ color: "var(--text-muted)" }}>
                            {h.note}
                          </span>
                          <button
                            type="button"
                            onClick={() => toggle(h)}
                            disabled={busyId === h.id}
                            className="text-[11px] font-semibold rounded-lg px-2.5 py-1 cursor-pointer shrink-0 ml-auto"
                            style={{
                              background: h.isActive ? "var(--status-ok-bg)" : "var(--bg-card-alt)",
                              color: h.isActive ? "var(--status-ok-text)" : "var(--text-faint)",
                              border: "1px solid var(--border-card)",
                            }}
                          >
                            {busyId === h.id ? "..." : h.isActive ? "ใช้งาน" : "ปิดใช้งาน"}
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
