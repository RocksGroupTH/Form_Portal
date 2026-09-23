"use client";

import { useViewerUat } from "@/lib/hooks/useFormEnvironments";

/**
 * **Read-only: which Business Central half the Interface ERP tab in front of
 * you is configuring.**
 *
 * There is deliberately **no switch here**. The user ruled on it 2026-09-24,
 * after a PRO/UAT segmented control had been built into all four of these
 * tabs: *"UAT หรือ PRO ไม่ต้องเปลี่ยนตรงนี้ เพราะเปลี่ยนจากด้านบน navbar
 * อยู่แล้ว"*. One switch for the whole app, in the navbar, and every screen
 * follows it — which is also the rule `erp-environment.ts` already states for
 * Business Central generally: *two switches sharing the word "UAT" is how a
 * test request ends up in the real ERP*. A second control on this page would
 * have been exactly that second switch.
 *
 * So this renders a sentence, not a choice. The server decides, from
 * `resolveSettingsErpEnvironment()`, which reads the same navbar mode.
 *
 * ## Why say anything at all
 *
 * Because the two halves look identical and hold different rows. Migration 161
 * classified every existing row as Production and copied **nothing** into
 * Sandbox — a guessed batch name is one that may not exist in the test company,
 * which is the whole failure the split was made to prevent. So in UAT the cards
 * open blank, and without a line saying why, the first admin to look concludes
 * the page is broken. In PRO it says nothing: that is the ordinary case and the
 * navbar already shows it.
 *
 * **It is withheld while the payload is loading and after a failed fetch**,
 * never rendered as "you are in PRO" on a guess — the rule AP-4's commissioning
 * banners already follow, for the same reason: not-measured-yet must not render
 * as a measurement. `useViewerUat()` is `/api/form-environment`'s own answer,
 * which re-checks an active `UatTester` row beside the cookie.
 */
export function ErpEnvironmentNotice() {
  const viewer = useViewerUat();
  if (!viewer?.uatMode) return null;
  return (
    <p
      className="text-[11px] leading-relaxed m-0 mt-2 px-2.5 py-1.5 rounded-lg"
      style={{
        background: "var(--bg-badge)",
        color: "var(--text-muted)",
        border: "1px solid var(--border-card)",
      }}
    >
      กำลังตั้งค่าของ <b>UAT (Sandbox)</b> ตามสวิตช์ PRO/UAT ด้านบน —
      เป็นคนละชุดกับ PRO และเริ่มต้นยังไม่มีข้อมูล ต้องตั้งค่าใหม่ให้ครบ
      เพราะชื่อ Batch / เลขบัญชี / Branch ของบริษัททดสอบอาจไม่ตรงกับของจริง
    </p>
  );
}
