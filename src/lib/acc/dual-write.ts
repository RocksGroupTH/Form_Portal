import type { Transaction } from "mssql";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";

/**
 * Run the same mutation against the production and UAT form databases.
 *
 * The 21 shared configuration tables exist in both, and per-form routing means
 * AP-1 may read one copy while AP-17 reads the other. A setting saved to only
 * one database shows up later as an approver who exists for one form and not
 * the other, so both commit or neither does.
 *
 * The callback receives a transaction rather than a pool, and runs verbatim
 * against each database. Identical statements are what keeps the two copies
 * aligned:
 *
 *   - Every mutation here is keyed on a natural key (Email, SettingKey,
 *     FormCode+BrandCode, StaffId) or on an id that already exists in both, so
 *     running it twice produces the same row in each database.
 *   - The two databases were seeded from the same source with identity values
 *     preserved and receive exactly the same inserts from here on, so their
 *     identity counters stay in lockstep and a new row is assigned the same id
 *     in both.
 *
 * There is exactly one deliberate exception to the first bullet, and it is not
 * dead code: `upsertVehicle` (src/lib/acc/travel-booking/settings-service.ts)
 * captures `OUTPUT INSERTED.Id` on the production pass and replays it on the
 * UAT pass under `SET IDENTITY_INSERT`, because AccTravelVehiclePlace holds a
 * foreign key to that id and the child rows are written on both passes. It is
 * the only IDENTITY_INSERT in src/. Everything else, new AccReimburseRule rows
 * included, relies on the counters alone.
 *
 * That lockstep is an invariant, not a guarantee, and breaking it needs no
 * manual SQL: identity allocation is not transactional, so a production INSERT
 * that succeeds followed by a UAT one that throws rolls both rows back while
 * leaving production's counter advanced and UAT's not — every later id then
 * differs by one, permanently and silently. `npm run check:alignment`
 * (scripts/checks/verify-master-alignment.ts) compares ids along with the
 * business columns and is what detects it; run it after any failure here, not
 * only when approvers or vehicles look different between forms.
 */
export async function writeBothPools<T>(
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const [prod, uat] = await Promise.all([
    getProductionFormPool(),
    getUatFormPool(),
  ]);

  const prodTx = prod.transaction();
  const uatTx = uat.transaction();

  await prodTx.begin();
  try {
    await uatTx.begin();
  } catch (e) {
    await prodTx.rollback().catch(() => {});
    throw e;
  }

  let result: T;
  try {
    result = await fn(prodTx);
    await fn(uatTx);
  } catch (e) {
    await prodTx.rollback().catch(() => {});
    await uatTx.rollback().catch(() => {});
    throw e;
  }

  // Commit UAT first: if it fails, production is still open and rolls back, so
  // the pair stays consistent. The reverse order can leave production committed
  // with no way back.
  try {
    await uatTx.commit();
  } catch (e) {
    await prodTx.rollback().catch(() => {});
    throw e;
  }

  try {
    await prodTx.commit();
  } catch (e) {
    // UAT is already committed and cannot be undone. Surface loudly rather than
    // let the databases drift unnoticed.
    console.error(
      "[dual-write] production commit failed after UAT committed — run npm run check:alignment",
      e,
    );
    throw e;
  }

  return result;
}
