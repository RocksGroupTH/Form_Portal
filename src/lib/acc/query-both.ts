import type { ConnectionPool } from "mssql";
import { getProductionFormPool, getUatFormPool } from "@/lib/db/mssql";
import type { FormEnvironmentValue } from "@/lib/form-environment/service";

export type WithEnvironment<T> = T & { environment: FormEnvironmentValue };

/**
 * Run the same read against both form databases and concatenate the results,
 * tagging each row with where it came from.
 *
 * A user can have live requests in production and test requests in UAT at the
 * same time — that is the point of per-form routing — so the handful of
 * endpoints that list "everything of mine" have to look in both places.
 *
 * Two consequences for callers:
 *
 *   - Ordering and paging must happen after this returns. Neither database can
 *     sort against the other's rows, so the SQL's ORDER BY only orders within
 *     each half.
 *   - Ids cannot collide. UAT transactional identities are seeded at 900000
 *     (migration 061), so a merged list never shows two rows with the same id. On an
 *     empty table DBCC CHECKIDENT RESEED makes the first row 900000 itself, not
 *     900001 — the property is "at or above 900000", not "above".
 *
 * Fails if either database is unreachable. Silently returning half a user's
 * requests would be worse than an error, because nothing on screen would say
 * anything was missing.
 */
export async function queryBothPools<T>(
  fn: (pool: ConnectionPool) => Promise<T[]>,
): Promise<WithEnvironment<T>[]> {
  const [prod, uat] = await Promise.all([
    getProductionFormPool(),
    getUatFormPool(),
  ]);
  const [prodRows, uatRows] = await Promise.all([fn(prod), fn(uat)]);

  const tagged: WithEnvironment<T>[] = [];
  for (const r of prodRows)
    tagged.push({ ...r, environment: "Production" as const });
  for (const r of uatRows) tagged.push({ ...r, environment: "UAT" as const });
  return tagged;
}
