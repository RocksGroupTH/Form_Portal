import { getAccPool, sql } from "@/lib/acc/pool";
import { isAdminRole } from "@/lib/roles";

/**
 * Who may work the AP-11 Assist AP side.
 *
 * Deliberately a different roster from `AccApprover` (`src/lib/acc/access.ts`).
 * The people who prepare and hand out rewards are not the people who approve
 * travel claims, and folding the two together would silently hand every AP-1
 * approver the reward queue and the reward catalogue.
 */

/** Active row in `AccRewardOfficer` for this email. */
export async function isRewardOfficer(email: string | null | undefined): Promise<boolean> {
  if (!email?.trim()) return false;
  const pool = await getAccPool();
  const r = await pool
    .request()
    .input("email", sql.NVarChar, email.trim())
    .query(
      `SELECT TOP 1 1 AS ok FROM [dbo].[AccRewardOfficer]
        WHERE LOWER(Email) = LOWER(@email) AND IsActive = 1`,
    );
  return r.recordset.length > 0;
}

/**
 * May this person open the Assist AP queue, the AP-11 report and the reward
 * catalogue?
 *
 * Admins are included the way they are for AP-1's account area, so the feature
 * stays administrable when the roster is empty — which is exactly its state
 * immediately after migration 067 runs.
 */
export async function canAccessRewardArea(
  email: string | null | undefined,
  role: string | null | undefined,
): Promise<boolean> {
  return isAdminRole(role) || (await isRewardOfficer(email));
}

export interface RewardOfficerRow {
  id: number;
  staffId: number | null;
  email: string;
  displayName: string | null;
  photoUrl: string | null;
  isActive: boolean;
}

/** The roster, for the settings page and for notifying the step-2 queue. */
export async function listRewardOfficers(activeOnly = false): Promise<RewardOfficerRow[]> {
  const pool = await getAccPool();
  const r = await pool.request().query(
    `SELECT Id, StaffId, Email, DisplayName, PhotoUrl, IsActive
       FROM [dbo].[AccRewardOfficer]
      ${activeOnly ? "WHERE IsActive = 1" : ""}
      ORDER BY DisplayName, Email`,
  );
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    staffId: (x.StaffId as number) ?? null,
    email: x.Email as string,
    displayName: (x.DisplayName as string) ?? null,
    photoUrl: (x.PhotoUrl as string) ?? null,
    isActive: !!x.IsActive,
  }));
}
