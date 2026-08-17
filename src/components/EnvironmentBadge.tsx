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

/**
 * For a page that reads both databases and merges them — My Requests and My
 * Work, which are about a person rather than a set of books. Naming one
 * environment there would be false, so it says both, and the rows carry their
 * own UAT mark.
 */
export function BothEnvironmentsChip() {
  return (
    <span
      className="text-[9.5px] font-extrabold px-1.5 py-0.5 shrink-0"
      style={{
        borderRadius: 6,
        background: "var(--bg-badge)",
        color: "var(--text-muted)",
      }}
      title="หน้านี้รวมข้อมูลจากทั้ง Production และ UAT — แถวที่มาจาก UAT มีป้ายกำกับไว้"
    >
      PRO + UAT
    </span>
  );
}
