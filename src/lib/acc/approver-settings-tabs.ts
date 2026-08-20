import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { filterGrantableTabKeys } from "@/lib/acc/settings-tabs";

/**
 * Per-approver AP-1 settings-tab grants, stored in `AccApproverSettingsTab`.
 *
 * That table has existed in both form databases since migration 059 and is one
 * of the dual-written master tables — ACC Portal, which shares this database,
 * has been its only writer until now. No migration is needed here.
 *
 * The rows ARE the granted set: no rows means no grants, never "all".
 */
export async function loadSettingsTabsByApproverIds(
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
      SELECT ApproverId, TabKey FROM [dbo].[AccApproverSettingsTab]
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
    // whether a non-admin approver sees the settings page, so a permissive
    // default would open it to every approver the moment the schema is behind.
    //
    // ANY OTHER FAILURE rethrows, and the difference matters because this read
    // feeds two callers that want opposite things. `/access` wants an answer
    // and treats a missing one as "no grants". `listApprovers` feeds the
    // admin's EDITING grid, where an empty result is indistinguishable from
    // "this person has no grants" — so the admin's next tick would POST a
    // one-element set, and `setApproverSettingsTabs` replaces rather than
    // merges, silently deleting the rest in both databases. Rethrowing turns
    // that into the panel's error state. The fail-closed guarantee on
    // `/access` is provided independently by its own catch, which 500s, and
    // by the hook defaulting to no grants.
    //
    // Matches `loadInterfaceBrandsByApproverIds`, which is read beside this one,
    // except for the conjunction: that one ORs the two tests, so any error
    // merely *naming* the table — permission denied, a deadlock, a timeout —
    // also degrades to no grants, which is the silent-revoke path this catch was
    // narrowed to close. Both halves must hold: the missing-object error, about
    // this object.
    if (msg.includes("Invalid object name") && msg.includes("AccApproverSettingsTab")) {
      console.error("[approver-settings-tabs] table unavailable — treating as no grants", err);
      byApprover.clear();
    } else {
      throw err;
    }
  }

  for (const id of approverIds) {
    map.set(id, filterGrantableTabKeys(byApprover.get(id) ?? []));
  }
  return map;
}

export async function getApproverSettingsTabs(approverId: number): Promise<string[]> {
  const map = await loadSettingsTabsByApproverIds([approverId]);
  return map.get(approverId) ?? [];
}

/** Replace an approver's granted tabs. The list IS the granted set — [] clears it. */
export async function setApproverSettingsTabs(
  approverId: number,
  keys: string[],
): Promise<void> {
  const wanted = filterGrantableTabKeys(keys);
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("aid", sql.Int, approverId)
      .query(`DELETE FROM [dbo].[AccApproverSettingsTab] WHERE ApproverId = @aid`);
    for (const key of wanted) {
      await tx
        .request()
        .input("aid", sql.Int, approverId)
        .input("key", sql.NVarChar(40), key)
        .query(
          `INSERT INTO [dbo].[AccApproverSettingsTab] (ApproverId, TabKey) VALUES (@aid, @key)`,
        );
    }
  });
}

/** Tabs this email may open; [] when they are not an active approver. */
export async function resolveApproverSettingsTabsByEmail(
  email: string | null | undefined,
): Promise<string[]> {
  if (!email) return [];
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT Id FROM [dbo].[AccApprover] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  const approverId = r.recordset[0]?.Id as number | undefined;
  if (!approverId) return [];
  return getApproverSettingsTabs(approverId);
}
