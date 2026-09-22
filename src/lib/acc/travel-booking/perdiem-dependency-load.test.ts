import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * `loadPerDiemDependencies` reaches `getAccPool()` (`@/lib/acc/pool` →
 * `@/lib/db/mssql` → `@/env`) purely by importing the module — `@/env`
 * validates the whole environment at import time, before any function in
 * this file is even called. `.env.local` is not loaded by `npm test` (only
 * pure, import-nothing modules are normally exercised — see CLAUDE.md), so
 * the four required-with-no-default vars are set here to harmless dummy
 * strings, letting every optional var (including `MSSQL_HOST`) fall through
 * to its real Zod default instead of `undefined`. Same shape as
 * `perdiem-recompute.test.ts`'s own preamble, which documents why
 * `SKIP_ENV_VALIDATION` does not work here. A dynamic import, not a static
 * one, because static imports are hoisted ahead of this assignment
 * regardless of where they sit in the file.
 *
 * This file is new rather than an addition to `perdiem-dependency.test.ts`,
 * even though the task brief names that as the nearest existing test file:
 * that file tests `perDiemDependency`, which is pure and imports nothing,
 * and giving it a database-shaped import (even a faked one) would change
 * what "run this file with no environment" means for every case already in
 * it. `perdiem-recompute.ts` / `perdiem-recompute.test.ts` is this
 * repository's own precedent for a module of exactly this shape — logic
 * plus SQL together, tested by faking the SQL layer under it — so this file
 * follows that name and that pattern instead.
 */
process.env.AUTH_SECRET ??= "test-secret";
process.env.MSSQL_DATABASE ??= "test-db";
process.env.MSSQL_USER ??= "test-user";
process.env.MSSQL_PASSWORD ??= "test-password";
let modPromise: ReturnType<typeof importModule> | null = null;
function importModule() {
  return import("./perdiem-dependency-load");
}
function loadModule() {
  if (!modPromise) modPromise = importModule();
  return modPromise;
}

/* ── fake SqlRunner ──────────────────────────────────────────────────────
 * `SqlRunner` is `{ request: () => ReturnType<AccPool["request"]> }` — the
 * real return type is mssql's `Request` class, so satisfying it structurally
 * would mean stubbing far more than this module calls. This fake implements
 * only `.input()`/`.query()` and is cast past the rest.
 *
 * There is exactly one query shape in `loadPerDiemDependencies`, so unlike
 * `perdiem-recompute.test.ts`'s fake `tx` (which routes three shapes by SQL
 * substring) this one just answers every `.query()` call with the same
 * canned recordset — the fixture below is already shaped as the rows that
 * one query returns: one row per (TargetRequestId, candidate trip) pair.
 */
type Call = { sql: string; inputs: Record<string, unknown> };

function makeFakeRunner(rows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const request = () => {
    const inputs: Record<string, unknown> = {};
    const req = {
      input(name: string, ...rest: unknown[]) {
        inputs[name] = rest[rest.length - 1];
        return req;
      },
      async query(sqlText: string) {
        calls.push({ sql: sqlText, inputs: { ...inputs } });
        return { recordset: rows };
      },
    };
    return req;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { runner: { request } as any, calls };
}

const d = (s: string) => new Date(`${s}T00:00:00`);

/** One row of the loader's own recordset — a candidate trip for one target id. */
const row = (
  targetRequestId: number,
  requestId: number,
  groupKey: string,
  sortOrder: number,
  departDate: string,
  returnDate: string,
  requestNo: string,
  status: string,
) => ({
  TargetRequestId: targetRequestId,
  RequestId: requestId,
  GroupKey: groupKey,
  SortOrder: sortOrder,
  DepartDate: d(departDate),
  ReturnDate: d(returnDate),
  RequestNo: requestNo,
  Status: status,
});

test("a predecessor in ANOTHER group is found and reported unsettled (the hole this task closes)", async () => {
  const { loadPerDiemDependencies } = await loadModule();

  // A (group g1) is still with its manager; B (group g2, filed separately)
  // dropped the 24th as a continuation of A under the widened chain. The old
  // GroupKey-scoped query never returned A when asked about B at all.
  const rows = [
    row(2, 1, "g1", 0, "2026-09-20", "2026-09-24", "TRL26-00001", "Submitted"),
    row(2, 2, "g2", 0, "2026-09-24", "2026-09-26", "TRL26-00002", "ManagerApproved"),
  ];
  const { runner } = makeFakeRunner(rows);

  const deps = await loadPerDiemDependencies(runner, [2]);
  const dep = deps.get(2);

  // Assert on the predecessor's identity, not only on `settled` — a fix that
  // returns "unsettled with no reason" must not pass.
  assert.equal(dep?.requestId, 1, "B's dependency must be A, not merely non-null");
  assert.equal(dep?.requestNo, "TRL26-00001");
  assert.equal(dep?.settled, false, "A is still Submitted — B's figure can still move");
});

test("a trip in another group that does not touch the target's dates is not pulled in as a predecessor", async () => {
  const { loadPerDiemDependencies } = await loadModule();

  // C (group g3) is on the requester's calendar too, but its return date
  // does not meet B's depart date — the widening must not treat every trip
  // of the requester as adjacent, only the one that actually touches.
  const rows = [
    row(2, 3, "g3", 0, "2026-08-01", "2026-08-02", "TRL26-00003", "Submitted"),
    row(2, 2, "g2", 0, "2026-09-24", "2026-09-26", "TRL26-00002", "ManagerApproved"),
  ];
  const { runner } = makeFakeRunner(rows);

  const deps = await loadPerDiemDependencies(runner, [2]);
  assert.equal(deps.get(2), null);
});

test("ordering is by depart date, not by the raw cross-group SortOrder value", async () => {
  const { loadPerDiemDependencies } = await loadModule();

  // A departs first (the 20th) but carries a HIGHER raw SortOrder than B —
  // exactly what happens when two different groups are each filled from 0.
  // Trusting SortOrder directly would sort B ahead of A and report B as
  // having no predecessor at all.
  const rows = [
    row(6, 5, "gA", 9, "2026-09-20", "2026-09-22", "TRL26-00005", "Submitted"),
    row(6, 6, "gB", 0, "2026-09-22", "2026-09-24", "TRL26-00006", "ManagerApproved"),
  ];
  const { runner } = makeFakeRunner(rows);

  const deps = await loadPerDiemDependencies(runner, [6]);
  const dep = deps.get(6);
  assert.equal(dep?.requestId, 5, "depart-date order must win over raw SortOrder");
  assert.equal(dep?.settled, false);
});

test("loadPerDiemDependency — the single-id wrapper agrees with the batch form", async () => {
  const { loadPerDiemDependency } = await loadModule();

  const rows = [
    row(2, 1, "g1", 0, "2026-09-20", "2026-09-24", "TRL26-00001", "Submitted"),
    row(2, 2, "g2", 0, "2026-09-24", "2026-09-26", "TRL26-00002", "ManagerApproved"),
  ];
  const { runner } = makeFakeRunner(rows);

  const dep = await loadPerDiemDependency(runner, 2);
  assert.equal(dep?.requestId, 1);
  assert.equal(dep?.settled, false);
});

test("an id absent from the recordset answers null rather than throwing", async () => {
  const { loadPerDiemDependencies } = await loadModule();
  const { runner } = makeFakeRunner([]);

  const deps = await loadPerDiemDependencies(runner, [42]);
  assert.equal(deps.get(42), null);
});

test("an empty id list makes no query at all", async () => {
  const { loadPerDiemDependencies } = await loadModule();
  const { runner, calls } = makeFakeRunner([]);

  const deps = await loadPerDiemDependencies(runner, []);
  assert.equal(deps.size, 0);
  assert.equal(calls.length, 0);
});
