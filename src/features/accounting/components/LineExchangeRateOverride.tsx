"use client";

import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { isBaht, toBaht } from "@/lib/acc/currency";
import { fmtMoneyTh, fmtRateTh } from "@/lib/acc/currency-display";
import { sanitizeOverrideRate } from "@/lib/acc/rate-override-policy";
import { allDayItems, normalizeTravelDay } from "@/features/accounting/lib/travel-sections";
import { TRAVEL_ITEM_TYPE_LABEL_TH } from "@/features/accounting/constants";
import type { AccRequest, TravelExpenseDetail } from "@/features/accounting/types";

/**
 * Accounting's correction to an AP-1 claim's exchange rates, **one expense line
 * at a time**, at the ACCOUNT step.
 *
 * **Why per line.** Migration 129 moved AP-1's currency from the request onto
 * the expense line, and nothing on AP-1's write path records a header currency
 * any more — so `ExchangeRateOverride`, which reads those header columns, never
 * renders for a claim filed since. This is the same correction rebuilt where the
 * money now lives. That component is **not** replaced: AP-17's booking desk
 * records one currency for a whole booking, and AP-1 claims filed during
 * migration 125's design still carry a header currency only it can reach. Both
 * panels can appear on the same drawer, and on a modern AP-1 claim only this one
 * does.
 *
 * **Nothing here is captioned as a Bank of Thailand rate.** `BOT_API_CLIENT_ID`
 * is deliberately unprovisioned (spec §9.1), so every rate this application
 * records comes from `bot-fx`'s keyless ECB fallback — a mid-market reference
 * figure, which is not what a bank settles at. `อัตราอ้างอิง`, with the sentence
 * saying so, because this is the screen accounting signs off against.
 *
 * Renders **nothing at all** unless the claim is at the ACCOUNT step and has at
 * least one line that is not in baht, so an ordinary Thai claim is untouched —
 * the rule the whole currency feature is held to. The gate is repeated on the
 * server: the route checks the object ACL, account-area membership and interface
 * scope, and both UPDATEs carry the step in their own predicates, because a
 * control absent from a page is not a control the server has.
 */

export interface LineRateSaved {
  requestId: number;
  itemId: number;
  rate: number;
  /** The line's new baht. */
  amount: number;
  /** The claim's new baht total, recomputed from every line. */
  totalAmount: number;
}

/** One correctable line, flattened out of the day/section tree. */
interface ForeignLine {
  itemId: number;
  /** `1` when the claim has one day; the day number otherwise. */
  dayNo: number;
  label: string;
  currency: string;
  rate: number | null;
  foreignAmount: number;
  amount: number;
}

/**
 * Every line of the claim that a rate applies to, in the order they are read.
 *
 * A line qualifies on the two columns the correction actually needs — a foreign
 * `Currency` and a `ForeignAmount` to convert — which is the same pair
 * `planLineRateOverride` refuses without. A line failing either is not offered a
 * field that could only produce a refusal.
 */
export function foreignLinesOf(days: TravelExpenseDetail[] | null | undefined): ForeignLine[] {
  const out: ForeignLine[] = [];
  const list = days ?? [];
  for (let di = 0; di < list.length; di++) {
    const day = normalizeTravelDay(list[di]);
    for (const it of allDayItems(day)) {
      if (it.id == null) continue;
      if (isBaht(it.currency) || it.foreignAmount == null) continue;
      out.push({
        itemId: it.id,
        dayNo: di + 1,
        label: TRAVEL_ITEM_TYPE_LABEL_TH[it.itemType] ?? it.itemType,
        currency: (it.currency ?? "").trim().toUpperCase(),
        rate: it.exchangeRate ?? null,
        foreignAmount: Number(it.foreignAmount) || 0,
        amount: Number(it.amount) || 0,
      });
    }
  }
  return out;
}

export function LineExchangeRateOverride({
  request,
  onSaved,
}: {
  request: AccRequest;
  onSaved: (saved: LineRateSaved) => void;
}) {
  const atAccountStep =
    request.status === "ManagerApproved" && request.currentStepCode === "ACCOUNT";
  const lines = useMemo(() => foreignLinesOf(request.travelDays), [request.travelDays]);

  if (!atAccountStep || lines.length === 0) return null;

  return (
    <div
      className="rounded-2xl p-3.5 mb-4 flex flex-col gap-2.5"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex items-center gap-2">
        <Coins size={15} strokeWidth={2.25} style={{ color: "var(--text-info-yellow)" }} />
        <p className="text-[12.5px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
          อัตราแลกเปลี่ยนรายรายการ — อัตราอ้างอิง
        </p>
      </div>

      <p className="text-[11.5px] m-0 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
        อัตราที่บันทึกไว้เป็น<strong>อัตราอ้างอิงกลางตลาด</strong> ไม่ใช่อัตราที่ธนาคารใช้จ่ายจริง
        ฝ่ายบัญชีแก้ให้ตรงกับอัตราที่จ่ายจริงได้ที่นี่ ก่อนอนุมัติ —
        แก้ทีละรายการ และยอดรวมของคำขอจะคำนวณใหม่จากทุกรายการ
      </p>

      <div className="flex flex-col gap-2">
        {lines.map((line) => (
          <LineRow
            key={line.itemId}
            line={line}
            multiDay={(request.travelDays?.length ?? 0) > 1}
            endpoint={`/api/request/accounting/requests/${request.id}/items/${line.itemId}/exchange-rate`}
            onSaved={onSaved}
          />
        ))}
      </div>
    </div>
  );
}

function LineRow({
  line,
  multiDay,
  endpoint,
  onSaved,
}: {
  line: ForeignLine;
  multiDay: boolean;
  endpoint: string;
  onSaved: (saved: LineRateSaved) => void;
}) {
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed whenever the stored rate changes — including after a save, so the
  // field shows what the database took rather than what was typed at it.
  useEffect(() => {
    setDraft(line.rate === null ? "" : String(line.rate));
  }, [line.rate]);

  const parsed = useMemo(() => sanitizeOverrideRate(draft), [draft]);
  // The same conversion the server will do, shown before it is asked for. Null
  // rather than a guess when the rate is not usable — `toBaht`'s own rule.
  const preview = useMemo(
    () => (parsed === null ? null : toBaht(line.foreignAmount, parsed)),
    [parsed, line.foreignAmount],
  );
  const unchanged = parsed !== null && line.rate !== null && parsed === line.rate;

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
      const data = json.data as LineRateSaved;
      toast.success(`บันทึกอัตราแล้ว — ยอดรวมใหม่ ${fmtMoneyTh(data.totalAmount)} บาท`);
      onSaved(data);
    } catch {
      toast.error("แก้อัตราแลกเปลี่ยนไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-xl px-3 py-2.5 flex flex-col gap-1.5"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {multiDay ? `วันที่ ${line.dayNo} · ${line.label}` : line.label}
        </span>
        <span className="text-[11.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {fmtMoneyTh(line.foreignAmount)} {line.currency} → {fmtMoneyTh(line.amount)} บาท
        </span>
      </div>

      <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
        อัตราที่บันทึกไว้:{" "}
        <strong style={{ color: "var(--text-primary)" }}>
          {line.rate === null ? "—" : `1 ${line.currency} = ${fmtRateTh(line.rate)} บาท`}
        </strong>
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          1 {line.currency} =
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`อัตราแลกเปลี่ยน 1 ${line.currency} เป็นบาท (${line.label})`}
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

      {draft.trim() !== "" && parsed === null ? (
        <p className="text-[11.5px] m-0" style={{ color: "var(--color-danger)" }}>
          อัตราไม่ถูกต้อง — ต้องเป็นตัวเลขมากกว่า 0
        </p>
      ) : (
        preview !== null &&
        preview !== line.amount && (
          <p className="text-[11.5px] m-0" style={{ color: "var(--text-muted)" }}>
            ยอดรายการใหม่ {fmtMoneyTh(preview)} บาท
          </p>
        )
      )}
    </div>
  );
}
