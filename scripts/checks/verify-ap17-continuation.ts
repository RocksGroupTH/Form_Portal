/**
 * Report every AP-17 trip whose STORED `IsContinuation` disagrees with what
 * `continuationFlags` computes over its requester's WHOLE live calendar today.
 *
 * **Why this exists (N1, fix round 2, 2026-09-22).** Before this branch,
 * `IsContinuation` was decided per booking group only, so a pair of trips
 * filed weeks apart in two different groups — the ordinary case for a
 * frequent traveller — could both be stored `false` even though one of them
 * genuinely continues the other. The branch widened the chain to span a
 * requester's whole calendar and fixed the SUBMIT path to keep it correct
 * going forward (`rewriteSubmitAffectedTrips`, `perdiem-recompute.ts`), but
 * it deliberately does **not** correct a pre-existing wrong figure as a side
 * effect of an unrelated filing — see `causeFor`'s null-return arm in
 * `request-service.ts` and CLAUDE.md's own note on why. So a stored value
 * that already disagreed with the calendar-wide rule before this branch
 * shipped **stays disagreeing until something reconciles it on purpose**.
 * Nobody knows how many such rows exist. This script answers that, and only
 * that — it is the blast radius of the N1 finding, and the number that says
 * whether a deliberate one-off reconciliation should precede the deploy.
 *
 * **Read-only. There is no `--apply` and never will be** — unlike
 * `recompute-ap17-payout.ts`, which this script is otherwise shaped to
 * match. Silently rewriting `IsContinuation`/`PerDiemDays`/`PerDiemTotal` for
 * a request already `Submitted` or `ManagerApproved` — or, worse,
 * `Completed` — outside of a considered decision is exactly the backfill
 * CLAUDE.md's "Nothing backfills" refuses to do. If a reconciliation is ever
 * wanted, it is a new, deliberate piece of work built on what this script
 * reports, not a flag added to this one.
 *
 * **Grouping is StaffId-primary, EmployeeId-fallback, not a full
 * transitive match.** The real chain (`loadRequesterTrips`,
 * `requester-trips.ts`) matches a candidate row if EITHER its `StaffId` OR
 * its `EmployeeId` equals the target's — which can, in principle, chain two
 * rows together that share only one of the two columns. This script instead
 * partitions every row once: by `StaffId` when it is set, and by
 * `EmployeeId` only for the (expected to be rare) rows where `StaffId` is
 * null. That is enough to size the blast radius honestly for the ordinary
 * population — a real person's trips carry the same `StaffId` throughout —
 * and it trades a theoretical undercount (a `StaffId`-null/`EmployeeId`-null
 * pairing this script would treat as two different requesters) for running
 * as one query instead of one per requester. If the reported count turns out
 * to matter, that is the moment to build the exact-match version.
 *
 *   npx tsx --env-file=.env.local scripts/checks/verify-ap17-continuation.ts [--db <name>]
 *
 * With no `--db`, runs against BOTH `Rocks_Portal_Form` and
 * `Rocks_Portal_Form_UAT` in turn, since a tester's trips only ever live in
 * one of the two and the whole point is to know the count in each.
 */
import { getAppPool } from "../../src/lib/db/mssql";
import { continuationFlags, type ChainTrip } from "../../src/lib/acc/travel-booking/continuation-chain";

const args = process.argv.slice(2);
const dbIdx = args.indexOf("--db");
const DATABASES = dbIdx !== -1 ? [args[dbIdx + 1]] : ["Rocks_Portal_Form", "Rocks_Portal_Form_UAT"];

function ymd(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Row {
  RequestId: number;
  RequestNo: string | null;
  StaffId: number | null;
  EmployeeId: string | null;
  SortOrder: number;
  DepartDate: Date | null;
  ReturnDate: Date | null;
  Status: string;
  IsContinuation: boolean | null;
}

/** `Status <> 'Draft'` already excludes drafts at the query; this is the
 *  separate "alive" test `continuation-chain.ts`/`requester-trips.ts` both
 *  use — a Cancelled or Rejected trip is loaded (so it can still be skipped
 *  over correctly while finding somebody ELSE's nearest live predecessor)
 *  but is never itself checked for disagreement below. */
function isAlive(status: string): boolean {
  return status !== "Cancelled" && status !== "Rejected";
}

async function checkDatabase(dbName: string): Promise<void> {
  console.log(`\n=== ${dbName} ===`);
  const pool = await getAppPool(dbName);

  const res = await pool.request().query(`
    SELECT r.Id AS RequestId, r.RequestNo, r.StaffId, r.EmployeeId,
           t.SortOrder, t.DepartDate, t.ReturnDate, r.Status, t.IsContinuation
      FROM [dbo].[AccRequest] r
      INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
     WHERE r.FormCode = 'AP-17' AND r.Status <> 'Draft'
  `);
  const rows = res.recordset as Row[];
  console.log(`${rows.length} non-Draft AP-17 request(s)`);

  const groups = new Map<string, Row[]>();
  let ungrouped = 0;
  for (const row of rows) {
    const key = row.StaffId != null ? `staff:${row.StaffId}` : row.EmployeeId != null ? `emp:${row.EmployeeId}` : null;
    if (!key) {
      ungrouped++;
      continue;
    }
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  if (ungrouped > 0) {
    console.log(`  (${ungrouped} row(s) have neither StaffId nor EmployeeId — cannot be checked, skipped)`);
  }
  console.log(`${groups.size} distinct requester(s)`);

  let disagreements = 0;
  let checked = 0;

  for (const [key, group] of Array.from(groups.entries())) {
    const chainTrips: ChainTrip[] = group.map((r) => ({
      requestId: r.RequestId,
      sortOrder: r.SortOrder ?? 0,
      departDate: r.DepartDate ? ymd(r.DepartDate) : null,
      returnDate: r.ReturnDate ? ymd(r.ReturnDate) : null,
      alive: isAlive(r.Status),
    }));
    const flags = continuationFlags(chainTrips);

    for (const row of group) {
      if (!isAlive(row.Status)) continue; // a dead trip's own flag is not the target of this reconciliation
      checked++;
      const stored = !!row.IsContinuation;
      const computed = flags.get(row.RequestId) ?? false;
      if (stored === computed) continue;

      disagreements++;
      const tag = row.RequestNo ?? `#${row.RequestId}`;
      console.log(
        `  DISAGREE  ${tag}  requester=${key}  status=${row.Status}  ` +
          `stored=${stored} computed=${computed}  ` +
          `depart=${row.DepartDate ? ymd(row.DepartDate) : "-"} return=${row.ReturnDate ? ymd(row.ReturnDate) : "-"}`,
      );
    }
  }

  console.log(`${checked} live trip(s) checked, ${disagreements} disagreement(s) found in ${dbName}`);
}

async function main() {
  console.log("Dry run only — this script never writes. See its own header for why.");
  for (const db of DATABASES) {
    await checkDatabase(db);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
