"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isBaht, toBaht } from "@/lib/acc/currency";
import { sanitizeOverrideRate } from "@/lib/acc/rate-override-policy";

/**
 * Accounting's correction to a claim's exchange rate, at the ACCOUNT step.
 *
 * **One component for AP-1 and AP-17**, because the correction is the same act
 * in both: the stored rate is an ECB mid-market reference rate — no Bank of
 * Thailand key will be provisioned (spec §9.1) — and this is the only place the
 * difference from what a bank actually settles at can be put right. Two copies
 * would drift on the one thing that must not, which is the copy explaining what
 * the number *is*.
 *
 * **Nothing here is captioned as a Bank of Thailand rate.** `อัตราอ้างอิง`,
 * with the sentence saying it is a reference figure the approver may correct.
 *
 * Renders **nothing at all** unless the request is both at the ACCOUNT step and
 * in a foreign currency, so a baht claim is untouched — the rule the whole
 * feature is held to. The gate is repeated on the server: the route checks
 * account-area membership and the UPDATE carries the step in its own predicate,
 * because a control absent from a page is not a control the server has.
 */

export interface RateOverrideSaved {
  id: number;
  rate: number;
  /** Baht. Unchanged where `totalRewritten` is false. */
  totalAmount: number | null;
  /** False for a request that carries no `ForeignAmount` to convert. */
  totalRewritten: boolean;
}

function fmtRate(v: number): string {
  return v.toLocaleString("th-TH", { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function fmtMoney(v: number): string {
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function ExchangeRateOverride({
  endpoint,
  atAccountStep,
  currency,
  rate,
  foreignAmount,
  onSaved,
}: {
  /** `POST` target. AP-1 and AP-17 each have their own, gated their own way. */
  endpoint: string;
  /** `Status === "ManagerApproved" && currentStepCode === "ACCOUNT"`. */
  atAccountStep: boolean;
  currency: string | null;
  /** THB per 1 unit, as stored. */
  rate: number | null;
  /**
   * The claim's own figure, of which the baht total is the conversion — AP-1
   * only. Null means the request has no such figure (AP-17, whose header total
   * is per diem and always baht), and then the rate changes what screens
   * display and nothing that is stored as a total.
   */
  foreignAmount: number | null;
  onSaved: (saved: RateOverrideSaved) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed whenever the stored rate changes — including after a save, so the
  // field shows what the database took rather than what was typed at it.
  useEffect(() => {
    setDraft(rate === null ? "" : String(rate));
  }, [rate]);

  const parsed = useMemo(() => sanitizeOverrideRate(draft), [draft]);
  const preview = useMemo(
    () => (parsed === null || foreignAmount === null ? null : toBaht(foreignAmount, parsed)),
    [parsed, foreignAmount],
  );

  if (!atAccountStep || isBaht(currency)) return null;
  const cur = (currency ?? "").trim().toUpperCase();

  const unchanged = parsed !== null && rate !== null && parsed === rate;

  async function save() {
    if (parsed === null) {
      toast.error("กรอกอัตราเป็นตัวเลขมากกว่า 0");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rate: parsed }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        // The server's own reason — wrong step, unconvertible, out of scope.
        toast.error(json?.error ?? "แก้อัตราแลกเปลี่ยนไม่สำเร็จ");
        return;
      }
      const data = json.data as RateOverrideSaved;
      toast.success(
        data.totalRewritten
          ? `บันทึกอัตราแล้ว — ยอดรวมใหม่ ${fmtMoney(data.totalAmount ?? 0)} บาท`
          : "บันทึกอัตราแล้ว",
      );
      onSaved(data);
    } catch {
      toast.error("แก้อัตราแลกเปลี่ยนไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-2xl p-3.5 mb-4 flex flex-col gap-2.5"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex items-center gap-2">
        <Coins size={15} strokeWidth={2.25} style={{ color: "var(--text-info-yellow)" }} />
        <p className="text-[12.5px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
          อัตราแลกเปลี่ยน ({cur}) — อัตราอ้างอิง
        </p>
      </div>

      <p className="text-[11.5px] m-0 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        อัตราที่บันทึกไว้เป็น<strong>อัตราอ้างอิงกลางตลาด</strong> ไม่ใช่อัตราที่ธนาคารใช้จ่ายจริง
        ฝ่ายบัญชีแก้ให้ตรงกับอัตราที่จ่ายจริงได้ที่นี่ ก่อนอนุมัติ
      </p>

      <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
        อัตราที่บันทึกไว้:{" "}
        <strong style={{ color: "var(--text-primary)" }}>
          {rate === null ? "—" : `1 ${cur} = ${fmtRate(rate)} บาท`}
        </strong>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          1 {cur} =
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`อัตราแลกเปลี่ยน 1 ${cur} เป็นบาท`}
          className="text-[13px] px-3 py-1.5 rounded-lg outline-none w-[140px]"
          style={{
            background: "var(--bg-input)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-input)",
          }}
        />
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          บาท
        </span>
        <Button
          variant="primary"
          size="md"
          loading={saving}
          disabled={parsed === null || unchanged}
          onClick={() => void save()}
        >
          บันทึกอัตรา
        </Button>
      </div>

      {draft.trim() !== "" && parsed === null && (
        <p className="text-[11.5px] m-0" style={{ color: "var(--color-danger)" }}>
          อัตราไม่ถูกต้อง — ต้องเป็นตัวเลขมากกว่า 0
        </p>
      )}

      {foreignAmount === null ? (
        <p className="text-[11.5px] m-0 leading-relaxed" style={{ color: "var(--text-muted)" }}>
          ยอดรวมของคำขอนี้เป็นเบี้ยเลี้ยง (เงินบาท) จึงไม่เปลี่ยนตามอัตรา —
          อัตราใช้สำหรับแสดงค่าจองเทียบเป็นเงินบาท
        </p>
      ) : (
        <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
          {preview === null
            ? `ยอดที่เบิก ${fmtMoney(foreignAmount)} ${cur}`
            : `ยอดที่เบิก ${fmtMoney(foreignAmount)} ${cur} → ยอดรวมใหม่ ${fmtMoney(preview)} บาท`}
        </p>
      )}
    </div>
  );
}
