"use client";

import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";

/**
 * **PRO / UAT — which Business Central half of the per-brand Interface ERP
 * settings is on screen.**
 *
 * One control, rendered by all four forms' Interface ERP tabs and shaped like
 * the one Settings → Brand Configuration already carries for Config BC, so the
 * same question does not get two different answers in two different visual
 * languages. `brand-config/page.tsx` keeps its own copy deliberately: it
 * switches between two halves of a FORM's fields rather than between two sets
 * of rows, and its state is a `"PRO" | "UAT"` string of its own.
 *
 * ## The label and the value are different vocabularies, on purpose
 *
 * The screen says **UAT**, because that is what everybody here calls the test
 * environment and what the navbar switch says. The column holds **Sandbox**,
 * because that is what Business Central calls it and what
 * `resolveEffectiveErpEnvironment()` answers. Translating in one place stops
 * `?environment=UAT` ever being sent — which the routes refuse with a 400
 * rather than quietly answering the Production half, but a refusal the user
 * sees is still a bug.
 *
 * ## It is a filter, never a permission
 *
 * Switching it changes which rows are read and written; it grants nothing. The
 * gate is `requireSettingsTab` / `requireAdvClrSettingsTab` /
 * `requireReimburseSettingsTab` on each route, unchanged, and a viewer who may
 * edit Production's configuration may edit Sandbox's — they are two halves of
 * one setting, and nobody has asked for them to be separately grantable.
 */
export const ERP_ENVIRONMENTS: { value: ErpBcEnvironment; label: string }[] = [
  { value: "Production", label: "PRO" },
  { value: "Sandbox", label: "UAT" },
];

export function ErpEnvironmentToggle({
  value,
  onChange,
  disabled,
}: {
  value: ErpBcEnvironment;
  onChange: (next: ErpBcEnvironment) => void;
  /** While a save is in flight — switching halves mid-write is a lost edit. */
  disabled?: boolean;
}) {
  return (
    <div
      className="inline-flex gap-1 p-1 rounded-xl"
      style={{ background: "var(--bg-badge)" }}
      role="group"
      aria-label="Interface ERP environment"
    >
      {ERP_ENVIRONMENTS.map((e) => {
        const active = value === e.value;
        return (
          <button
            key={e.value}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(e.value)}
            className="px-4 py-1.5 rounded-lg text-[11px] font-bold border-none transition-colors"
            style={{
              /* The SOLID action colour, not `--btn-primary-bg` — that token is
                 a 14% wash against the card, which reads as barely selected.
                 A segmented control has to say which segment is live. White is
                 safe on it in both themes: `--color-action` is single-valued by
                 design, and only the washes built from it move. */
              background: active ? "var(--color-action)" : "transparent",
              color: active ? "#fff" : "var(--text-muted)",
              boxShadow: active ? "var(--shadow-card)" : "none",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.6 : 1,
            }}
          >
            {e.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The line that sits beside the toggle when UAT is showing.
 *
 * It exists because the UAT half starts **empty on every brand** — migration
 * 161 classified every existing row as Production and copied nothing across,
 * deliberately: a guessed batch name is one that may not exist in the test
 * company, which is the failure the split was made to prevent. Without this,
 * the first admin to press UAT sees a screen of blank fields and reasonably
 * concludes the page is broken.
 */
export function ErpEnvironmentNote({ value }: { value: ErpBcEnvironment }) {
  if (value !== "Sandbox") return null;
  return (
    <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
      กำลังแก้ไขค่าของ <b>UAT (Sandbox)</b> — เป็นคนละชุดกับ PRO
      และเริ่มต้นยังไม่มีข้อมูล ต้องตั้งค่าใหม่ให้ครบ
      เพราะชื่อ Batch / เลขบัญชี / Branch ของบริษัททดสอบอาจไม่ตรงกับของจริง
    </p>
  );
}
