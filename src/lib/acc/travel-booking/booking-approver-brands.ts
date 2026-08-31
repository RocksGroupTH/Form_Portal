import { getAccPool, sql } from "@/lib/acc/pool";
import { writeBothPools } from "@/lib/acc/dual-write";
import { isAdminRole } from "@/lib/roles";
import { listFormBrands } from "@/lib/acc/settings-service";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";
import {
  normalizeBrandCodes,
  type BookingBrandAccess,
  type BookingBrandScope,
} from "@/lib/acc/travel-booking/booking-brand-access-shared";

/**
 * Which brands each AP-17 approver may see — the pool half.
 *
 * Structurally `booking-approver-tabs.ts` with a different column, and
 * `approver-interface-access.ts`'s empty-means-all reading. `AccBookingApproverBrand`
 * (migration 134) is dual-written and lives in both form databases, so reads go
 * through `getAccPool()` — the environment-varying pool — and writes through
 * `writeBothPools`.
 *
 * **No rows for an approver means UNRESTRICTED, not "no brands".** See
 * `booking-brand-access-shared.ts` and migration 134's header for why this
 * default runs the opposite way from AP-17's tab grants.
 */

/** `null` for an approver means unrestricted. An array means scoped to it. */
export async function loadBookingBrandsByApproverIds(
  approverIds: number[],
): Promise<Map<number, string[] | null>> {
  const map = new Map<number, string[] | null>();
  if (approverIds.length === 0) return map;

  const byApprover = new Map<number, string[]>();
  try {
    const pool = await getAccPool();
    const placeholders = approverIds.map((_, i) => `@id${i}`).join(", ");
    const req = pool.request();
    approverIds.forEach((id, i) => req.input(`id${i}`, sql.Int, id));
    const r = await req.query(`
      SELECT ApproverId, BrandCode FROM [dbo].[AccBookingApproverBrand]
      WHERE ApproverId IN (${placeholders}) ORDER BY BrandCode
    `);
    for (const row of r.recordset as { ApproverId: number; BrandCode: string }[]) {
      const list = byApprover.get(row.ApproverId) ?? [];
      list.push(row.BrandCode);
      byApprover.set(row.ApproverId, list);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // A MISSING TABLE degrades to UNRESTRICTED — the opposite direction from
    // booking-approver-tabs.ts, and for the opposite reason. That file's rows
    // GRANT something, so absent must mean "not granted". These rows NARROW
    // something the four people on the roster already have, so absent has to
    // mean "not narrowed" — otherwise the window before 134 reaches both
    // databases blinds every approver instead of merely un-scoping them.
    //
    // ANY OTHER FAILURE rethrows, and the narrowness of the match is the point.
    // Two callers want opposite things from an unreadable scope: the act paths
    // want a 500 (fail closed on the action), and the admin's editing grid must
    // show its error state rather than render an unreadable scope as "all
    // ticked" — because the admin's next tick would then POST a widened set,
    // and setBookingApproverBrands replaces rather than merges, in BOTH
    // databases. Never `||`: an error merely NAMING the table — permission
    // denied, a deadlock, a timeout — must not become a silent un-scoping.
    if (msg.includes("Invalid object name") && msg.includes("AccBookingApproverBrand")) {
      console.error("[booking-approver-brands] table unavailable — treating as unrestricted", err);
      byApprover.clear();
      for (const id of approverIds) map.set(id, null);
      return map;
    }
    throw err;
  }

  for (const id of approverIds) {
    const list = byApprover.get(id);
    map.set(id, list && list.length > 0 ? normalizeBrandCodes(list) : null);
  }
  return map;
}

/**
 * The roster row's id for this email, or null.
 *
 * `isBookingApprover` answers a boolean and the scope hangs off the row's id, so
 * this asks for the id directly rather than asking twice. Active rows only: a
 * deactivated approver is not on the roster, and `canAccessBookingArea` would
 * refuse them the area regardless.
 */
async function resolveBookingApproverId(email: string | null): Promise<number | null> {
  const e = (email ?? "").trim();
  if (!e) return null;
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar(200), e)
    .query(`SELECT TOP 1 Id FROM [dbo].[AccBookingApprover]
            WHERE Email = @email AND IsActive = 1`);
  return (r.recordset[0]?.Id as number) ?? null;
}

export async function getBookingApproverBrandCodes(approverId: number): Promise<string[] | null> {
  const map = await loadBookingBrandsByApproverIds([approverId]);
  return map.get(approverId) ?? null;
}

/**
 * Replace one approver's scope. `null` or `[]` clears it — which restores
 * unrestricted access, not "no brands".
 *
 * DELETE + INSERT inside one `writeBothPools`, the shape `setBookingApproverTabs`
 * uses. Codes are validated against AP-17's own `AccFormBrand` rows — any
 * `IsActive`, so a temporarily-disabled brand is not silently dropped from
 * somebody's scope — because the table has no CHECK and no FK, and code is
 * therefore the only place this can be enforced at all.
 */
export async function setBookingApproverBrands(
  approverId: number,
  codes: string[] | null,
): Promise<void> {
  const requested = normalizeBrandCodes(codes ?? []);
  let allowed: string[] = [];
  if (requested.length > 0) {
    // Any IsActive: a brand switched off temporarily must not be silently
    // dropped out of somebody's scope, which would widen it on the next save.
    const rows = await listFormBrands(AP17_FORM_CODE);
    const known = normalizeBrandCodes(rows.map((r) => r.brandCode));
    allowed = requested.filter((c) => known.indexOf(c) >= 0);
  }

  await writeBothPools(async (tx) => {
    await tx
      .request()
      .input("aid", sql.Int, approverId)
      .query(`DELETE FROM [dbo].[AccBookingApproverBrand] WHERE ApproverId = @aid`);

    for (const code of allowed) {
      await tx
        .request()
        .input("aid", sql.Int, approverId)
        .input("code", sql.NVarChar(20), code)
        .query(`INSERT INTO [dbo].[AccBookingApproverBrand] (ApproverId, BrandCode)
                VALUES (@aid, @code)`);
    }
  });
}

/**
 * This viewer's brand scope.
 *
 * An admin is unrestricted, and so is anybody with no rows. Somebody who is
 * neither an admin nor on the roster resolves to `{allAccess:false,
 * allowedCodes:[]}` — scoped with nothing in scope, which refuses everything.
 * That is a refusal rather than a wave-through, and it is why the empty scoped
 * state has to be representable at all.
 */
export async function resolveBookingBrandAccess(
  email: string | null | undefined,
  role: string | null | undefined,
): Promise<BookingBrandAccess> {
  if (isAdminRole(role ?? "")) return { allAccess: true, allowedCodes: [] };

  // The roster row's id is what the scope hangs off. A viewer who is neither an
  // admin nor on the roster resolves to scoped-with-nothing, which refuses
  // everything — a refusal, never a wave-through.
  const approverId = await resolveBookingApproverId(email ?? null);
  if (approverId == null) return { allAccess: false, allowedCodes: [] };

  const codes = await getBookingApproverBrandCodes(approverId);
  return codes === null
    ? { allAccess: true, allowedCodes: [] }
    : { allAccess: false, allowedCodes: codes };
}

/**
 * Bind a scope onto a request and return the SQL predicate, or `null` when there
 * is nothing to filter.
 *
 * `{kind:"none"}` renders `1 = 0` rather than an empty `IN ()`, which is a
 * syntax error — the reason that state is a distinct kind in the first place.
 */
export function bookingBrandScopeSql(
  scope: BookingBrandScope,
  req: sql.Request,
  column: string,
): string | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "none") return "1 = 0";
  const names = scope.codes.map((code, i) => {
    req.input(`bscope${i}`, sql.NVarChar(20), code);
    return `@bscope${i}`;
  });
  return `${column} IN (${names.join(", ")})`;
}
