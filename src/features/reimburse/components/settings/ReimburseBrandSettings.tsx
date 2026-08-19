"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Save } from "lucide-react";
import { toast } from "sonner";
import { SettingOption, SettingOptionGroup } from "@/components/settings/SettingOption";
import type { AccBrandOption } from "@/features/accounting/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const ENDPOINT = "/api/request/reimburse/settings/brands";

interface FormBrandRow {
  id: number;
  brandCode: string;
  isActive: boolean;
  sortOrder: number;
}

/**
 * Which brands an AP-4 claim may be filed against.
 *
 * AP-1's `BrandSettings` with the form code swapped — same `AccFormBrand` table,
 * same `listFormBrands` / `setFormBrands`, same all-brands picker
 * (`Rocks_Codex.dbo.Brand`). Reused rather than reimplemented so the two forms
 * cannot disagree about what an allowed brand is.
 *
 * One addition AP-1 does not need: a warning when the saved set contains a code
 * the brand master does not know. Migration 092 seeds AP-4 with `ROCKS`, which
 * is not one of the four BrandGate companies and may have no master row — it
 * would then render with no logo and its own code as its name, and, more to the
 * point, the requester's picker would offer one option that says less about who
 * paid than the brand cookie used to. Whether that is right is Accounting's call
 * and this page is where it is made, so the state is named rather than hidden.
 */
export function ReimburseBrandSettings() {
  const { data, error, mutate } = useSWR<{ ok: boolean; data: FormBrandRow[] }>(ENDPOINT, fetcher);
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
      const activeCodes = new Set(data.data.filter((b) => b.isActive).map((b) => b.brandCode));
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
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCodes: Array.from(checked) }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success("บันทึกสำเร็จ");
        setSavedChecked(new Set(checked));
        void mutate();
      } else {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      }
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  // Saved codes the brand master has no row for. They stay allowed — dropping
  // one silently would change which company an existing draft is claimed
  // against — but they cannot be ticked or unticked from the list below, so
  // say they are there.
  const knownCodes = new Set(allBrands.map((b) => b.brandCode));
  const orphanCodes = Array.from(savedChecked).filter((c) => !knownCodes.has(c));

  // Three states, not two. `checked` is empty while the list is loading, when
  // the fetch failed, and when nothing is genuinely ticked — and the banner
  // below tells the admin their configuration is broken, which during an outage
  // is false and points them at the wrong repair. `error` is a thrown fetch;
  // `data.ok === false` is the route answering with a reason.
  const loadFailed = !!error || (!!data && !data.ok);
  const loaded = !!data && data.ok;

  return (
    <div>
      {allBrands.length > 0 && orphanCodes.length > 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5 mb-4"
          style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed m-0">
            แบรนด์ที่อนุญาตอยู่แต่ไม่มีในทะเบียนแบรนด์กลาง: <b>{orphanCodes.join(", ")}</b> —
            ผู้ขอเบิกจะเห็นเป็นตัวเลือกที่ไม่มีโลโก้และแสดงเป็นรหัสแทนชื่อบริษัท
            หากต้องการให้ระบุบริษัทที่จ่ายจริง ให้ติ๊กแบรนด์บริษัทด้านล่างเพิ่ม
          </p>
        </div>
      )}

      {loadFailed && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5 mb-4"
          style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed m-0">
            โหลดรายการแบรนด์ที่ตั้งค่าไว้ไม่สำเร็จ — ที่เห็นด้านล่างจึงยังไม่ใช่ค่าที่บันทึกไว้จริง
            กรุณารีเฟรชหน้านี้ก่อนแก้ไข การกดบันทึกตอนนี้จะเขียนทับค่าเดิมทั้งหมด
          </p>
        </div>
      )}

      {loaded && checked.size === 0 && (
        <div
          className="rounded-xl px-4 py-3 flex items-start gap-2.5 mb-4"
          style={{ background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }}
        >
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <p className="text-[12px] leading-relaxed m-0">
            ยังไม่ได้เลือกแบรนด์ใดเลย — ผู้ขอเบิกจะไม่มีตัวเลือกแบรนด์ให้เลือก และส่งคำขอ AP-4 ไม่ได้
          </p>
        </div>
      )}

      <SettingOptionGroup
        title="แบรนด์ที่เบิกได้ (AP-4)"
        description="เลือกแบรนด์ที่พนักงานสามารถเลือกในฟอร์มขอเบิกเงินคืน AP-4 — ติ๊กเพื่อเปิด/ปิด แล้วกดบันทึก"
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
        onClick={() => void handleSave()}
        disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-xl cursor-pointer border-none text-[13px] font-bold"
        style={{ background: "var(--color-action)", color: "var(--btn-primary-text)", opacity: saving ? 0.6 : 1 }}
      >
        <Save size={14} />
        {saving ? "กำลังบันทึก..." : "บันทึก"}
      </button>
    </div>
  );
}
