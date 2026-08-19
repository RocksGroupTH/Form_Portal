/**
 * Which AP-1 settings tabs an admin may hand to an individual approver.
 *
 * `approvers` — the สิทธิ์เข้าถึง tab itself — is deliberately absent. Granting
 * it would let a non-admin approver grant themselves the rest.
 *
 * This module imports nothing so it can be unit-tested: anything reachable from
 * a database pool drags `@/env` in, which validates the whole environment at
 * import time and throws in the test runner.
 */
export const GRANTABLE_SETTINGS_TABS: readonly { key: string; label: string }[] = [
  { key: "brands", label: "แบรนด์ที่เบิก" },
  { key: "sameDayBrand", label: "เบิกวันซ้ำข้ามแบรนด์" },
  { key: "vehicles", label: "พาหนะ & เรท" },
  { key: "departments", label: "แผนก (HR ↔ ERP)" },
  { key: "erpInterface", label: "Interface ERP" },
];

export function isGrantableSettingsTabKey(key: string): boolean {
  const k = key.trim();
  for (const t of GRANTABLE_SETTINGS_TABS) if (t.key === k) return true;
  return false;
}

/** Keep only known keys, trimmed, de-duplicated, in the caller's order. */
export function filterGrantableTabKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isGrantableSettingsTabKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}
