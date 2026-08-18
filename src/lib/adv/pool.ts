import { getFormPool, sql } from "@/lib/db/mssql";

/**
 * Pool for AP-2 (Advance) tables. Uses getFormPool so AP-2 resolves through the
 * same per-viewer routing as every other form: a tester in UAT mode (AP-2 is
 * UatEnabled) lands on the UAT database, and an id ≥ 900000 names the UAT
 * database directly. AP-2's tables live in the UAT form database today, so AP-2
 * is a UAT-only pilot (ProductionEnabled off); once they are mirrored into the
 * production form database it can be turned on for Production with no code change.
 */
export const getAccPool = getFormPool;
export { sql };
