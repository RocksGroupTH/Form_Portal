import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { filterGrantableReimburseTabKeys } from "@/lib/acc/reimburse/settings-tabs";

/**
 * Per-person AP-4 settings-tab grants, stored in `AccReimburseAccessTab`
 * (migration 106) against `AccReimburseAccess.Id`.
 *
 * The AP-4 counterpart of `@/lib/acc/travel-booking/booking-approver-tabs`, and
 * deliberately the same shape — the rules for reading and replacing grants
 * should not differ between forms. What differs is what they hang off: AP-17
 * uses its approver roster, AP-4 uses `AccReimburseAccess`, a roster that
 * exists precisely so a settings grant is not also an approval right. See
 * `./settings-tabs`.
 *
 * A shared master table, so every write goes through `writeBothPools` and the
 * pair is asserted by `npm run check:alignment`.
 *
 * The rows ARE the granted set: no rows means no grants, never "all".
 */
export async function loadReimburseTabsByAccessIds(
  accessIds: number[],
): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (accessIds.length === 0) return map;

  const byAccess = new Map<number, string[]>();
  try {
    const pool = await getAccPool();
    const placeholders = accessIds.map((_, i) => `@id${i}`).join(", ");
    const req = pool.request();
    accessIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
    const r = await req.query(`
      SELECT AccessId, TabKey FROM [dbo].[AccReimburseAccessTab]
      WHERE AccessId IN (${placeholders}) ORDER BY TabKey
    `);
    for (const row of r.recordset as { AccessId: number; TabKey: string }[]) {
      const list = byAccess.get(row.AccessId) ?? [];
      list.push(row.TabKey);
      byAccess.set(row.AccessId, list);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A MISSING TABLE degrades to no grants — never to all. That decides
    // whether a non-admin sees the AP-4 settings page at all, so a permissive
    // default would open it to everyone on the roster for as long as the schema
    // is behind. 106 has to reach both databases, and this is the window before
    // it has.
    //
    // ANY OTHER FAILURE rethrows, and the narrowness is the point. This read
    // feeds two callers that want opposite things from an unreadable list. The
    // access endpoint wants an answer and treats a missing one as "no grants".
    // The admin's EDITING grid cannot: there, an empty result is
    // indistinguishable from "this person has no grants", so the admin's next
    // tick POSTs a one-element set — and `setReimburseAccessTabs` replaces
    // rather than merges, silently deleting the rest in BOTH databases.
    // Rethrowing turns it into the panel's error state instead.
    //
    // Both halves must hold: the missing-object error, about this object. ORing
    // them would let any error merely *naming* the table — permission denied, a
    // deadlock, a timeout — degrade to no grants, which is the silent-revoke
    // path this catch exists to close. Matches AP-1's and AP-17's.
    if (msg.includes("Invalid object name") && msg.includes("AccReimburseAccessTab")) {
      console.error("[reimburse-access-tabs] table unavailable — treating as no grants", err);
      byAccess.clear();
    } else {
      throw err;
    }
  }

  for (const id of accessIds) {
    map.set(id, filterGrantableReimburseTabKeys(byAccess.get(id) ?? []));
  }
  return map;
}

export async function getReimburseAccessTabs(accessId: number): Promise<string[]> {
  const map = await loadReimburseTabsByAccessIds([accessId]);
  return map.get(accessId) ?? [];
}

/**
 * Replace one person's granted tabs. The list IS the granted set — `[]` clears
 * it.
 *
 * Delete and insert happen inside one `writeBothPools` callback, so a partial
 * grant set cannot commit: either both databases end up with the whole new set
 * or neither moves.
 */
export async function setReimburseAccessTabs(
  accessId: number,
  keys: string[],
): Promise<void> {
  const wanted = filterGrantableReimburseTabKeys(keys);
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("aid", sql.Int, accessId)
      .query(`DELETE FROM [dbo].[AccReimburseAccessTab] WHERE AccessId = @aid`);
    for (const key of wanted) {
      await tx
        .request()
        .input("aid", sql.Int, accessId)
        .input("key", sql.NVarChar(40), key)
        .query(
          `INSERT INTO [dbo].[AccReimburseAccessTab] (AccessId, TabKey) VALUES (@aid, @key)`,
        );
    }
  });
}

/**
 * Tabs this email may open; `[]` when they are not an **active**
 * `AccReimburseAccess` row.
 *
 * Deactivating someone revokes their tabs without touching a single grant row,
 * so reactivating restores exactly what they had. The `IsActive = 1` test is
 * what makes that true — do not move it into the caller.
 */
export async function resolveReimburseTabsByEmail(
  email: string | null | undefined,
): Promise<string[]> {
  if (!email) return [];
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT Id FROM [dbo].[AccReimburseAccess] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  const accessId = r.recordset[0]?.Id as number | undefined;
  if (!accessId) return [];
  return getReimburseAccessTabs(accessId);
}
