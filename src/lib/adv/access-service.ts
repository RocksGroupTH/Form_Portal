import { getAccPool, sql } from "@/lib/adv/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import {
  filterAdvClrKeysForForm,
  filterStorableAdvClrKeys,
  storableAdvClrKeysForForm,
  type AdvClrForm,
} from "@/lib/adv/settings-tabs";

/**
 * AP-2 and AP-3's shared access list (migration 152), and the per-tab and
 * per-menu grants over it.
 *
 * **One roster for two forms**, which is why the table is `AccAdvClrAccess` and
 * not `AccAdvanceAccess`: it carries no `FormCode`, and a tick says whether
 * somebody may open a screen of AP-2 *or* of AP-3. That follows what these two
 * already do with brands — `setBrandActiveShared` writes `AccFormBrand` for
 * both codes in one transaction — and it is the user's decision (2026-09-14).
 * The *keys* still name their form; see `./settings-tabs`.
 *
 * **Each form is GRANTED on its own screen since 2026-09-22** (user:
 * *"สิทธิ์เข้าถึง AP-2 จะใช้แค่ AP-2 เท่านั้น..."*), and the roster did not split
 * with it — one person, one row, no `FormCode`, no migration. What became
 * form-scoped is the grid and, load-bearingly, the **write**:
 * `setAdvClrAccessTabs` takes the form and replaces only its keys. Read its
 * docblock before touching that statement.
 *
 * **Deliberately not the approver rosters.** `AccAdvanceApprover` and
 * `AccClearAdvanceApprover` are the pools that take real approval steps, so a
 * row on either approves money; hanging grants there would make "may edit the
 * approval matrix" and "may approve a payment" the same tick. This list grants
 * **sight only** — of a settings tab, or of a working screen. It never grants
 * authority to act: that stays with the approver rosters, re-decided where the
 * money moves. Membership alone grants nothing either — the ticks do, which is
 * what makes an empty table a neutral state.
 *
 * A shared master table, so every write goes through `writeBothPools` and the
 * pair is asserted by `npm run check:alignment` (28 → 30).
 */
export interface AdvClrAccessRow {
  id: number;
  staffId: number;
  email: string;
  displayName: string;
  isActive: boolean;
  /**
   * Everything this person holds in `AccAdvClrAccessTab` — **both
   * vocabularies**, because `loadAdvClrTabsByAccessIds` narrows with the union
   * filter `filterStorableAdvClrKeys`. That stayed deliberately wide when the
   * screens split: each form's grid narrows this list to its own keys for
   * rendering, and each authorization surface re-narrows it with its own
   * filter, but the row itself must keep carrying both — a save posts back what
   * it was given, and a read that had already dropped the other form's keys
   * would make every save a silent revocation of them.
   *
   * `[]` means none — the rows ARE the granted set, never "all". An admin's own
   * grants do not come from here; they see every tab and every menu.
   */
  settingsTabs: string[];
}

/**
 * Per-person grants, read in one batch for the whole page.
 *
 * A **missing table** degrades to no grants — never to all. That decides
 * whether a non-admin sees an AP-2 / AP-3 settings tab at all, so a permissive
 * default would open it to everybody for as long as 152 is behind on either
 * database.
 *
 * **Any other failure rethrows, and the narrowness is the point.** This read
 * feeds two callers that want opposite things from an unreadable list. The
 * access endpoint wants an answer and treats a missing one as "no grants". The
 * admin's EDITING grid cannot: there an empty result is indistinguishable from
 * "this person has no grants", so the admin's next tick POSTs a one-element set
 * — and `setAdvClrAccessTabs` replaces rather than merges, silently deleting
 * the rest of **that form's** keys in BOTH databases. (The form scope added on
 * 2026-09-22 bounds the blast radius to one form; it does not remove it, and
 * the other form's keys are equally at risk from its own screen.)
 * Rethrowing turns it into the panel's error state
 * instead. Both halves of the test must hold: the missing-object error, about
 * this object; ORing them would let a permission error, a deadlock or a timeout
 * merely *naming* the table degrade to no grants.
 */
export async function loadAdvClrTabsByAccessIds(
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
      SELECT AccessId, TabKey FROM [dbo].[AccAdvClrAccessTab]
      WHERE AccessId IN (${placeholders}) ORDER BY TabKey
    `);
    for (const row of r.recordset as { AccessId: number; TabKey: string }[]) {
      const list = byAccess.get(row.AccessId) ?? [];
      list.push(row.TabKey);
      byAccess.set(row.AccessId, list);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Invalid object name") && msg.includes("AccAdvClrAccessTab")) {
      console.error("[adv-clr-access-tabs] table unavailable — treating as no grants", err);
      byAccess.clear();
    } else {
      throw err;
    }
  }

  for (const id of accessIds) {
    map.set(id, filterStorableAdvClrKeys(byAccess.get(id) ?? []));
  }
  return map;
}

/** The whole roster with each person's grants, for the สิทธิ์เข้าถึง grid. */
export async function listAdvClrAccess(activeOnly = false): Promise<AdvClrAccessRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(`
    SELECT Id, StaffId, Email, DisplayName, IsActive
    FROM [dbo].[AccAdvClrAccess]
    ${activeOnly ? "WHERE IsActive = 1" : ""}
    ORDER BY DisplayName, StaffId
  `);
  const rows = (r.recordset as Array<{
    Id: number; StaffId: number; Email: string; DisplayName: string; IsActive: boolean;
  }>).map((x) => ({
    id: x.Id,
    staffId: x.StaffId,
    email: x.Email,
    displayName: x.DisplayName,
    isActive: !!x.IsActive,
  }));
  const tabMap = await loadAdvClrTabsByAccessIds(rows.map((row) => row.id));
  return rows.map((row) => ({ ...row, settingsTabs: tabMap.get(row.id) ?? [] }));
}

/**
 * The roster row's id for a StaffId, or null.
 *
 * StaffId is the table's natural key and the only identifier this app's routes
 * derive themselves (from HR, by email). Resolving here keeps a client-supplied
 * id off the path that decides whose grants are being replaced.
 */
export async function getAdvClrAccessIdByStaffId(staffId: number): Promise<number | null> {
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("staffId", sql.Int, staffId)
    .query(`SELECT Id FROM [dbo].[AccAdvClrAccess] WHERE StaffId = @staffId`);
  return (r.recordset[0]?.Id as number | undefined) ?? null;
}

/**
 * Add or update by StaffId — the natural key, so both databases agree.
 *
 * **An ABSENT `isActive` leaves an existing row's flag alone; only an explicit
 * boolean moves it.** AP-4's copy of this defaulted to `true` and wrote
 * unconditionally, so a settings POST that simply omitted the field
 * reactivated a deactivated person and restored every grant they held. A
 * brand-new row still defaults to active — `WHEN NOT MATCHED` has no prior
 * state to preserve, and adding somebody through the directory search is a
 * deliberate act. The same "absent is not null" distinction `ApiKey`'s
 * `expiresAt` PATCH makes, for the same reason: "leave it alone" has to be
 * expressible.
 */
export async function upsertAdvClrAccess(a: {
  staffId: number;
  email: string;
  displayName: string;
  isActive?: boolean;
  createdBy?: number | null;
}): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staffId", sql.Int, a.staffId)
      .input("email", sql.NVarChar(200), a.email)
      .input("name", sql.NVarChar(200), a.displayName)
      .input("active", sql.Bit, a.isActive === undefined ? null : a.isActive)
      .input("by", sql.Int, a.createdBy ?? null)
      .query(`
        MERGE [dbo].[AccAdvClrAccess] WITH (HOLDLOCK) AS t
        USING (SELECT @staffId AS StaffId) AS s ON t.StaffId = s.StaffId
        WHEN MATCHED THEN UPDATE SET
          Email = @email, DisplayName = @name,
          IsActive = COALESCE(@active, t.IsActive),
          UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHEN NOT MATCHED THEN
          INSERT (StaffId, Email, DisplayName, IsActive, CreatedBy)
          VALUES (@staffId, @email, @name, COALESCE(@active, 1), @by);
      `);
  });
}

/**
 * Soft delete / restore.
 *
 * **Grant rows are never touched here.** Deactivating clears `IsActive` and
 * leaves every `AccAdvClrAccessTab` row exactly as it was, so the grid keeps
 * showing what a deactivated person still holds — an admin needs to see that,
 * and to set it up before switching them back on — and reactivating restores
 * exactly the same sight they had rather than a blank slate.
 *
 * **The approver rosters are not touched either**, and that is the difference
 * from AP-4's `setReimburseAccessAndApprovalActive`, which must move both
 * because its grid derives approver activity from brand ticks on the same row.
 * Here the two approver pools are edited by their own controls on the same tab
 * and carry their own `IsActive`, so switching สิทธิ์เข้าถึง off must not
 * silently retire somebody from an approval step nobody asked it to.
 */
export async function setAdvClrAccessActive(
  staffId: number,
  isActive: boolean,
  updatedBy?: number | null,
): Promise<void> {
  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("staffId", sql.Int, staffId)
      .input("active", sql.Bit, isActive)
      .input("by", sql.Int, updatedBy ?? null)
      .query(`
        UPDATE [dbo].[AccAdvClrAccess]
        SET IsActive = @active, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
        WHERE StaffId = @staffId
      `);
  });
}

export async function getAdvClrAccessTabs(accessId: number): Promise<string[]> {
  const map = await loadAdvClrTabsByAccessIds([accessId]);
  return map.get(accessId) ?? [];
}

/**
 * Replace one person's granted tabs and menus **for ONE form**. Within that
 * form the list IS the granted set — `[]` clears it; the other form's keys are
 * not read, not deleted and not re-inserted.
 *
 * **`form` is required, and the bound `DELETE` is the whole point of this
 * function.** Until 2026-09-22 both forms' grants were edited on one screen, so
 * the posted list really was everything the person held and
 * `DELETE … WHERE AccessId = @aid` was correct. Splitting the screen made that
 * statement a data-destroyer: AP-2's page now posts only AP-2's keys, and an
 * unbounded delete would take every AP-3 grant with it — silently, in BOTH
 * databases, on the screen whose whole job is handing out access. It is the
 * write-side twin of the read-side failure CLAUDE.md records for AP-4, *"the
 * next tick would POST a one-element set and revoke the rest."*
 *
 * **The bound comes from `storableAdvClrKeysForForm`, never from a list
 * retyped here.** That partition is asserted disjoint and covering in
 * `settings-tabs.test.ts`; a second copy beside the SQL is how one of them
 * loses a key. `access-service-form-scope.test.ts` pins the statement to it.
 *
 * **A key belonging to neither form is left alone rather than swept up.** The
 * table has no CHECK on `TabKey` (migration 152, deliberately), so a row naming
 * any string can appear — and `filterStorableAdvClrKeys` on the read is what
 * makes such a row inert. Deleting it here would be this save reaching outside
 * what it owns, which is the property that just cost AP-3 its grants.
 *
 * Delete and insert happen inside one `writeBothPools` callback, so a partial
 * grant set cannot commit: either both databases end up with the whole new set
 * or neither moves.
 */
export async function setAdvClrAccessTabs(
  accessId: number,
  keys: string[],
  form: AdvClrForm,
): Promise<void> {
  // What this save may remove, and what it puts back. Narrowing the insert too
  // means a payload carrying the other form's keys — a stale tab, a replayed
  // POST — cannot add rows the delete did not clear, which would duplicate them.
  const scope = storableAdvClrKeysForForm(form);
  const wanted = filterAdvClrKeysForForm(keys, form);
  // Unreachable while both forms own keys, and asserted so; `IN ()` is a syntax
  // error, and a form that owns nothing has nothing to replace either way.
  if (scope.length === 0) return;

  await writeBothPools(async (tx) => {
    const del = tx.request().input("aid", sql.Int, accessId);
    // Placeholders are mapped from the INDEX, so no key text reaches the
    // statement — the same shape `loadAdvClrTabsByAccessIds` uses for its ids.
    const placeholders = scope.map((_, i) => `@sk${i}`).join(", ");
    scope.forEach((k, i) => del.input(`sk${i}`, sql.NVarChar(40), k));
    await del.query(`
      DELETE FROM [dbo].[AccAdvClrAccessTab]
      WHERE AccessId = @aid AND TabKey IN (${placeholders})
    `);
    for (const key of wanted) {
      await tx
        .request()
        .input("aid", sql.Int, accessId)
        .input("key", sql.NVarChar(40), key)
        .query(`INSERT INTO [dbo].[AccAdvClrAccessTab] (AccessId, TabKey) VALUES (@aid, @key)`);
    }
  });
}

/**
 * Everything this email may open; `[]` when they are not an **active**
 * `AccAdvClrAccess` row.
 *
 * Deactivating someone revokes their grants without touching a single grant
 * row, so reactivating restores exactly what they had. The `IsActive = 1` test
 * is what makes that true — do not move it into the caller.
 */
export async function resolveAdvClrTabsByEmail(
  email: string | null | undefined,
): Promise<string[]> {
  if (!email) return [];
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email)
    .query(
      `SELECT Id FROM [dbo].[AccAdvClrAccess] WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  const accessId = r.recordset[0]?.Id as number | undefined;
  if (!accessId) return [];
  return getAdvClrAccessTabs(accessId);
}
