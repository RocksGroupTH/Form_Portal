import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { filterGrantableBookingTabKeys } from "@/lib/acc/travel-booking/settings-tabs";

/**
 * Per-approver AP-17 settings-tab grants, stored in `AccBookingApproverTab`
 * (migration 096) against `AccBookingApprover.Id`.
 *
 * The AP-17 counterpart of `@/lib/acc/approver-settings-tabs`, and deliberately
 * the same shape — AP-17's roster is its own (`AccBookingApprover`), so the two
 * grant sets never mix, but the rules for reading and replacing them should not
 * differ between the two forms.
 *
 * A shared master table, so every write goes through `writeBothPools` and the
 * pair is asserted by `npm run check:alignment`.
 *
 * The rows ARE the granted set: no rows means no grants, never "all".
 */
export async function loadBookingTabsByApproverIds(
  approverIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (approverIds.length === 0) return map;

  const byApprover = new Map<number, string[]>();
  try {
    const pool = await getAccPool();
    const placeholders = approverIds.map((_, i) => `@id${i}`).join(", ");
    const req = pool.request();
    approverIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
    const r = await req.query(`
      SELECT ApproverId, TabKey FROM [dbo].[AccBookingApproverTab]
      WHERE ApproverId IN (${placeholders}) ORDER BY TabKey
    `);
    for (const row of r.recordset as { ApproverId: number; TabKey: string }[]) {
      const list = byApprover.get(row.ApproverId) ?? [];
      list.push(row.TabKey);
      byApprover.set(row.ApproverId, list);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A MISSING TABLE degrades to no grants — never to all. That decides
    // whether a non-admin booking approver sees the travel-booking settings
    // page, so a permissive default would open it to every approver on the
    // roster for as long as the schema is behind. 096 has to reach both
    // databases, and this is the window before it has.
    //
    // ANY OTHER FAILURE rethrows, and the narrowness is the point. This read
    // feeds two callers that want opposite things from an unreadable list. The
    // access endpoint wants an answer and treats a missing one as "no grants".
    // The admin's EDITING grid cannot: there, an empty result is
    // indistinguishable from "this person has no grants", so the admin's next
    // tick POSTs a one-element set — and `setBookingApproverTabs` replaces
    // rather than merges, silently deleting the rest in BOTH databases. That is
    // exactly the data loss AP-1's original broad catch caused. Rethrowing
    // turns it into the panel's error state instead.
    //
    // Matches `loadSettingsTabsByApproverIds` in @/lib/acc/approver-settings-tabs.
    // Both halves must hold: the missing-object error, about this object. ORing
    // them would let any error merely *naming* the table — permission denied, a
    // deadlock, a timeout — degrade to no grants, which is the silent-revoke
    // path this catch exists to close.
    if (msg.includes("Invalid object name") && msg.includes("AccBookingApproverTab")) {
      console.error("[booking-approver-tabs] table unavailable — treating as no grants", err);
      byApprover.clear();
    } else {
      throw err;
    }
  }

  for (const id of approverIds) {
    map.set(id, filterGrantableBookingTabKeys(byApprover.get(id) ?? []));
  }
  return map;
}

export async function getBookingApproverTabs(approverId: number): Promise<string[]> {
  const map = await loadBookingTabsByApproverIds([approverId]);
  return map.get(approverId) ?? [];
}

/**
 * Replace a booking approver's granted tabs. The list IS the granted set — []
 * clears it.
 *
 * Delete and insert happen inside one `writeBothPools` callback, so a partial
 * grant set cannot commit: either both databases end up with the whole new set
 * or neither moves.
 */
export async function setBookingApproverTabs(
  approverId: number,
  keys: string[],
): Promise<void> {
  const wanted = filterGrantableBookingTabKeys(keys);
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("aid", sql.Int, approverId)
      .query(`DELETE FROM [dbo].[AccBookingApproverTab] WHERE ApproverId = @aid`);
    for (const key of wanted) {
      await tx
        .request()
        .input("aid", sql.Int, approverId)
        .input("key", sql.NVarChar(40), key)
        .query(
          `INSERT INTO [dbo].[AccBookingApproverTab] (ApproverId, TabKey) VALUES (@aid, @key)`,
        );
    }
  });
}

/**
 * Tabs this email may open; [] when they are not an **active**
 * `AccBookingApprover`.
 *
 * Deactivating someone revokes their tabs without touching a single grant row,
 * so reactivating restores exactly what they had. The `IsActive = 1` test is
 * what makes that true — do not move it into the caller.
 */
export async function resolveBookingTabsByEmail(
  email: string | null | undefined,
): Promise<string[]> {
  if (!email) return [];
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT Id FROM [dbo].[AccBookingApprover] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  const approverId = r.recordset[0]?.Id as number | undefined;
  if (!approverId) return [];
  return getBookingApproverTabs(approverId);
}
