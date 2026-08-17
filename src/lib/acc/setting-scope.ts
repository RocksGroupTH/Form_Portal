/**
 * Which `AccSetting` keys are per-database and must never be dual-written.
 *
 * Standalone and import-free on purpose: `setSetting`
 * (`src/lib/acc/settings-service.ts`) and the alignment check
 * (`scripts/checks/verify-master-alignment.ts`) have to agree on this list, and
 * the check is a `tsx` script that resolves neither the `@/` alias nor
 * `.env.local` before it runs. One declaration, two relative imports, no side
 * effects.
 */

/**
 * Exact keys. `ERP_INTERFACE_ENV` is a leftover: nothing reads AccSetting's copy
 * any more — the BC environment comes from the form's Form Environment flag
 * (`src/lib/acc/erp-environment.ts`). The guard stays so a stale value cannot
 * start propagating between the two databases if something reads it again.
 */
const ENVIRONMENT_SPECIFIC_KEYS = new Set(["ERP_INTERFACE_ENV"]);

/**
 * Key **prefixes**, for families of per-person keys.
 *
 * `ap17.idcard.reuse.<staffId>` (`src/features/travel-booking/constants.ts`) is
 * a requester's standing consent to have their national-ID scan re-attached to
 * future AP-17 bookings. It is operational state about one human being, not
 * shared configuration, and it happens to live in a dual-written table. Before
 * this exclusion, a tester in UAT toggling that switch flipped the identical
 * flag in `Rocks_Portal_Form`, changing what a **real** booking would attach.
 * A test action must not mutate production data, so it writes only to the pool
 * the actor is actually working in.
 */
const ENVIRONMENT_SPECIFIC_KEY_PREFIXES = ["ap17.idcard.reuse."];

/**
 * Whether an `AccSetting` key belongs to one database only.
 *
 * Both the writer and the alignment check ask this, so a key can never be
 * excluded from dual-write and then reported as drift, or the reverse.
 */
export function isEnvironmentSpecificSettingKey(key: string): boolean {
  if (ENVIRONMENT_SPECIFIC_KEYS.has(key)) return true;
  for (const prefix of ENVIRONMENT_SPECIFIC_KEY_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}
