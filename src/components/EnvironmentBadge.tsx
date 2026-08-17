import type { FormEnvironment } from "@/lib/hooks/useFormEnvironments";

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
