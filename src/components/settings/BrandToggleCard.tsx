"use client";

/**
 * One brand, as a card with a switch — the shape every form's แบรนด์ที่เบิกได้
 * tab now uses (user, 2026-09-14: "ปรับ แบรนด์ที่เบิกได้ ของทุก form เป็นเหมือน
 * ในรูป แต่จะต้องเรียงข้อมูลตามลำดับเดิม").
 *
 * It replaces a full-width `SettingOption` row per brand on AP-1, AP-17 and
 * AP-4 — where the markup was byte-identical, copied once and then twice — and
 * it is what AP-2 / AP-3's own tab was built as. A dozen brands read as a grid
 * of tiles rather than a column of bands.
 *
 * **Ordering is the caller's and is not touched.** The list each form passes is
 * its own — AP-4's `AccFormBrand` rows then the master's, AP-2/AP-3's from the
 * Interface ERP endpoint — and this component renders what it is given, in
 * order. That was the explicit condition on the change: same look, same
 * sequence.
 *
 * **Save semantics are the caller's too.** AP-2 / AP-3 write on the switch;
 * AP-1, AP-17 and AP-4 stage the change and write on their own Save button.
 * `status` is what says which state a staged card is in, so the card itself
 * needs to know neither.
 */
export function BrandToggleCard({
  brandCode,
  brandName,
  brandLogo,
  sub,
  checked,
  onChange,
  disabled,
  status = "default",
}: {
  brandCode: string;
  brandName: string;
  brandLogo?: string | null;
  /** Second line under the name. Defaults to the code alone. */
  sub?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** `pending` = changed and unsaved, `saved` = on and written. */
  status?: "default" | "saved" | "pending";
}) {
  const bg =
    status === "pending"
      ? "var(--bg-info-yellow)"
      : status === "saved" || (status === "default" && checked)
        ? "var(--bg-info-green)"
        : "var(--bg-card-alt)";
  const border =
    status === "pending"
      ? "var(--border-info-yellow)"
      : status === "saved" || (status === "default" && checked)
        ? "var(--border-info-green)"
        : "var(--border-card)";

  return (
    <div
      className="rounded-xl p-3 flex items-center gap-3"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div
        className="flex items-center justify-center shrink-0 rounded-lg p-1.5"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-light)" }}
      >
        {brandLogo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brandLogo}
            alt=""
            className="h-6 w-auto object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          // A brand the master does not know renders with its own first
          // letters rather than an empty tile — AP-4 ships exactly one of
          // those (`ROCKS`), so this is the default state on a fresh
          // deployment, not an edge.
          <span className="text-[10px] font-mono px-1" style={{ color: "var(--text-faint)" }}>
            {brandCode.slice(0, 2)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold m-0 truncate" style={{ color: "var(--text-heading)" }}>
          {brandName}
        </p>
        <p className="text-[10px] m-0 font-mono truncate" style={{ color: "var(--text-muted)" }}>
          {sub ?? brandCode}
        </p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${checked ? "ปิด" : "เปิด"} ${brandName}`}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className="relative rounded-full shrink-0 transition-colors"
        style={{
          width: 38,
          height: 22,
          background: checked ? "var(--color-action)" : "var(--border-input)",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span
          className="absolute rounded-full transition-all"
          style={{
            width: 16,
            height: 16,
            top: 3,
            left: checked ? 19 : 3,
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,.35)",
          }}
        />
      </button>
    </div>
  );
}

/** The grid every brand tab lays its cards out in. */
export function BrandToggleGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}
