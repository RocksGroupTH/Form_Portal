"use client";

import { useState, useEffect, useMemo } from "react";
import useSWR from "swr";
import { Info, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingOption, SettingOptionGroup } from "@/components/settings/SettingOption";
import { CurrencyCombobox } from "@/features/advance/components/CurrencyCombobox";
import { FALLBACK_CURRENCIES } from "@/lib/acc/brand-currency-input";
import {
  COUNTRIES,
  countryLabel,
  currencyForCountry,
  isRateSourceCurrency,
} from "@/lib/acc/country-currency";
import {
  enabledForeignCurrencies,
  resolvedDefaultCurrency,
  THB,
  type BrandCurrencyEntry,
} from "@/lib/acc/currency";
// Thailand's ISO-3166-1 code, which the implicit THB row is written with. Taken
// from the claim rules rather than retyped: that module owns what "TH" means to
// this feature, and it imports nothing but data, so a client component is safe.
import { DEFAULT_COUNTRY as THAILAND } from "@/features/accounting/lib/claim-currency";
import type { AccBrandOption } from "@/features/accounting/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface FormBrandRow {
  id: number;
  brandCode: string;
  isActive: boolean;
  sortOrder: number;
}

/** One row of what `currencyEndpoint`'s GET returns — every brand in the master. */
interface BrandCurrencyRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  currencies: BrandCurrencyEntry[];
}

/**
 * Which brands a form accepts, and which currencies each brand may be claimed in.
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
 * `(form, brand)`. The editor below it writes `BrandCurrency` rows, which
 * belong to the **brand** and are shared with the other form — the user's
 * choice, spec §2. So a change made from AP-17's tab decides what an AP-1 claim
 * may be filed in, on a roster AP-1's admins do not control. That was taken
 * knowingly (spec §9.3) and cannot be expressed as a constraint, so it is made
 * *visible* instead: `otherFormLabel` is what lets the notice name the form
 * that is also affected, without this component holding either form's name.
 *
 * **The two halves also save differently, deliberately.** The tick list is a
 * set and is replaced whole on Save. The currency editor writes on every
 * control, because each control is one row: a Save sweeping a brand's whole
 * list would silently undo what another admin had just changed from the other
 * tab.
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

/* ── the currency editor ─────────────────────────────────────────────────── */

const CURRENCY_LIST_URL = "/api/request/advance/currencies";

/** What the add row holds for one brand while it is being filled in. */
interface AddDraft {
  countryCode: string;
  currencyCode: string;
}

const BLANK_ADD: AddDraft = { countryCode: "", currencyCode: "" };

/**
 * The id given to the **implicit Thailand row** — the one every brand has until
 * somebody configures baht explicitly.
 *
 * Zero is safe as a sentinel because `BrandCurrency.Id` is `IDENTITY(1,1)`, so
 * no real row can ever carry it. The row is rendered like any other and its two
 * controls both materialise it: switching it off posts a disabled `THB` row,
 * marking it default posts an enabled one already flagged. Doing either as an
 * add followed by a second request would leave the brand momentarily in a state
 * the admin had just refused.
 */
const IMPLICIT_THB_ID = 0;

/**
 * The currencies each brand may be claimed in, and which one its claims start
 * in.
 *
 * **Several per brand, each with its own switch.** A brand carried one country
 * and one currency until 2026-08-28, which cannot say what KSI needs — Thailand
 * (THB) and England (GBP), and more later. Every row here is one
 * `BrandCurrency` row (migration 127).
 *
 * **Thailand is a row like any other, and it is the one that may not exist.**
 * Baht is claimable while nothing says otherwise, so a brand nobody has
 * configured has no `THB` row at all — see `bahtEnabled`. Hiding it would make
 * "switch Thailand off" unexpressible, so it is rendered from nothing, with
 * `IMPLICIT_THB_ID`, and its controls write the row into existence.
 *
 * **Every control writes immediately; there is no Save button and no dirty
 * state.** Each act is one row — add it, switch it, make it the default, remove
 * it — so there is nothing to batch, and a Save that swept a brand's whole list
 * would silently undo what somebody else had just changed from the other form's
 * tab, which reaches these same rows.
 *
 * **Duplicates, and "a brand must be claimable in something", are refused by the
 * server.** `UQ_BrandCurrency_Brand_Currency` is the first rule and
 * `assertStillClaimable` the second; a configured currency is greyed out here
 * and the last live switch is left disabled, so both refusals are rare — but two
 * admins on two tabs defeat any check made only on screen, and the server's Thai
 * message is what they see if they do.
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

  const [adds, setAdds] = useState<Record<string, AddDraft>>({});
  /** The one control currently in flight, so only it is disabled. */
  const [busy, setBusy] = useState<string | null>(null);

  const patchAdd = (code: string, next: Partial<AddDraft>) => {
    setAdds((prev) => {
      const base = prev[code] ?? BLANK_ADD;
      const out: Record<string, AddDraft> = {};
      for (const k of Object.keys(prev)) out[k] = prev[k];
      out[code] = {
        countryCode: next.countryCode !== undefined ? next.countryCode : base.countryCode,
        currencyCode: next.currencyCode !== undefined ? next.currencyCode : base.currencyCode,
      };
      return out;
    });
  };

  /** One request, one toast, one refetch. `key` is what gets disabled while it runs. */
  const send = async (
    key: string,
    init: RequestInit & { url?: string },
    okMessage: string,
    onOk?: () => void,
  ) => {
    setBusy(key);
    try {
      const res = await fetch(init.url ?? endpoint, init);
      const json = await res.json();
      if (json.ok) {
        toast.success(okMessage);
        onOk?.();
        mutate();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      }
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  };

  const postCurrency = (
    key: string,
    brandCode: string,
    body: {
      countryCode: string | null;
      currencyCode: string;
      isEnabled?: boolean;
      isDefault?: boolean;
    },
    okMessage: string,
    onOk?: () => void,
  ) =>
    send(
      key,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCode, ...body }),
      },
      okMessage,
      onOk,
    );

  const addCurrency = (brandCode: string, draft: AddDraft) =>
    postCurrency(
      `add:${brandCode}`,
      brandCode,
      { countryCode: draft.countryCode || null, currencyCode: draft.currencyCode },
      `เพิ่มสกุลเงิน ${draft.currencyCode} ให้ ${brandCode} แล้ว`,
      () =>
        setAdds((prev) => {
          const out: Record<string, AddDraft> = {};
          for (const k of Object.keys(prev)) if (k !== brandCode) out[k] = prev[k];
          return out;
        }),
    );

  /**
   * Switch one row on or off.
   *
   * The implicit Thailand row is only ever switched **off** — it renders as on
   * because nothing has said otherwise — and doing so creates the `THB` row
   * already disabled, in one write.
   */
  const toggleCurrency = (brandCode: string, row: BrandCurrencyEntry, isEnabled: boolean) =>
    row.id === IMPLICIT_THB_ID
      ? postCurrency(
          `row:${brandCode}:${THB}`,
          brandCode,
          { countryCode: THAILAND, currencyCode: THB, isEnabled },
          isEnabled ? `เปิดใช้ ${THB} แล้ว` : `ปิดใช้ ${THB} แล้ว`,
        )
      : send(
          `row:${row.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: row.id, isEnabled }),
          },
          isEnabled ? `เปิดใช้ ${row.currencyCode} แล้ว` : `ปิดใช้ ${row.currencyCode} แล้ว`,
        );

  /** Make one row the brand's default — the country AP-1's form opens on. */
  const makeDefault = (brandCode: string, row: BrandCurrencyEntry) =>
    row.id === IMPLICIT_THB_ID
      ? postCurrency(
          `row:${brandCode}:${THB}`,
          brandCode,
          { countryCode: THAILAND, currencyCode: THB, isEnabled: true, isDefault: true },
          `ตั้ง ${THB} เป็นค่าเริ่มต้นของ ${brandCode} แล้ว`,
        )
      : send(
          `row:${row.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: row.id, isDefault: true }),
          },
          `ตั้ง ${row.currencyCode} เป็นค่าเริ่มต้นแล้ว`,
        );

  const deleteCurrency = (row: BrandCurrencyEntry) =>
    send(
      `row:${row.id}`,
      { method: "DELETE", url: `${endpoint}?id=${row.id}` },
      `ลบ ${row.currencyCode} แล้ว`,
    );

  return (
    <SettingOptionGroup
      title="สกุลเงินที่เบิกได้ของแต่ละแบรนด์"
      description="เลือกประเทศแล้วระบบจะใส่สกุลเงินของประเทศนั้นให้เอง — เพิ่มได้หลายสกุลเงินต่อหนึ่งแบรนด์ เปิด/ปิดใช้งานทีละรายการ และเลือกได้ว่าจะให้ฟอร์มเริ่มต้นที่สกุลเงินใด (รวมถึงไทยที่ปิดใช้งานได้เช่นกัน แต่ต้องเหลือสกุลเงินที่เปิดใช้งานอย่างน้อยหนึ่งสกุล)"
    >
      {/*
        Required copy, not decoration. The permission to change these values is
        per form while the values themselves belong to the brand, shared with
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
          สกุลเงินเก็บไว้ที่แบรนด์เพียงชุดเดียว และ
          <strong>ใช้ร่วมกับฟอร์ม {otherFormLabel}</strong> — การแก้ไขที่นี่มีผลกับฟอร์ม {otherFormLabel} ทันที
          ทุกการเปลี่ยนแปลงจะถูกบันทึกไว้ว่าใครแก้ แก้จากฟอร์มใด และแก้จากค่าใดเป็นค่าใด
        </p>
      </div>

      {rows.length === 0 && (
        <p className="text-[12px] py-6 text-center" style={{ color: "var(--text-muted)" }}>
          {data && !data.ok ? (data.error ?? "โหลดข้อมูลสกุลเงินไม่สำเร็จ") : "ไม่พบแบรนด์"}
        </p>
      )}

      {rows.map((brand) => {
        const add = adds[brand.brandCode] ?? BLANK_ADD;
        // Read off what the server holds: the badge says what the forms do
        // today. `brandCurrencyState` owns the rule — a brand is "configured"
        // only while at least one non-baht currency is switched on.
        const live = enabledForeignCurrencies(brand.currencies);
        const taken = brand.currencies.map((c) => c.currencyCode);
        const chosen = add.currencyCode.trim().toUpperCase();
        const duplicate = chosen !== "" && taken.indexOf(chosen) !== -1;
        // Two different "we cannot convert this" answers, and only the first is
        // a refusal. `isRateSourceCurrency` is the same predicate the server
        // parses with, so a code it rejects can never be added; `supported` is
        // the live provider list, which may lag or be unreachable, so a code
        // missing only from that is warned about rather than blocked.
        const rateless = chosen !== "" && !isRateSourceCurrency(chosen);
        const unsupported =
          !rateless && chosen !== "" && !!supported && !supported.some((o) => o.code === chosen);
        const addable = currencyOptions.filter(
          (o) => taken.indexOf(o.code) === -1 && isRateSourceCurrency(o.code),
        );
        const canAdd =
          chosen !== "" && !duplicate && !rateless && busy !== `add:${brand.brandCode}`;

        // Thailand is a row whether or not one exists — see IMPLICIT_THB_ID.
        const hasThbRow = taken.indexOf(THB) !== -1;
        const listed: BrandCurrencyEntry[] = hasThbRow
          ? brand.currencies
          : ([
              {
                id: IMPLICIT_THB_ID,
                countryCode: THAILAND,
                currencyCode: THB,
                isEnabled: true,
                isDefault: false,
              },
            ] as BrandCurrencyEntry[]).concat(brand.currencies);

        // What is in force, not merely what is flagged: no brand configured
        // before migration 131 has a flag at all and baht is the answer for all
        // of them.
        const defaultCode = resolvedDefaultCurrency(brand.currencies);
        const enabledCount = listed.filter((c) => c.isEnabled).length;

        return (
          <div
            key={brand.brandCode}
            className="rounded-xl px-3.5 py-3 flex flex-col gap-3"
            style={{
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {brand.brandLogo && (
                <img
                  src={brand.brandLogo}
                  alt=""
                  className="h-6 w-auto object-contain shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              )}
              <span className="text-[13px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                {brand.brandName}
              </span>
              <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                {brand.brandCode}
              </span>
              <span
                className="ml-auto text-[11px] font-semibold shrink-0"
                style={{ color: live.length > 0 ? "var(--text-info-green)" : "var(--text-muted)" }}
              >
                {live.length > 0
                  ? `เบิกเป็น ${live.join(", ")} ได้`
                  : brand.currencies.length > 0
                    ? "ตั้งค่าไว้ — ยังไม่เปิดใช้"
                    : "บาทเท่านั้น"}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              {listed.map((c) => {
                const implicit = c.id === IMPLICIT_THB_ID;
                const rowBusy =
                  busy === (implicit ? `row:${brand.brandCode}:${THB}` : `row:${c.id}`);
                const label = countryLabel(c.countryCode);
                const noRate = !!supported && !supported.some((o) => o.code === c.currencyCode);
                const isDefault = c.currencyCode === defaultCode;
                // The last live switch is left on. `assertStillClaimable` is the
                // rule; this is only so the refusal is rare rather than routine.
                const lockedOn = c.isEnabled && enabledCount <= 1;
                return (
                  <div
                    key={implicit ? `implicit-${THB}` : c.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-card)",
                      opacity: rowBusy ? 0.6 : 1,
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                        {c.currencyCode}
                      </div>
                      <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                        {/* A country the list does not carry cannot happen —
                            the add refuses one — but a row written before this
                            rule existed would show its bare code rather than
                            nothing at all. */}
                        {label ?? c.countryCode ?? "ไม่ได้ระบุประเทศ"}
                        {implicit && " — เปิดใช้อยู่เป็นค่าตั้งต้น"}
                        {noRate && " — ไม่พบในแหล่งอัตราอ้างอิง"}
                      </div>
                    </div>

                    <label
                      className="flex items-center gap-1.5 text-[11.5px] shrink-0"
                      style={{ cursor: c.isEnabled && !rowBusy ? "pointer" : "not-allowed" }}
                      title={
                        c.isEnabled
                          ? "ให้ฟอร์มเริ่มต้นที่สกุลเงินนี้"
                          : "ต้องเปิดใช้งานก่อนจึงจะตั้งเป็นค่าเริ่มต้นได้"
                      }
                    >
                      <input
                        type="radio"
                        name={`default-${brand.brandCode}`}
                        checked={isDefault}
                        disabled={rowBusy || !c.isEnabled || isDefault}
                        onChange={() => makeDefault(brand.brandCode, c)}
                        style={{ cursor: c.isEnabled && !rowBusy ? "pointer" : "not-allowed" }}
                      />
                      <span
                        style={{
                          color: isDefault ? "var(--nav-active-text)" : "var(--text-muted)",
                          fontWeight: isDefault ? 700 : 400,
                        }}
                      >
                        ค่าเริ่มต้น
                      </span>
                    </label>

                    <label
                      className="flex items-center gap-2 text-[11.5px] shrink-0"
                      style={{ cursor: rowBusy || lockedOn ? "not-allowed" : "pointer" }}
                      title={
                        lockedOn
                          ? "ต้องเหลือสกุลเงินที่เปิดใช้งานอย่างน้อยหนึ่งสกุล"
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={c.isEnabled}
                        disabled={rowBusy || lockedOn}
                        onChange={(e) => toggleCurrency(brand.brandCode, c, e.target.checked)}
                        style={{ cursor: rowBusy || lockedOn ? "not-allowed" : "pointer" }}
                      />
                      <span style={{ color: c.isEnabled ? "var(--text-info-green)" : "var(--text-muted)" }}>
                        {c.isEnabled ? "เปิดใช้งาน" : "ปิดอยู่"}
                      </span>
                    </label>

                    {/* An implicit row has nothing to delete. Removing a real
                        THB row is allowed and puts the brand back here: baht is
                        claimable while nothing says otherwise. */}
                    {implicit ? (
                      // Keeps the toggles above and below this row in one
                      // column: the same footprint the delete button occupies
                      // (14px icon inside 6px of padding each side).
                      <span className="shrink-0" style={{ width: 26, height: 26 }} />
                    ) : (
                      <button
                        type="button"
                        title={`ลบ ${c.currencyCode}`}
                        aria-label={`ลบ ${c.currencyCode}`}
                        disabled={rowBusy}
                        onClick={() => deleteCurrency(c)}
                        className="shrink-0 rounded-lg p-1.5 border-none"
                        style={{
                          background: "transparent",
                          color: "var(--text-danger)",
                          cursor: rowBusy ? "not-allowed" : "pointer",
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                  ประเทศ
                </span>
                <select
                  value={add.countryCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    // Picking a country fills the currency in — the whole point
                    // of the country box. `currencyForCountry` answers null for
                    // a code the list does not carry, and the currency is then
                    // left as it is rather than blanked to a guess.
                    const currency = currencyForCountry(code);
                    patchAdd(brand.brandCode, {
                      countryCode: code,
                      currencyCode: currency ?? add.currencyCode,
                    });
                  }}
                  className="w-full text-[13px] px-3 py-2 rounded-xl outline-none"
                  style={{
                    background: "var(--bg-input, var(--bg-card))",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-card)",
                  }}
                >
                  <option value="">— เลือกประเทศ —</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {countryLabel(c.code)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
                  สกุลเงิน (ISO-4217)
                </span>
                <CurrencyCombobox
                  options={addable.slice()}
                  value={add.currencyCode}
                  onChange={(code) => patchAdd(brand.brandCode, { currencyCode: code })}
                />
              </label>

              <button
                type="button"
                onClick={() => addCurrency(brand.brandCode, { ...add, currencyCode: chosen })}
                disabled={!canAdd}
                className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border-none text-[12px] font-bold"
                style={{
                  background: "var(--btn-primary-bg)",
                  color: "var(--btn-primary-text)",
                  border: "1px solid var(--btn-primary-border)",
                  opacity: canAdd ? 1 : 0.5,
                  cursor: canAdd ? "pointer" : "not-allowed",
                }}
              >
                <Plus size={13} />
                {busy === `add:${brand.brandCode}` ? "กำลังเพิ่ม..." : "เพิ่ม"}
              </button>
            </div>

            {duplicate && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-warning)" }}>
                แบรนด์นี้มีสกุลเงิน {chosen} อยู่แล้ว
              </p>
            )}

            {rateless && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-warning)" }}>
                ไม่พบ {chosen} ในแหล่งอัตราอ้างอิง — เพิ่มไม่ได้ เพราะระบบจะแปลงเป็นเงินบาทให้ไม่ได้
              </p>
            )}

            {unsupported && !duplicate && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-warning)" }}>
                ขณะนี้ยังดึงรายชื่อสกุลเงินจากแหล่งอัตราอ้างอิงไม่ได้ — {chosen} อาจดึงอัตราแลกเปลี่ยนไม่ได้ในตอนนี้
              </p>
            )}

            {live.length > 0 && (
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                อัตราที่ใช้แปลงเป็นบาทเป็น<strong>อัตราอ้างอิง</strong> ฝ่ายบัญชีปรับได้ในขั้นตอนอนุมัติ
              </p>
            )}
          </div>
        );
      })}
    </SettingOptionGroup>
  );
}
