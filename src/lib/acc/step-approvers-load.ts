/**
 * Read the five approver rosters into the shape `step-approvers.ts` matches on.
 *
 * One pool in, one `StepApproverMap` out. The route calls it once per database,
 * because two of the five rosters are not dual-written; see that module's
 * `StepApproverPayload` for why the answer is keyed by environment.
 *
 * ## Everything leaves here in CLAIM brands
 *
 * The rosters disagree about what a brand is, and reconciling that is this
 * file's main job:
 *
 * | roster | scope column | empty means | unit |
 * |---|---|---|---|
 * | `AccApprover` | `AccApproverInterfaceBrand.InterfaceBrandCode` | **no brand** (since 2026-09-24) | ERP target |
 * | `AccBookingApprover` | `AccBookingApproverBrand.BrandCode` | **every brand** | claim brand |
 * | `AccReimburseApprover` | `AccReimburseApproverBrand.InterfaceBrandCode` | **no brand** | ERP target |
 * | `AccAdvanceApprover` | — | — | (none) |
 * | `AccClearAdvanceApprover` | — | — | (none) |
 *
 * Two of them therefore need expanding: a person scoped to the PCTH *target*
 * may act on every claim brand that posts into PCTH, which on this deployment
 * includes ROCKS and PCMY. Comparing a target against `row.brandCode` directly
 * would list nobody for exactly those claims — silently, and on the column
 * whose whole purpose is to say who can act.
 *
 * **AP-1's empty scope meant every brand until 2026-09-24 and now means none**,
 * which is what AP-4 always meant. The card did not harmonise them while they
 * disagreed — it reported each as written — and the reason it now shows the
 * same thing for both is that the RULE changed, not the display.
 *
 * ## Only ACTIVE rows
 *
 * Every one of these rosters is a soft delete, and every action path filters
 * `IsActive = 1`. Listing a switched-off approver would name somebody the
 * approve button refuses.
 */
import type { ConnectionPool } from "mssql";
import { sql } from "@/lib/acc/pool";
import { perFormPredicate } from "@/lib/acc/per-form-config";
import {
  BOOKING_AREAS,
  BOOKING_AREA_COLUMN,
} from "@/lib/acc/travel-booking/booking-areas";
import type { StepApprover, StepApproverMap } from "@/lib/acc/step-approvers";

/** Rows as the rosters return them, before the brand expansion. */
interface RosterRow {
  Id: number;
  DisplayName: string | null;
  Email: string;
}

function displayName(r: RosterRow): string {
  return (r.DisplayName ?? "").trim() || r.Email.trim();
}

/**
 * Claim brand → interface target, for one form.
 *
 * `?? BrandCode` is the same final fallback the Interface ERP screens apply: a
 * brand with no `AccBrandErpInterface` row posts into itself. The per-form
 * predicate is used rather than a bare `FormCode` match because these rows have
 * a `NULL` default that answers every form — dropping the `IS NULL` arm is the
 * documented way to silently read another form's configuration.
 */
async function claimBrandsByTarget(
  pool: ConnectionPool,
  formCode: string,
): Promise<Map<string, string[]>> {
  /* The bind name is `formCode`, not `form`: `perFormPredicate` renders
     `@formCode` and a mismatch is not a type error, it is a runtime
     "Must declare the scalar variable" — which is how the first run of this
     failed for AP-1 and AP-4 while the other three loaded fine. */
  const r = await pool.request().input("formCode", sql.NVarChar, formCode).query<{
    BrandCode: string;
    InterfaceBrandCode: string | null;
  }>(`
    SELECT fb.BrandCode,
           (SELECT TOP 1 i.InterfaceBrandCode
              FROM [dbo].[AccBrandErpInterface] i
             WHERE i.BrandCode = fb.BrandCode AND ${perFormPredicate("i")}
             ORDER BY CASE WHEN i.FormCode IS NULL THEN 1 ELSE 0 END) AS InterfaceBrandCode
      FROM [dbo].[AccFormBrand] fb
     WHERE fb.FormCode = @formCode`);

  const byTarget = new Map<string, string[]>();
  for (const row of r.recordset) {
    const claim = (row.BrandCode ?? "").trim().toUpperCase();
    if (!claim) continue;
    const target = (row.InterfaceBrandCode ?? "").trim().toUpperCase() || claim;
    const list = byTarget.get(target) ?? [];
    list.push(claim);
    byTarget.set(target, list);
  }
  return byTarget;
}

/** `ApproverId → codes`, for one scope table. Absent id = no rows at all. */
async function scopeByApprover(
  pool: ConnectionPool,
  table: string,
  column: string,
): Promise<Map<number, string[]>> {
  const r = await pool
    .request()
    .query<{ ApproverId: number; Code: string }>(
      `SELECT ApproverId, ${column} AS Code FROM [dbo].[${table}] ORDER BY ApproverId, ${column}`,
    );
  const out = new Map<number, string[]>();
  for (const row of r.recordset) {
    const code = (row.Code ?? "").trim().toUpperCase();
    if (!code) continue;
    const list = out.get(row.ApproverId) ?? [];
    list.push(code);
    out.set(row.ApproverId, list);
  }
  return out;
}

/**
 * `ApproverId → the AP-17 menus that row holds`, from its own columns.
 *
 * **`CanQueue` / `CanAccount` / `CanReport`, not `AccBookingApproverTab`.**
 * This read was a tab-row read for one commit on 2026-09-24 and it named one
 * person per step while the desk actually had six, because ACC Portal — the
 * sibling writing these same roster rows — has stored the answer in columns
 * since migration 124. See `travel-booking/booking-areas.ts` for the
 * measurement and for why the rows could never have survived anyway.
 *
 * It is a column list rather than a join, so it costs the roster read
 * nothing; `BOOKING_AREA_COLUMN` is interpolated rather than typed out so a
 * fourth area cannot be added without a column to read it from.
 */
async function menusByApprover(pool: ConnectionPool): Promise<Map<number, string[]>> {
  const r = await pool.request().query<Record<string, number | boolean>>(
    `SELECT Id, ${BOOKING_AREAS.map((a) => BOOKING_AREA_COLUMN[a.key]).join(", ")}
       FROM [dbo].[AccBookingApprover]`,
  );
  const out = new Map<number, string[]>();
  for (const row of r.recordset) {
    out.set(
      Number(row.Id),
      BOOKING_AREAS.filter((a) => !!row[BOOKING_AREA_COLUMN[a.key]]).map((a) => a.key),
    );
  }
  return out;
}

/** Expand ERP targets into the claim brands that post into them. */
function expand(targets: string[], byTarget: Map<string, string[]>): string[] {
  const out: string[] = [];
  for (const t of targets) for (const c of byTarget.get(t) ?? []) if (out.indexOf(c) < 0) out.push(c);
  return out;
}

async function roster(pool: ConnectionPool, table: string, where: string): Promise<RosterRow[]> {
  const r = await pool
    .request()
    .query<RosterRow>(
      `SELECT Id, DisplayName, Email FROM [dbo].[${table}] WHERE ${where} ORDER BY DisplayName, Email`,
    );
  return r.recordset;
}

/**
 * Build the whole map for one database.
 *
 * Each roster is read independently and a failure in one is **not** allowed to
 * lose the others: this is a tooltip, and a form whose roster table is missing
 * on a half-migrated database should cost that form's names rather than every
 * form's. Same reasoning `sweepStaleRequests` applies to its two pools.
 */
export async function loadStepApprovers(pool: ConnectionPool): Promise<StepApproverMap> {
  const out: Record<string, Record<string, StepApprover[]>> = {};
  const put = (form: string, step: string, people: StepApprover[]) => {
    (out[form] ??= {})[step] = people;
  };

  const settled = await Promise.allSettled([
    /* AP-1 — one accounting pool, scoped by ERP target. Empty is empty since
       2026-09-24, the same as AP-4: see `resolveApproverInterfaceAccess`. */
    (async () => {
      const [rows, scope, byTarget] = await Promise.all([
        roster(pool, "AccApprover", "IsActive = 1"),
        scopeByApprover(pool, "AccApproverInterfaceBrand", "InterfaceBrandCode"),
        claimBrandsByTarget(pool, "AP-1"),
      ]);
      put(
        "AP-1",
        "ACCOUNT",
        rows.map((r) => ({
          name: displayName(r),
          brands: expand(scope.get(r.Id) ?? [], byTarget),
        })),
      );
    })(),

    /* AP-17 — two steps over one roster, and since 2026-09-24 they are NOT the
       same people. The Admin desk is whoever holds `CanQueue` and the HR
       sign-off whoever holds `CanAccount`, because those menu ticks became
       AUTHORITY rather than sight that day — see
       `travel-booking/require-booking-menu.ts`, which is the gate this list
       has to agree with. Listing the whole roster for both steps, as this did
       until then, now names people the approve button refuses.

       Brand scope is a second, independent narrowing and is left exactly as
       it was: stored in claim brands already, and empty is unrestricted
       (`booking-approver-brands.ts`: "clears it — which restores unrestricted
       access, not 'no brands'").

       **One residual, the same one the brand scope has.** An ADMIN-role
       approver passes `requireBookingMenu` and `requireBookingBrandScope`
       with no row at all, and this read sees rows rather than roles, so such
       a person is under-listed here. Under-listing is the safe direction for
       a card whose whole job is to name who can act, and reading the role
       would mean joining `TeamMember` in another database for a tooltip. */
    (async () => {
      const [rows, scope, menus] = await Promise.all([
        roster(pool, "AccBookingApprover", "IsActive = 1"),
        scopeByApprover(pool, "AccBookingApproverBrand", "BrandCode"),
        menusByApprover(pool),
      ]);
      const withMenu = (menu: string) =>
        rows
          .filter((r) => (menus.get(r.Id) ?? []).indexOf(menu) >= 0)
          .map((r) => {
            const brands = scope.get(r.Id);
            return { name: displayName(r), brands: brands && brands.length > 0 ? brands : null };
          });
      put("AP-17", "ADMIN", withMenu("queue"));
      put("AP-17", "ACCOUNT", withMenu("account"));
    })(),

    /* AP-4 — zero ticks is zero brands, the opposite of AP-1's fail-open, and
       the reason `[]` had to stay distinguishable from `null` all the way up. */
    (async () => {
      const [rows, scope, byTarget] = await Promise.all([
        roster(pool, "AccReimburseApprover", "IsActive = 1"),
        scopeByApprover(pool, "AccReimburseApproverBrand", "InterfaceBrandCode"),
        claimBrandsByTarget(pool, "AP-4"),
      ]);
      const people = rows.map((r) => ({
        name: displayName(r),
        brands: expand(scope.get(r.Id) ?? [], byTarget),
      }));
      put("AP-4", "ACCOUNT", people);
      put("AP-4", "ACCOUNT_FINAL", people);
    })(),

    /* AP-2 — no brand dimension at all; the chain is an amount matrix and each
       step is its own role. */
    (async () => {
      const r = await pool.request().query<RosterRow & { ApproverRole: string }>(
        `SELECT Id, DisplayName, Email, ApproverRole FROM [dbo].[AccAdvanceApprover]
          WHERE IsActive = 1 ORDER BY DisplayName, Email`,
      );
      const byRole: Record<string, StepApprover[]> = {};
      for (const row of r.recordset) {
        const role = (row.ApproverRole ?? "").trim();
        if (!role) continue;
        (byRole[role] ??= []).push({ name: displayName(row), brands: null });
      }
      for (const [role, people] of Object.entries(byRole)) put("AP-2", role, people);
    })(),

    /* AP-3 — `ACCOUNT` is its one live role; the `HEAD` rows are history and
       are read by nothing, so listing them would name people who cannot act. */
    (async () => {
      const rows = await roster(pool, "AccClearAdvanceApprover", "IsActive = 1 AND Role = 'ACCOUNT'");
      put("AP-3", "ACCOUNT", rows.map((r) => ({ name: displayName(r), brands: null })));
    })(),
  ]);

  for (const s of settled) {
    if (s.status === "rejected") {
      console.error("[acc/step-approvers] one roster failed to load", s.reason);
    }
  }
  return out;
}
