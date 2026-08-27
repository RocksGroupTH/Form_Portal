import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * `recomputeGroupPerDiem` reaches `getAccPool()` (`@/lib/acc/pool` →
 * `@/lib/db/mssql` → `@/env`) purely by importing the module — `@/env`
 * validates the whole environment at import time, before any function in
 * this file is even called, and `src/lib/db/mssql.ts`'s own module-level code
 * then reads `env.MSSQL_HOST` to decide a TLS `serverName`. `.env.local` is
 * not loaded by `npm test` (only pure, import-nothing modules are normally
 * exercised — see CLAUDE.md), so the four required-with-no-default vars are
 * set here to harmless dummy strings, letting every optional var (including
 * `MSSQL_HOST`) fall through to its real Zod default instead of `undefined`
 * (`SKIP_ENV_VALIDATION` was tried first and does not work: it skips defaults
 * too, so `env.MSSQL_HOST` comes back `undefined` and `mssql.ts`'s own
 * `isIP(env.MSSQL_HOST)` throws before any test body runs). No fixture row
 * below carries an `EmployeeId`, so `getAllowanceLog` (the one real network
 * call this module can make) is never reached — nothing here opens a
 * connection. A dynamic import, not a static one, because static imports are
 * hoisted ahead of this assignment regardless of where they sit in the file.
 */
process.env.AUTH_SECRET ??= "test-secret";
process.env.MSSQL_DATABASE ??= "test-db";
process.env.MSSQL_USER ??= "test-user";
process.env.MSSQL_PASSWORD ??= "test-password";
let modPromise: ReturnType<typeof importModule> | null = null;
function importModule() {
  return import("./perdiem-recompute");
}
function loadRecompute() {
  if (!modPromise) modPromise = importModule();
  return modPromise;
}

/* ── fake AccTx ──────────────────────────────────────────────────────────
 * `AccTx` is `{ request: () => ReturnType<AccPool["request"]> }` — the real
 * return type is mssql's `Request` class (an EventEmitter with `.execute`,
 * `.batch`, `.bulk`, `.pipe`, … beyond `.input`/`.query`), so satisfying it
 * structurally would mean stubbing all of that. This fake implements only
 * what `recomputeGroupPerDiem` actually calls and is cast past the rest.
 */
type Call = { sql: string; inputs: Record<string, unknown> };

function makeFakeTx(selectRows: Record<string, unknown>[]) {
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
        const isMainSelect =
          sqlText.includes("FROM [dbo].[AccTravelBooking] t") &&
          sqlText.includes("INNER JOIN [dbo].[AccRequest] r");
        return { recordset: isMainSelect ? selectRows : [] };
      },
    };
    return req;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tx: { request } as any, calls };
}

function callsFor(calls: Call[], verb: "UPDATE" | "INSERT", rid: number): Call[] {
  return calls.filter((c) => c.sql.trim().startsWith(verb) && c.inputs.rid === rid);
}

const d = (s: string) => new Date(`${s}T00:00:00`);

test("a live predecessor dying flips the successor's flag and gives its day back", async () => {
  const { recomputeGroupPerDiem } = await loadRecompute();

  const rows = [
    {
      RequestId: 1, SortOrder: 0, DepartDate: d("2026-01-01"), ReturnDate: d("2026-01-03"),
      IsContinuation: false, PerDiemDays: 2, PerDiemTotal: 0, Status: "Cancelled", EmployeeId: null,
    },
    {
      RequestId: 2, SortOrder: 1, DepartDate: d("2026-01-03"), ReturnDate: d("2026-01-04"),
      IsContinuation: true, PerDiemDays: 1, PerDiemTotal: 0, Status: "Submitted", EmployeeId: null,
    },
  ];
  const { tx, calls } = makeFakeTx(rows);

  await recomputeGroupPerDiem(tx, "grp-1", { requestId: 1, requestNo: "TRL26-00001", kind: "cancelled" });

  const updates = callsFor(calls, "UPDATE", 2);
  assert.equal(updates.length, 1, "the successor should get exactly one UPDATE");
  assert.equal(updates[0].inputs.cont, 0, "no longer a continuation once its predecessor is dead");
  // Both days of a 2-day span are now counted instead of 1 — the day it had
  // dropped as a duplicate is given back.
  assert.equal(updates[0].inputs.days, 2);

  const inserts = callsFor(calls, "INSERT", 2);
  assert.equal(inserts.length, 1, "the successor should get exactly one audit row");
  assert.match(inserts[0].sql, /VALUES \(@rid, NULL, 'perdiem_recalculated'/, "AuthorId is the literal NULL, not a bound value");
  const meta = JSON.parse(inserts[0].inputs.meta as string);
  assert.equal(meta.before.days, 1);
  assert.equal(meta.after.days, 2);
  assert.equal(meta.causedByRequestId, 1);
  assert.equal(meta.causedByRequestNo, "TRL26-00001");
  assert.equal(meta.cause, "cancelled");
  assert.equal(meta.locked, false);
});

test("a trip whose flag does not change gets no UPDATE and no log row", async () => {
  const { recomputeGroupPerDiem } = await loadRecompute();

  const rows = [
    {
      RequestId: 1, SortOrder: 0, DepartDate: d("2026-01-01"), ReturnDate: d("2026-01-03"),
      IsContinuation: false, PerDiemDays: 2, PerDiemTotal: 0, Status: "Cancelled", EmployeeId: null,
    },
    {
      RequestId: 2, SortOrder: 1, DepartDate: d("2026-01-03"), ReturnDate: d("2026-01-04"),
      IsContinuation: true, PerDiemDays: 1, PerDiemTotal: 0, Status: "Submitted", EmployeeId: null,
    },
    // Not adjacent to request 2's return date, so it was never a continuation
    // and stays that way regardless of what happens to request 1.
    {
      RequestId: 3, SortOrder: 2, DepartDate: d("2026-02-01"), ReturnDate: d("2026-02-02"),
      IsContinuation: false, PerDiemDays: 2, PerDiemTotal: 400, Status: "Submitted", EmployeeId: null,
    },
  ];
  const { tx, calls } = makeFakeTx(rows);

  await recomputeGroupPerDiem(tx, "grp-1", { requestId: 1, requestNo: "TRL26-00001", kind: "cancelled" });

  assert.equal(callsFor(calls, "UPDATE", 3).length, 0);
  assert.equal(callsFor(calls, "INSERT", 3).length, 0);
});

test("a Completed trip whose flag would have flipped is not updated but still gets a locked audit row", async () => {
  const { recomputeGroupPerDiem } = await loadRecompute();

  const rows = [
    {
      RequestId: 1, SortOrder: 0, DepartDate: d("2026-01-01"), ReturnDate: d("2026-01-03"),
      IsContinuation: false, PerDiemDays: 2, PerDiemTotal: 0, Status: "Cancelled", EmployeeId: null,
    },
    {
      RequestId: 2, SortOrder: 1, DepartDate: d("2026-01-03"), ReturnDate: d("2026-01-04"),
      IsContinuation: true, PerDiemDays: 1, PerDiemTotal: 300, Status: "Completed", EmployeeId: null,
    },
  ];
  const { tx, calls } = makeFakeTx(rows);

  await recomputeGroupPerDiem(tx, "grp-1", { requestId: 1, requestNo: "TRL26-00001", kind: "cancelled" });

  assert.equal(callsFor(calls, "UPDATE", 2).length, 0, "a signed figure is never rewritten");

  const inserts = callsFor(calls, "INSERT", 2);
  assert.equal(inserts.length, 1, "the frozen row still gets an audit row — that's the point");
  const meta = JSON.parse(inserts[0].inputs.meta as string);
  assert.equal(meta.before.days, meta.after.days);
  assert.equal(meta.before.total, meta.after.total);
  assert.equal(meta.locked, true);
  assert.equal(meta.causedByRequestId, 1);

  // Finding 1: the note must say accounting signed it — not the generic
  // "already passed accounting" sentence misapplied to a row that just died.
  const note = inserts[0].inputs.note as string;
  assert.match(note, /ผ่านบัญชีแล้ว/);
});

test("the cause's own row, if its flag flips too, gets a truthful note about itself — not the accounting sentence", async () => {
  const { recomputeGroupPerDiem } = await loadRecompute();

  // A single-row group standing in for the cause's own trip: previously
  // computed as a continuation (of some now-irrelevant earlier trip), now
  // dying. continuationFlags reports a dead trip's own flag as false
  // (continuation-chain.ts), so this row's stored IsContinuation=true no
  // longer matches, and it re-enters the loop describing itself.
  const rows = [
    {
      RequestId: 9, SortOrder: 0, DepartDate: d("2026-03-05"), ReturnDate: d("2026-03-06"),
      IsContinuation: true, PerDiemDays: 1, PerDiemTotal: 100, Status: "Cancelled", EmployeeId: null,
    },
  ];
  const { tx, calls } = makeFakeTx(rows);

  await recomputeGroupPerDiem(tx, "grp-2", { requestId: 9, requestNo: "TRL26-00009", kind: "cancelled" });

  assert.equal(callsFor(calls, "UPDATE", 9).length, 0);
  const inserts = callsFor(calls, "INSERT", 9);
  assert.equal(inserts.length, 1);
  const note = inserts[0].inputs.note as string;
  // It must not claim accounting signed it — it died, it wasn't signed.
  assert.doesNotMatch(note, /ผ่านบัญชีแล้ว/);
  assert.match(note, /คำขอนี้เองก็ถูกยกเลิกเช่นกัน/);

  const meta = JSON.parse(inserts[0].inputs.meta as string);
  assert.equal(meta.locked, true);
  assert.equal(meta.before.days, meta.after.days);
});

test("a rewritten per diem also rewrites AccRequest.TotalAmount, in the same statement", async () => {
  const { recomputeGroupPerDiem } = await loadRecompute();

  // Same fixture as the first test: request 2 stops being a continuation and
  // gets its first day back. `AccTravelBooking.PerDiemTotal` moving without
  // `AccRequest.TotalAmount` moving with it is what left My Requests and My
  // Work showing the pre-cancellation figure for good.
  const rows = [
    {
      RequestId: 1, SortOrder: 0, DepartDate: d("2026-01-01"), ReturnDate: d("2026-01-03"),
      IsContinuation: false, PerDiemDays: 2, PerDiemTotal: 0, Status: "Cancelled", EmployeeId: null,
    },
    {
      RequestId: 2, SortOrder: 1, DepartDate: d("2026-01-03"), ReturnDate: d("2026-01-04"),
      IsContinuation: true, PerDiemDays: 1, PerDiemTotal: 0, Status: "Submitted", EmployeeId: null,
    },
  ];
  const { tx, calls } = makeFakeTx(rows);

  await recomputeGroupPerDiem(tx, "grp-1", { requestId: 1, requestNo: "TRL26-00001", kind: "cancelled" });

  const updates = callsFor(calls, "UPDATE", 2);
  assert.equal(updates.length, 1, "still one round-trip — both tables in one batch");
  assert.match(updates[0].sql, /UPDATE \[dbo\]\.\[AccTravelBooking\] SET/);
  assert.match(updates[0].sql, /UPDATE \[dbo\]\.\[AccRequest\] SET\s+TotalAmount=@total/);
  // The same bound value feeds both, so the two figures cannot drift apart.
  assert.match(updates[0].sql, /WHERE Id=@rid/);
});

test("a frozen row rewrites neither figure — TotalAmount follows the same writability rule", async () => {
  const { recomputeGroupPerDiem } = await loadRecompute();

  const rows = [
    {
      RequestId: 1, SortOrder: 0, DepartDate: d("2026-01-01"), ReturnDate: d("2026-01-03"),
      IsContinuation: false, PerDiemDays: 2, PerDiemTotal: 0, Status: "Cancelled", EmployeeId: null,
    },
    {
      RequestId: 2, SortOrder: 1, DepartDate: d("2026-01-03"), ReturnDate: d("2026-01-04"),
      IsContinuation: true, PerDiemDays: 1, PerDiemTotal: 200, Status: "Completed", EmployeeId: null,
    },
  ];
  const { tx, calls } = makeFakeTx(rows);

  await recomputeGroupPerDiem(tx, "grp-1", { requestId: 1, requestNo: "TRL26-00001", kind: "cancelled" });

  assert.equal(callsFor(calls, "UPDATE", 2).length, 0, "accounting signed it — neither table is touched");
  assert.equal(callsFor(calls, "INSERT", 2).length, 1, "but the locked audit row still goes in");
});
