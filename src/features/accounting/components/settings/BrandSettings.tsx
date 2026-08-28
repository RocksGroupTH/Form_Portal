"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import { Info, Save } from "lucide-react";
import { toast } from "sonner";
import { SettingOption, SettingOptionGroup } from "@/components/settings/SettingOption";
import { CurrencyCombobox } from "@/features/advance/components/CurrencyCombobox";
import {
  COMMON_COUNTRY_CODES,
  FALLBACK_CURRENCIES,
  type BrandCurrencyPatch,
} from "@/lib/acc/brand-currency-input";
import { brandCurrencyState, isBaht } from "@/lib/acc/currency";
import type { AccBrandOption } from "@/features/accounting/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FormBrandRow {
  id: number;
  brandCode: string;
  isActive: boolean;
  sortOrder: number;
}

/** One row of what `currencyEndpoint`'s GET returns — every brand in the master. */
interface BrandCurrencyRow extends BrandCurrencyPatch {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
}

/**
 * Which brands a form accepts, and what country and currency each brand carries.
 *
 * Shared by AP-1 and AP-17. The endpoints are props rather than literals
 * because the two forms keep separate rows in `AccFormBrand` — granting a
 * brand to the travel-expense form must not thereby grant it to the booking
 * form — and a second copy of this panel would drift on the save semantics,
 * which are "replace the whole set", not "toggle one".
 *
 * `options/all-brands` stays AP-1's for both: it is the company brand master,
 * not an AP-1 list, and AP-17 has no endpoint of its own for it.
 *
 * **The two halves of this panel write two different tables, and only one of
 * them is per form.** The tick list writes `AccFormBrand`, which is keyed on
 * `(form, brand)`. The editor below it writes one row **per brand**, shared
 * with the other form — the user's choice, spec §2. So a change made from
 * AP-17's tab decides how an AP-1 claim converts, on a roster AP-1's admins do
 * not control. That was taken knowingly (spec §9.3) and cannot be expressed as
 * a constraint, so it is made *visible* instead: `otherFormLabel` is what lets
 * the notice name the form that is also affected, without this component
 * holding either form's name.
 */
export function BrandSettings({
  endpoint = "/api/request/accounting/settings/brands",
  description = "เลือกแบรนด์ที่พนักงานสามารถเลือกในฟอร์มเบิกค่าเดินทาง AP-1 — ติ๊กเพื่อเปิด/ปิด แล้วกดบันทึก",
  currencyEndpoint,
  otherFormLabel,
}: {
  endpoint?: string;
  description?: string;
  /** Where the country/currency editor reads and writes. */
  currencyEndpoint: string;
  /** The *other* form this value is shared with — `"AP-17"` from AP-1's page. */
  otherFormLabel: string;
}) {
  const { data, mutate } = useSWR<{ ok: boolean; data: FormBrandRow[] }>(
    endpoint,
    fetcher,
  );
  const { data: allData } = useSWR<{ ok: boolean; data: AccBrandOption[] }>(
    "/api/request/accounting/options/all-brands",
    fetcher,
  );
  const allBrands = allData?.data ?? [];

  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [savedChecked, setSavedChecked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data?.data) {
      const activeCodes = new Set(
        data.data.filter((b) => b.isActive).map((b) => b.brandCode),
      );
      setSavedChecked(activeCodes);
      if (!initialized) {
        setChecked(activeCodes);
        setInitialized(true);
      }
    }
  }, [data, initialized]);

  const toggle = (code: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCodes: Array.from(checked) }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("บันทึกสำเร็จ");
        setSavedChecked(new Set(checked));
        mutate();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <SettingOptionGroup
        title="แบรนด์ที่เบิกได้"
        description={description}
      >
        {allBrands.map((brand) => {
          const active = checked.has(brand.brandCode);
          const wasSaved = savedChecked.has(brand.brandCode);
          const isDirty = active !== wasSaved;
          const rowStatus = isDirty ? "pending" : active ? "saved" : "default";
          return (
            <SettingOption
              key={brand.brandCode}
              variant="checkbox"
              checked={active}
              rowStatus={rowStatus}
              onChange={() => toggle(brand.brandCode)}
              label={brand.brandName}
              description={`รหัส ${brand.brandCode} — ${
                isDirty
                  ? active
                    ? "เลือกแล้ว — รอบันทึก"
                    : "ยกเลิกแล้ว — รอบันทึก"
                  : active
                    ? "อนุญาตให้เบิก"
                    : "ไม่อนุญาตให้เบิก"
              }`}
              leading={
                brand.brandLogo ? (
                  <img
                    src={brand.brandLogo}
                    alt=""
                    className="h-6 w-auto object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : undefined
              }
            />
          );
        })}
      </SettingOptionGroup>

      {allBrands.length === 0 && (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่พบแบรนด์
        </p>
      )}

      <p className="text-[11px] my-4" style={{ color: "var(--text-muted)" }}>
        เลือก {checked.size} จาก {allBrands.length} แบรนด์
      </p>

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl cursor-pointer border-none text-[13px] font-bold"
        style={{
          background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)",
          opacity: saving ? 0.6 : 1,
        }}
      >
        <Save size={14} />
        {saving ? "กำลังบันทึก..." : "บันทึก"}
      </button>

      <div className="mt-8">
        <BrandCurrencySettings endpoint={currencyEndpoint} otherFormLabel={otherFormLabel} />
      </div>
    </div>
  );
}

/* ── the country / currency editor ───────────────────────────────────────── */

const CURRENCY_LIST_URL = "/api/request/advance/currencies";
const COUNTRY_LIST_ID = "brand-country-codes";

/** A row's values while they are being edited. */
type Draft = BrandCurrencyPatch;

const BLANK: Draft = { countryCode: null, currencyCode: null, currencyEnabled: false };

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.countryCode === b.countryCode &&
    a.currencyCode === b.currencyCode &&
    a.currencyEnabled === b.currencyEnabled
  );
}

/**
 * Country and currency, one brand per row.
 *
 * **Saved a brand at a time, not in one batch.** The value belongs to the brand
 * rather than to this form, so a Save that swept every row would have one
 * admin's edit to PCMY silently re-write what somebody else had just changed for
 * PCTH — including from the other form's tab, which reaches the same rows.
 */
function BrandCurrencySettings({
  endpoint,
  otherFormLabel,
}: {
  endpoint: string;
  otherFormLabel: string;
}) {
  const { data, mutate } = useSWR<{ ok: boolean; data: BrandCurrencyRow[]; error?: string }>(
    endpoint,
    fetcher,
  );
  const rows = useMemo(() => (data?.ok ? data.data : []), [data]);

  // The FX source's own list, so nothing can be chosen that no rate can be had
  // for: a foreign claim in such a currency fails closed at submit, and the
  // admin who picked it would have no way to see why. The static fallback keeps
  // the field usable while that provider is unreachable.
  const { data: curData } = useSWR<{ ok: boolean; data: { code: string; name: string }[] }>(
    CURRENCY_LIST_URL,
    fetcher,
  );
  const supported = curData?.ok && curData.data.length > 0 ? curData.data : null;
  const currencyOptions = supported ?? FALLBACK_CURRENCIES.slice();

  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingCode, setSavingCode] = useState<string | null>(null);

  const stored = useMemo(() => {
    const m: Record<string, Draft> = {};
    for (const r of rows) {
      m[r.brandCode] = {
        countryCode: r.countryCode,
        currencyCode: r.currencyCode,
        currencyEnabled: r.currencyEnabled,
      };
    }
    return m;
  }, [rows]);

  const patch = (code: string, next: Partial<Draft>) => {
    setDrafts((prev) => {
      const base = prev[code] ?? stored[code] ?? BLANK;
      const merged: Draft = {
        countryCode: next.countryCode !== undefined ? next.countryCode : base.countryCode,
        currencyCode: next.currencyCode !== undefined ? next.currencyCode : base.currencyCode,
        currencyEnabled:
          next.currencyEnabled !== undefined ? next.currencyEnabled : base.currencyEnabled,
      };
      // Clearing the currency cannot leave the switch on. The flag without a
      // code names nothing — `brandCurrencyState` reads that pair as "none" and
      // the server refuses it outright — so the UI must not be able to post it.
      if (merged.currencyCode === null) merged.currencyEnabled = false;
      const out: Record<string, Draft> = {};
      for (const k of Object.keys(prev)) out[k] = prev[k];
      out[code] = merged;
      return out;
    });
  };

  const save = async (code: string, draft: Draft) => {
    setSavingCode(code);
    try {
      const res = await fetch(endpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brandCode: code,
          countryCode: draft.countryCode,
          currencyCode: draft.currencyCode,
          currencyEnabled: draft.currencyEnabled,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`บันทึกแบรนด์ ${code} แล้ว`);
        // Drop the draft so the row falls back to what the server now holds —
        // clearing it before the refetch would flash the old value.
        setDrafts((prev) => {
          const out: Record<string, Draft> = {};
          for (const k of Object.keys(prev)) if (k !== code) out[k] = prev[k];
          return out;
        });
        mutate();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      }
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSavingCode(null);
    }
  };

  return (
    <SettingOptionGroup
      title="ประเทศและสกุลเงินของแบรนด์"
      description="กำหนดประเทศ (ISO-3166-1 เช่น TH, MY) และสกุลเงิน (ISO-4217 เช่น THB, MYR) ของแต่ละแบรนด์ — การเลือกสกุลเงินยังไม่เท่ากับเปิดใช้งาน ต้องเปิดสวิตช์อีกชั้นหนึ่ง"
    >
      {/*
        Required copy, not decoration. The permission to change these values is
        per form while the values themselves are one row per brand, shared with
        the other form. Spec §9.3 rules that the asymmetry must be visible on
        screen, because it cannot be removed.
      */}
      <div
        className="flex items-start gap-2 rounded-xl px-3.5 py-3"
        style={{
          background: "var(--bg-info-yellow)",
          border: "1px solid var(--border-info-yellow)",
        }}
      >
        <Info size={15} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-yellow)" }} />
        <p className="text-[11.5px] leading-relaxed m-0" style={{ color: "var(--text-info-yellow)" }}>
          ค่าประเทศและสกุลเงินเก็บไว้ที่แบรนด์เพียงชุดเดียว และ
          <strong>ใช้ร่วมกับฟอร์ม {otherFormLabel}</strong> — การแก้ไขที่นี่มีผลกับฟอร์ม {otherFormLabel} ทันที
          ทุกการเปลี่ยนแปลงจะถูกบันทึกไว้ว่าใครแก้ แก้จากฟอร์มใด และแก้จากค่าใดเป็นค่าใด
        </p>
      </div>

      <datalist id={COUNTRY_LIST_ID}>
        {COMMON_COUNTRY_CODES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      {rows.length === 0 && (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>
          {data && !data.ok ? (data.error ?? "โหลดข้อมูลสกุลเงินไม่สำเร็จ") : "ไม่พบแบรนด์"}
        </p>
      )}

      {rows.map((row) => {
        const saved = stored[row.brandCode] ?? BLANK;
        const draft = drafts[row.brandCode] ?? saved;
        const dirty = !sameDraft(draft, saved);
        const busy = savingCode === row.brandCode;
        // Read off the *saved* row: the badge says what the forms do today, not
        // what an unsaved edit would make them do.
        const live = brandCurrencyState(saved) === "configured";
        const chosen = draft.currencyCode;
        const foreign = !!chosen && !isBaht(chosen);
        const unsupported = foreign && !!supported && !supported.some((o) => o.code === chosen);

        return (
          <div
            key={row.brandCode}
            className="rounded-xl px-3.5 py-3 flex flex-col gap-3"
            style={{
              background: dirty ? "var(--bg-info-yellow)" : "var(--bg-card-alt)",
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: dirty ? "var(--border-info-yellow)" : "var(--border-card)",
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {row.brandLogo && (
                <img
                  src={row.brandLogo}
                  alt=""
                  className="h-6 w-auto object-contain shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="text-[13px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {row.brandName}
              </span>
              <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                {row.brandCode}
              </span>
              <span
                className="ml-auto text-[11px] font-semibold shrink-0"
                style={{ color: live ? "var(--text-info-green)" : "var(--text-muted)" }}
              >
                {live
                  ? `เบิกเป็น ${saved.currencyCode} ได้`
                  : saved.currencyCode && !isBaht(saved.currencyCode)
                    ? "ตั้งค่าไว้ — ยังไม่เปิดใช้"
                    : "บาทเท่านั้น"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                  ประเทศ (ISO-3166-1)
                </span>
                <input
                  list={COUNTRY_LIST_ID}
                  value={draft.countryCode ?? ""}
                  maxLength={2}
                  placeholder="เช่น TH"
                  onChange={(e) => {
                    const v = e.target.value.trim().toUpperCase();
                    patch(row.brandCode, { countryCode: v === "" ? null : v });
                  }}
                  className="w-full text-[13px] px-3 py-2 rounded-xl outline-none uppercase"
                  style={{
                    background: "var(--bg-input, var(--bg-card))",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-card)",
                  }}
                />
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                  สกุลเงิน (ISO-4217)
                </span>
                <CurrencyCombobox
                  options={currencyOptions.slice()}
                  value={draft.currencyCode ?? ""}
                  onChange={(code) => patch(row.brandCode, { currencyCode: code || null })}
                />
              </label>
            </div>

            <SettingOption
              variant="switch"
              checked={draft.currencyEnabled}
              disabled={!foreign}
              onChange={(next) => patch(row.brandCode, { currencyEnabled: next })}
              label="เปิดให้เบิกเป็นสกุลเงินนี้"
              description={
                !chosen
                  ? "เลือกสกุลเงินก่อนจึงจะเปิดใช้งานได้"
                  : !foreign
                    ? "THB เป็นสกุลเงินหลักอยู่แล้ว ไม่ต้องเปิดใช้งาน"
                    : "ปิดอยู่ = ตั้งค่าไว้เฉยๆ ฟอร์มยังเบิกเป็นบาทเท่านั้น"
              }
            />

            {unsupported && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-warning)" }}>
                ไม่พบ {chosen} ในแหล่งอัตราอ้างอิง — ระบบจะดึงอัตราแลกเปลี่ยนให้ไม่ได้
              </p>
            )}

            {foreign && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                อัตราที่ใช้แปลงเป็นบาทเป็น<strong>อัตราอ้างอิง</strong> ฝ่ายบัญชีปรับได้ในขั้นตอนอนุมัติ
              </p>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => save(row.brandCode, draft)}
                disabled={!dirty || busy}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border-none text-[12px] font-bold"
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                  border: "1px solid var(--btn-primary-border)",
                  opacity: !dirty || busy ? 0.5 : 1,
                  cursor: !dirty || busy ? "not-allowed" : "pointer",
                }}
              >
                <Save size={13} />
                {busy ? "กำลังบันทึก..." : "บันทึก"}
              </button>
              {dirty && !busy && (
                <span className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
                  ยังไม่บันทึก
                </span>
              )}
            </div>
          </div>
        );
      })}
    </SettingOptionGroup>
  );
}
