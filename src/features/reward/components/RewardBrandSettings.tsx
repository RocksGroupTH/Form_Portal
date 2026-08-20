"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { BrandChips } from "@/features/reward/components/BrandChips";

/**
 * Which companies AP-11 is open for.
 *
 * Rewards are brand-scoped stock, so this list is not cosmetic: a brand that is
 * off here has no brand strip, no catalogue and no way for its staff to file at
 * all. Migration 067 seeds it from AP-1's set so the form works on day one; this
 * panel is how it is changed afterwards.
 *
 * Unlike the reward catalogue, `AccFormBrand` **is** one of the 19 dual-written
 * masters, so a change here lands in both databases through `setFormBrands`.
 */

interface BrandRow {
  brandCode: string;
  brandName: string;
  brandLogo?: string | null;
}

export function RewardBrandSettings() {
  const [all, setAll] = useState<BrandRow[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/request/accounting/options/all-brands").then((r) => r.json()),
      fetch("/api/request/reward/settings/brands").then((r) => r.json()),
    ])
      .then(([allJson, mineJson]) => {
        if (cancelled) return;
        if (allJson.ok) setAll((allJson.data ?? []) as BrandRow[]);
        if (mineJson.ok) {
          setSelected(
            ((mineJson.data ?? []) as { brandCode: string; isActive: boolean }[])
              .filter((b) => b.isActive)
              .map((b) => b.brandCode),
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(code: string) {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/request/reward/settings/brands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brandCodes: selected }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกแล้ว");
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-[14px] p-4 sm:p-5"
      style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
        บริษัทที่เปิดใช้ AP-11
      </h2>
      <p className="text-[11.5px] mt-1 mb-3.5" style={{ color: "var(--text-muted)" }}>
        ของรางวัลแยกตามบริษัท — บริษัทที่ปิดไว้จะไม่มีของรางวัลให้เบิกเลย
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={15} className="animate-spin" />
          กำลังโหลด...
        </div>
      ) : (
        <>
          <BrandChips
            brands={all}
            isActive={(code) => selected.includes(code)}
            onSelect={toggle}
            className="flex flex-wrap gap-2 mb-3.5"
          />

          {selected.length === 0 && (
            <p
              className="text-[12px] rounded-lg px-3 py-2 mb-3"
              style={{
                background: "var(--status-bad-bg)",
                color: "var(--status-bad-text)",
              }}
            >
              ไม่ได้เลือกบริษัทใดเลย — จะไม่มีใครส่งคำขอ AP-11 ได้
            </p>
          )}

          <Button variant="primary" size="md" loading={saving} onClick={save}>
            บันทึก
          </Button>
        </>
      )}
    </section>
  );
}
