"use client";

import { useFormEnvironments, type FormEnvironment } from "@/lib/hooks/useFormEnvironments";
import { canSwitchEnvironment } from "@/lib/form-environment/viewer-controls";

/**
 * Which database a form writes to, as a chip on the form's card.
 *
 * UAT is the one that has to be noticed — a request filed there is a test that
 * no one will pay, and its journals go to Business Central's sandbox — so it is
 * tinted and Production stays quiet.
 *
 * `--status-uat-*`, the amber the navbar chip and the Form Environment switches
 * use. It was `--status-bad-*` — the red this app reserves for something having
 * gone wrong — which made a form correctly open for testing read as a fault.
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
        background: uat ? "var(--status-uat-bg)" : "var(--bg-badge)",
        color: uat ? "var(--status-uat-text)" : "var(--text-muted)",
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
 *
 * Renders nothing while the shared payload is still loading, failed to load,
 * or has no entry for this code — guessing "Production" here is exactly the
 * failure this component exists to avoid: a tester would see their UAT
 * request labelled as if it were live.
 *
 * It also renders nothing for a viewer who has no PRO/UAT switch in the navbar.
 * `pickEnvironment` only ever answers UAT for a viewer in UAT mode, so for
 * everybody else this chip is a permanent "PRO" on every card — a label with
 * nothing to contrast against, next to no control that could change it. The two
 * decisions share `canSwitchEnvironment` so a chip can never outlive its switch.
 */
export function FormEnvironmentChip({
  formCode,
  className = "",
}: {
  formCode: string;
  className?: string;
}) {
  const { data, error } = useFormEnvironments();
  const access = data?.forms[formCode];
  if (error || !access) return null;
  if (!canSwitchEnvironment(data?.viewer)) return null;
  return <EnvironmentBadge environment={access.environment} className={className} />;
}

/**
 * The viewer's own UAT marker, for a page that lists rows from more than one
 * form (My Requests, My Work). Replaces the old `ListEnvironmentChips`: under
 * per-viewer routing a form's chip is never honestly "PRO + UAT" at once — it
 * is whichever one database this viewer's own actions land in right now. So
 * there is exactly one thing worth saying here, and only when it's true.
 */
export function ViewerUatBadge() {
  const { data, error } = useFormEnvironments();
  if (error || !data?.viewer.uatMode) return null;
  return <EnvironmentBadge environment="UAT" />;
}
