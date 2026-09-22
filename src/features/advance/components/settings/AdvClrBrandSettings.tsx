"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { BrandToggleCard, BrandToggleGrid } from "@/components/settings/BrandToggleCard";

const LIST = "/api/request/advance/settings/erp-interface";
/**
 * The company brand master, for its ORDER.
 *
 * AP-1's path and deliberately so — it reads `Rocks_Codex.dbo.Brand`, not an
 * AP-1 list, and AP-17 and AP-4's panels already share it for the same reason.
 * It touches no form database, so the AP-1 classification on the prefix costs
 * nothing here.
 */
const MASTER = "/api/request/accounting/options/all-brands";
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
 * rendering two toggles would be two controls over one row. Hence one panel,
 * saying so on screen.
 *
 * **On AP-2's settings page ALONE since 2026-09-22** (the user's decision,
 * taken with the per-form สิทธิ์เข้าถึง split). It was rendered by both pages
 * until then, which was the same fact expressed differently — one switch, seen
 * twice. Once each form's grants became its own, a `brands` tick had to belong
 * to one page or be half a grant over a control neither owned, so the tab moved
 * rather than being divided. **AP-3's settings page renders a line above every
 * tab saying where it went**, because a control that vanishes with no
 * explanation reads as a bug or a lost permission.
 *
 * **The list is every brand in the registry, not only the ones already
 * granted** — it is read from the Interface ERP endpoint, whose own row list
 * unions `AccFormBrand` with the brand master for exactly this reason: a brand
 * added to the master has no `AccFormBrand` row, and the only way to create one
 * is this toggle, so a list of granted brands alone could never grow.
 *
 * **The card is `BrandToggleCard`, shared with AP-1, AP-17 and AP-4** since
 * 2026-09-14 — every form's brand tab renders the same tile, in the brand
 * master's order. Getting the order right took a second pass: this panel lists
 * from the Interface ERP endpoint, which emits `AccFormBrand` rows before the
 * master's leftovers, so it opened on PLM where every other form opens on
 * ROCKS. See `rows` below.
 */
export function AdvClrBrandSettings() {
  const { data, isLoading, error, mutate } = useSWR<{ ok: boolean; data?: BrandRow[] }>(LIST, fetcher);
  const unordered = data?.ok && data.data ? data.data : [];
  const { data: masterData } = useSWR<{ ok: boolean; data?: { brandCode: string }[] }>(
    MASTER,
    fetcher,
  );

  /**
   * The brand master's order (user, 2026-09-14: "แบรนด์ที่เบิกได้ AP-2 & AP-3
   * เรียงตามในรูป" — the picture being AP-17's tab).
   *
   * The list itself has to keep coming from the Interface ERP endpoint, which
   * is the only one that unions `AccFormBrand` with the master — a brand with
   * no row would otherwise be missing from the one screen that can create it.
   * What that endpoint cannot give is a sequence anybody recognises: it emits
   * AP-2's `AccFormBrand` rows in their own `SortOrder` first and the master's
   * leftovers after, so PLM led the list while every other form led with ROCKS.
   * Sorting here rather than changing the endpoint leaves the Interface ERP
   * screen's own grouping alone.
   *
   * **A brand the master does not list keeps its place at the end**, in the
   * order it arrived — dropping it would hide the row, and `ROCKS` on AP-4 is a
   * live example of a code the master does not know.
   */
  const rows = useMemo(() => {
    const order = masterData?.ok && masterData.data ? masterData.data : [];
    if (order.length === 0) return unordered;
    const rank = new Map(order.map((b, i) => [b.brandCode, i]));
    return unordered
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const ra = rank.get(a.row.brandCode) ?? order.length + a.i;
        const rb = rank.get(b.row.brandCode) ?? order.length + b.i;
        return ra - rb;
      })
      .map((x) => x.row);
  }, [unordered, masterData]);
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
