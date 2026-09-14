"use client";

import { useState } from "react";
import useSWR from "swr";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { BrandToggleCard, BrandToggleGrid } from "@/components/settings/BrandToggleCard";

const LIST = "/api/request/advance/settings/erp-interface";
const TOGGLE = "/api/request/advance/settings/brand-active";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface BrandRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  active: boolean;
}

/**
 * Which brands AP-2 and AP-3 accept, on a tab of their own.
 *
 * **Split out of Interface ERP on 2026-09-14** (user: "AP-2 & AP-3 จะต้องแยก
 * Brand ที่เบิกได้ออกมาจาก Interface ERP เหมือนกับ AP-1"). It had been a
 * per-brand switch buried in the posting-configuration screen, where AP-1,
 * AP-17 and AP-4 all give it a tab — and where turning a brand off for the
 * whole form read as a detail of one ERP group.
 *
 * **One switch covers both forms, and that is the storage rather than this
 * screen.** `setBrandActiveShared` MERGEs `AccFormBrand` for `'AP-2'` and
 * `'AP-3'` in one transaction, so a brand is claimable on both or neither;
 * rendering two toggles would be two controls over one row. Hence one panel
 * shown on both settings pages, saying so.
 *
 * **The list is every brand in the registry, not only the ones already
 * granted** — it is read from the Interface ERP endpoint, whose own row list
 * unions `AccFormBrand` with the brand master for exactly this reason: a brand
 * added to the master has no `AccFormBrand` row, and the only way to create one
 * is this toggle, so a list of granted brands alone could never grow.
 *
 * **The card is `BrandToggleCard`, shared with AP-1, AP-17 and AP-4** since
 * 2026-09-14 — every form's brand tab renders the same tile. The ORDER stays
 * each form's own: here it is the endpoint's, `AccFormBrand` rows first and
 * then the brand master, and that was the user's condition on the change.
 */
export function AdvClrBrandSettings() {
  const { data, isLoading, error, mutate } = useSWR<{ ok: boolean; data?: BrandRow[] }>(LIST, fetcher);
  const rows = data?.ok && data.data ? data.data : [];
  const [busy, setBusy] = useState<string | null>(null);

  async function toggle(row: BrandRow, active: boolean) {
    setBusy(row.brandCode);
    try {
      const res = await fetch(TOGGLE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCode: row.brandCode, active }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? "อัปเดตไม่สำเร็จ");
      toast.success(active ? `เปิด ${row.brandName}` : `ปิด ${row.brandName}`);
      await mutate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "อัปเดตไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl px-4 py-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}>
        <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
          <Building2 size={15} style={{ color: "var(--nav-active-text)" }} /> แบรนด์ที่เบิกได้ (AP-2 + AP-3)
        </p>
        <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
          {/* One row, one switch — see the component docblock. */}
          เปิด/ปิดครั้งเดียวมีผล<b>ทั้ง AP-2 และ AP-3</b> · ปิดแล้วแบรนด์จะหายจากตัวเลือกในฟอร์มขอเบิกและฟอร์มเคลียร์
        </p>
      </div>

      {error || (data && !data.ok) ? (
        <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
          โหลดรายชื่อแบรนด์ไม่สำเร็จ — กรุณารีเฟรชหน้านี้
        </p>
      ) : isLoading ? (
        <p className="text-[13px] py-8 text-center m-0" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : (
        <BrandToggleGrid>
          {rows.map((row) => (
            <BrandToggleCard
              key={row.brandCode}
              brandCode={row.brandCode}
              brandName={row.brandName}
              brandLogo={row.brandLogo}
              sub={`${row.brandCode} → ${row.interfaceTarget || "—"}`}
              checked={row.active}
              disabled={busy === row.brandCode}
              onChange={(next) => void toggle(row, next)}
            />
          ))}
        </BrandToggleGrid>
      )}
    </div>
  );
}
