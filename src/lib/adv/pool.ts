import { getUatFormPool, sql } from "@/lib/db/mssql";

/**
 * Pool for AP-2 (Advance) — pinned to the UAT form database.
 *
 * AP-2 is a UAT-only pilot (FormEnvironment AP-2 = ProductionEnabled off,
 * UatEnabled on) and every AP-2 table lives in the UAT form database. Pinning to
 * getUatFormPool keeps AP-2 out of the per-form id/viewer routing entirely, which
 * getFormPool applies from the URL: a settings route like
 * /api/request/advance/settings/tiers/3 carries a config-row id (3), not an
 * AccRequest id, and getFormPool would read it as one and route the request to
 * Production (id < 900000) — where AP-2's UAT-only tables do not exist. Move back
 * to getFormPool only once AP-2's tables are mirrored into the production form
 * database AND its settings routes are excluded from request-id routing (compare
 * AP-1's `"/api/request/accounting/settings" → null` rule in classify-path).
 */
export const getAccPool = getUatFormPool;
export { sql };
