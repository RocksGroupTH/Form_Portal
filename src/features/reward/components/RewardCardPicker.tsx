"use client";

import { Check, Gift, PackageX } from "lucide-react";
import type { RewardOption } from "@/features/reward/types";

/**
 * The reward catalogue as selectable cards (brief §3).
 *
 * A card is the right shape here because three facts have to be weighed at once
 * — what it is, what it is worth, and how many are left — and a table row makes
 * the reader scan sideways for each. The balance is the loudest number on the
 * card because it is the one that decides whether the card is usable at all.
 *
 * Cards with no stock are rendered, not hidden: "ของหมด" answers the question a
 * missing card leaves open.
 */

function money(v: number | null): string {
  if (v == null) return "—";
  return v.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function RewardCardPicker({
  rewards,
  selectedId,
  onSelect,
  disabled = false,
}: {
  rewards: RewardOption[];
  selectedId: number | null;
  onSelect: (reward: RewardOption) => void;
  disabled?: boolean;
}) {
  if (rewards.length === 0) {
    return (
      <div
        className="rounded-xl px-4 py-8 text-center"
        style={{ background: "var(--bg-subtle)", color: "var(--text-muted)" }}
      >
        <PackageX size={22} style={{ margin: "0 auto 8px" }} />
        <p className="text-[13px] font-semibold">ยังไม่มีของรางวัลให้เบิกในบริษัทนี้</p>
        <p className="text-[11.5px] mt-1">ติดต่อทีม Assist AP เพื่อเพิ่มของรางวัล</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
      {rewards.map((r) => {
        const selected = r.id === selectedId;
        const soldOut = r.balanceQty <= 0;
        const clickable = !disabled && !soldOut;

        return (
          <button
            key={r.id}
            type="button"
            disabled={!clickable}
            onClick={() => onSelect(r)}
            aria-pressed={selected}
            className="text-left rounded-[14px] p-3.5 transition-all relative disabled:cursor-not-allowed"
            style={{
              background: selected ? "var(--nav-active-bg)" : "var(--bg-card)",
              border: `1.5px solid ${selected ? "var(--action)" : "var(--border-card)"}`,
              boxShadow: selected ? "none" : "var(--shadow-card)",
              opacity: soldOut ? 0.55 : 1,
              cursor: clickable ? "pointer" : "not-allowed",
            }}
          >
            {selected && (
              <span
                className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: "var(--action)", color: "#fff" }}
              >
                <Check size={12} strokeWidth={3} />
              </span>
            )}

            <div className="flex items-start gap-2.5">
              <span
                className="w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                <Gift size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className="text-[13.5px] font-bold leading-tight truncate"
                  style={{ color: "var(--text-primary)" }}
                  title={r.name}
                >
                  {r.name}
                </p>
                <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {r.code}
                </p>
              </div>
            </div>

            <div className="flex items-end justify-between gap-2 mt-3">
              <div>
                <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                  คงเหลือ
                </p>
                <p
                  className="text-[19px] font-extrabold leading-none mt-0.5"
                  style={{ color: soldOut ? "var(--text-danger)" : "var(--text-primary)" }}
                >
                  {soldOut ? "ของหมด" : r.balanceQty}
                  {!soldOut && (
                    <span
                      className="text-[11px] font-semibold ml-1"
                      style={{ color: "var(--text-muted)" }}
                    >
                      ชิ้น
                    </span>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                  มูลค่า/ชิ้น
                </p>
                <p
                  className="text-[13px] font-bold leading-none mt-1"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {money(r.unitActualValue)}
                </p>
              </div>
            </div>

            {/* The lock is why the balance is lower than the raw count, so say
                so rather than leaving the requester to wonder. */}
            {r.lockedQty > 0 && !soldOut && (
              <p className="text-[10.5px] mt-2" style={{ color: "var(--text-muted)" }}>
                มี {r.lockedQty} ชิ้นถูกจองไว้ในคำขออื่น
              </p>
            )}
            {r.expireDate && (
              <p className="text-[10.5px] mt-1" style={{ color: "var(--text-muted)" }}>
                หมดอายุ {r.expireDate}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
