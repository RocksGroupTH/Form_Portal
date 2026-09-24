"use client";

import { useState } from "react";
import useSWR from "swr";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * "เจ้าของฟอร์ม" as one tick on a form's own สิทธิ์เข้าถึง grid.
 *
 * An owner is the person a requester is told to contact about a cancellation,
 * printed at the foot of that form — see `formOwnerNotice`. **Naming somebody
 * grants them nothing**, which is the property that makes this column safe to
 * sit beside brand scopes and tab grants that do grant things. Nothing in this
 * application reads `FormOwner` to decide anything, and a later change tempted
 * to is breaking the rule rather than extending it.
 *
 * ## Why it is here and not on Form Environment (the user, 2026-09-24)
 *
 * It was a column on Settings → Form Environment: a directory search, chips in
 * the cell, then a dialog. The instruction was to move it —
 * *"ย้ายมาที่ สิทธิ์เข้าถึง และเป็น check box ก่อนสถานะ … ไม่ต้องยุ่งกับหน้า
 * Form Environment ทุก form"* — so owners are set where that form's people are
 * already managed, and the old column is gone.
 *
 * **Two things were given up, deliberately, and they are not small:**
 *
 * - **An owner must already be on that form's roster.** The directory search
 *   is gone, so somebody who is not an approver of a form cannot be named as
 *   its owner. Add them to the roster first, or nothing here can name them.
 * - **AP-11 and AP-15 can have no owner at all.** Neither has a settings page,
 *   so neither has a grid for this column to live in. They print the bare
 *   contact sentence for ever. Both were owner-less anyway; what changed is
 *   that there is no longer anywhere to change that.
 *
 * ## Mechanics
 *
 * Every instance shares **one SWR key**, so a grid of twenty rows costs one
 * fetch rather than twenty, and a tick on one row re-renders the rest with the
 * new truth.
 *
 * The endpoint replaces a form's whole list, so a tick has to send every other
 * owner back with it. Writes are therefore **queued and each one re-reads the
 * server's current list before building its payload** — two quick ticks on two
 * rows would otherwise both compute from the list as it was before either, and
 * the second would silently drop the first. One extra GET per tick is nothing
 * at this volume, and it is the only thing that makes the whole-list write
 * safe against its own user.
 */

const KEY = "/api/settings/form-owners";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface OwnerRow {
  email: string;
  displayName?: string | null;
  staffId?: number | null;
}

type OwnerMap = Record<string, OwnerRow[]>;

/**
 * Serialises every write this module makes, across all rows and all forms.
 *
 * Module scope rather than component state on purpose: the race being closed
 * is *between* rows, and a per-row lock cannot see its neighbours.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

async function readOwners(): Promise<OwnerMap> {
  const res = await fetch(KEY);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "โหลดเจ้าของฟอร์มไม่สำเร็จ");
  return (json.data ?? {}) as OwnerMap;
}

export function FormOwnerCheckbox({
  formCode,
  email,
  displayName,
  staffId,
  disabled,
}: {
  formCode: string;
  email: string;
  displayName?: string | null;
  staffId?: number | null;
  /** The row is switched off, or something else on it is mid-write. */
  disabled?: boolean;
}) {
  const { data, mutate } = useSWR<{ ok: boolean; data?: OwnerMap }>(KEY, fetcher);
  const [saving, setSaving] = useState(false);

  const list = (data?.ok ? data.data?.[formCode] : undefined) ?? [];
  const lower = email.trim().toLowerCase();
  const checked = list.some((o) => o.email.toLowerCase() === lower);

  /* Unreadable is not unticked. A failed fetch must not render as "this person
     is not an owner", because the next tick would then POST a list that had
     already lost somebody. */
  const unreadable = data !== undefined && !data.ok;
  const locked = !!disabled || saving || unreadable;

  const toggle = () => {
    if (locked) return;
    setSaving(true);
    writeQueue = writeQueue
      .then(async () => {
        const fresh = await readOwners();
        const current = fresh[formCode] ?? [];
        const has = current.some((o) => o.email.toLowerCase() === lower);
        const next = has
          ? current.filter((o) => o.email.toLowerCase() !== lower)
          : [...current, { email, displayName: displayName ?? null, staffId: staffId ?? null }];

        const res = await fetch(KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formCode, owners: next }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error ?? "บันทึกไม่สำเร็จ");
        toast.success(
          has
            ? `${formCode} · เอาออกจากเจ้าของฟอร์มแล้ว`
            : `${formCode} · เพิ่มเป็นเจ้าของฟอร์มแล้ว`,
        );
        await mutate();
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : "บันทึกไม่สำเร็จ");
        /* Put the grid back on server truth — the tick may or may not have
           landed, and guessing which is how a checkbox starts lying. */
        void mutate();
      })
      .finally(() => setSaving(false));
  };

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-disabled={locked}
      aria-label={`${displayName || email} — เจ้าของฟอร์ม ${formCode}`}
      disabled={locked}
      onClick={toggle}
      title={
        unreadable
          ? "โหลดเจ้าของฟอร์มไม่สำเร็จ"
          : disabled
            ? "เปิดใช้งานก่อนจึงจะตั้งเป็นเจ้าของฟอร์มได้"
            : "เจ้าของฟอร์ม — แสดงท้ายฟอร์มให้ผู้ขอติดต่อ ไม่ได้รับสิทธิ์เพิ่มเติม"
      }
      className="w-[18px] h-[18px] rounded-[5px] flex items-center justify-center mx-auto border-none p-0 transition-all"
      style={{
        background: checked ? "var(--text-info-green)" : "var(--bg-card)",
        boxShadow: checked
          ? "0 0 0 2px color-mix(in srgb, var(--text-info-green) 28%, transparent)"
          : "inset 0 0 0 1.5px var(--border-card)",
        opacity: disabled || unreadable ? 0.5 : saving ? 0.6 : 1,
        cursor: locked ? "not-allowed" : "pointer",
      }}
    >
      {saving ? (
        <Loader2 size={10} className="animate-spin" style={{ color: "var(--text-muted)" }} />
      ) : checked ? (
        <Check size={11} strokeWidth={3} style={{ color: "var(--bg-card)" }} />
      ) : null}
    </button>
  );
}
