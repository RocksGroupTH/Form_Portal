import { getFormPool, sql } from "@/lib/db/mssql";

/**
 * Pool for AP-2 (Advance) — per-form routing, same as AP-1 / AP-17.
 *
 * AP-2 ran as a UAT-only pilot pinned to getUatFormPool while its tables existed
 * only in the UAT form database. Both conditions to un-pin are now met:
 *
 *   1. AP-2's tables are mirrored into the production form database
 *      (migrations 073-090 applied to Rocks_Portal_Form).
 *   2. Its settings routes are excluded from request-id routing — the
 *      `"/api/request/advance/settings" → null` rule in classify-path keeps a
 *      config-row id (tier/approver id) from being read as an AccRequest id.
 *
 * So getAccPool now follows getFormPool: request routes resolve by the record's
 * id (UAT id ≥ 900000 → UAT, else Production), settings routes read Production,
 * and config services dual-write both databases via writeBothPools.
 */
export const getAccPool = getFormPool;
export { sql };
