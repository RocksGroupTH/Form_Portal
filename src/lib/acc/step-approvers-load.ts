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
 * | `AccApprover` | `AccApproverInterfaceBrand.InterfaceBrandCode` | **every brand** | ERP target |
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
 * **AP-1's and AP-4's empty scopes mean opposite things and both are honoured
 * as written.** CLAUDE.md records AP-1's zero-rows-is-unrestricted as a
 * fail-open that AP-4 deliberately did not copy; a tooltip that harmonised them
 * would be lying about one of the two.
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
    /* AP-1 — one accounting pool, scoped by ERP target, empty = unrestricted. */
    (async () => {
      const [rows, scope, byTarget] = await Promise.all([
        roster(pool, "AccApprover", "IsActive = 1"),
        scopeByApprover(pool, "AccApproverInterfaceBrand", "InterfaceBrandCode"),
        claimBrandsByTarget(pool, "AP-1"),
      ]);
      put(
        "AP-1",
        "ACCOUNT",
        rows.map((r) => {
          const targets = scope.get(r.Id);
          return {
            name: displayName(r),
            brands: targets && targets.length > 0 ? expand(targets, byTarget) : null,
          };
        }),
      );
    })(),

    /* AP-17 — the Admin desk and the accounting sign-off draw on one roster.
       Its scope is stored in claim brands already, and empty is unrestricted
       (`booking-approver-brands.ts`: "clears it — which restores unrestricted
       access, not 'no brands'"). */
    (async () => {
      const [rows, scope] = await Promise.all([
        roster(pool, "AccBookingApprover", "IsActive = 1"),
        scopeByApprover(pool, "AccBookingApproverBrand", "BrandCode"),
      ]);
      const people = rows.map((r) => {
        const brands = scope.get(r.Id);
        return { name: displayName(r), brands: brands && brands.length > 0 ? brands : null };
      });
      put("AP-17", "ADMIN", people);
      put("AP-17", "ACCOUNT", people);
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
