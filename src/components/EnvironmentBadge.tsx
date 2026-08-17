"use client";

import { useFormEnvironments, type FormEnvironment } from "@/lib/hooks/useFormEnvironments";

/**
 * Which database a form writes to, as a chip on the form's card.
 *
 * UAT is the one that has to be noticed — a request filed there is a test that
 * no one will pay, and its journals go to Business Central's sandbox — so it
 * gets the alert colours and Production stays quiet.
 */
export function EnvironmentBadge({
  environment,
  className = "",
}: {
  environment: FormEnvironment;
  className?: string;
}) {
  const uat = environment === "UAT";
  return (
    <span
      className={`text-[9.5px] font-extrabold px-1.5 py-0.5 shrink-0 ${className}`}
      style={{
        borderRadius: 6,
        background: uat ? "var(--status-bad-bg)" : "var(--bg-badge)",
        color: uat ? "var(--status-bad-text)" : "var(--text-muted)",
      }}
      title={
        uat
          ? "ฟอร์มนี้กำลังเขียนลงฐานข้อมูล UAT (ข้อมูลทดสอบ) และส่ง Business Central ไปที่ Sandbox"
          : "ฟอร์มนี้ใช้งานจริงบน Production"
      }
    >
      {uat ? "UAT" : "PRO"}
    </span>
  );
}

/**
 * The same chip, for a page that works with one form's data — it says which
 * database the rows on screen came from. Reads the flag itself so a page only
 * has to name its form.
 */
export function FormEnvironmentChip({ formCode }: { formCode: string }) {
  const environments = useFormEnvironments();
  return <EnvironmentBadge environment={environments[formCode] ?? "Production"} />;
}

/** The forms that can appear together in a merged list. */
const LIST_FORM_CODES = ["AP-1", "AP-17"] as const;

/**
 * For My Requests and My Work, which list more than one form.
 *
 * Those lists read both databases and then keep only the rows whose database
 * matches each form's current flag, so the honest label is per form. When the
 * forms agree it collapses to one chip — two identical chips say nothing.
 */
export function ListEnvironmentChips() {
  const environments = useFormEnvironments();
  const pairs = LIST_FORM_CODES.map(
    (code) => [code, environments[code] ?? "Production"] as const,
  );

  if (pairs.every(([, env]) => env === pairs[0][1])) {
    return <EnvironmentBadge environment={pairs[0][1]} />;
  }

  return (
    <span className="inline-flex items-center gap-1">
      {pairs.map(([code, env]) => {
        const uat = env === "UAT";
        return (
          <span
            key={code}
            className="text-[9.5px] font-extrabold px-1.5 py-0.5 shrink-0"
            style={{
              borderRadius: 6,
              background: uat ? "var(--status-bad-bg)" : "var(--bg-badge)",
              color: uat ? "var(--status-bad-text)" : "var(--text-muted)",
            }}
            title={
              uat
                ? `${code} อยู่บน UAT — รายการของฟอร์มนี้เป็นข้อมูลทดสอบ`
                : `${code} ใช้งานจริงบน Production`
            }
          >
            {code} {uat ? "UAT" : "PRO"}
          </span>
        );
      })}
    </span>
  );
}
