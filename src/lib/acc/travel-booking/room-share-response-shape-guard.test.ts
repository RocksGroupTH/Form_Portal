import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **The host picker lists somebody else's requests, and this pins what it may
 * say about them.**
 *
 * AP-17 package E, spec §6: listing another person's requests is new reach in
 * this application, and the endpoint returns *only* the running number, the
 * travel dates and the work location — "not the amount, not the attachments,
 * not the ID card". The failure to catch is a **field arriving by
 * inheritance**: somebody widens a column list, reuses the detail read shape,
 * or adds a key to the row type, and nothing anywhere goes red because the new
 * field is perfectly valid data that simply should not leave the building.
 *
 * Source-reading, and it has to be: `room-share-service.ts` reaches
 * `getAccPool()` → `@/lib/db/mssql` → `@/env`, which validates the whole
 * environment at import time and throws in a test run. Nothing here can be
 * imported, so nothing here can be tested behaviourally. The same constraint
 * `perdiem-source-guard.test.ts` and `booking-brand-scope-guard.test.ts`
 * already work under.
 *
 * ## Mutation-verified, 2026-09-22
 *
 * Because a guard nobody has tried to defeat is a guard nobody knows the
 * strength of, and this branch has already shipped two that were green against
 * six real regressions each. Each of these was applied to the source and the
 * suite re-run; every one went red, and the tree was confirmed clean
 * afterwards:
 *
 * 1. `r.TotalAmount` appended to `HOST_DISPLAY_COLUMNS` → red ("the picker's
 *    display columns are exactly…").
 * 2. `totalAmount: number;` added to `HostCandidateRow` → red ("…returns
 *    exactly the fields spec §6 allows").
 * 3. `SELECT ${HOST_DISPLAY_COLUMNS}` rewritten to `SELECT r.*` → red, twice
 *    over (the no-`SELECT *` test and the interpolation test).
 * 4. the `authorizeAccRequest` gate deleted from the hosts route → red.
 * 5. the gate moved to *after* `loadHostableRequests` → red.
 * 6. a new `export async function loadHostFullDetail` added → red ("the
 *    service exports exactly…"), which is the arm that catches a wide reader
 *    arriving beside the narrow one rather than inside it.
 */

const ROOT = process.cwd();
const SERVICE = path.resolve(ROOT, "src/lib/acc/travel-booking/room-share-service.ts");
const SHARE_ROUTE = path.resolve(
  ROOT,
  "src/app/api/request/travel-booking/room-share/[guestRequestId]/route.ts",
);
const HOSTS_ROUTE = path.resolve(
  ROOT,
  "src/app/api/request/travel-booking/room-share/[guestRequestId]/hosts/route.ts",
);

/** Source with comments removed — this guard's own prose must never satisfy it. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * A top-level function's body, from its declaration to the next top-level
 * declaration.
 *
 * Deliberately **not** "to the next line starting with `}`", which is the
 * obvious version and is wrong here: a function whose parameter is an inline
 * object type closes it with `}): Promise<…> {` in column 0, so that version
 * returns the signature and calls every assertion about the body vacuously
 * true. Measured on `attachRoomShare` while writing this file.
 *
 * Fail-closed: a declaration this cannot find is an assertion failure, never
 * an empty string quietly satisfying whatever is asked of it.
 */
function bodyOf(src: string, decl: string): string {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found — has it been renamed?`);
  const re = /^(?:export\s+)?(?:async\s+)?(?:function|const|interface|type)\s+[A-Za-z_]/gm;
  let end = src.length;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > start) {
      end = m.index;
      break;
    }
  }
  assert.ok(end > start + decl.length, `could not find the end of ${decl}`);
  return src.slice(start, end);
}

/**
 * A top-level interface's fields as `name: type`, in order.
 *
 * **Types, not names alone**, and that is not tidiness: `workLocations:
 * string[]` widened to `{ name: string; lat: number; lng: number }[]` keeps the
 * field name and starts shipping the coordinates of somebody else's hotel. A
 * name-only allow-list would have called that unchanged.
 */
function interfaceFields(src: string, name: string): string[] {
  const m = new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(src);
  assert.ok(m, `interface ${name} not found — has it been renamed?`);
  const fields: string[] = [];
  for (const line of m![1].split("\n")) {
    const f = /^\s*([A-Za-z_][A-Za-z0-9_]*\s*\??\s*:\s*.+?);\s*$/.exec(line);
    if (f) fields.push(f[1].replace(/\s+/g, " ").trim());
  }
  return fields;
}

/** Every `alias.Column` token inside a SQL column-list constant. */
function columnsOf(src: string, constName: string): string[] {
  const m = new RegExp(`const ${constName}\\s*=\\s*"([^"]*)"`).exec(src);
  assert.ok(m, `${constName} not found, or no longer a plain double-quoted string`);
  return m![1]
    .split(",")
    .map((c) => c.trim())
    // `t.Id AS TravelBookingId` → `t.Id`; the alias is not another column.
    .map((c) => c.split(/\s+/)[0])
    .filter((c) => c.length > 0);
}

/* ─────────────────────────── the emitted shape ─────────────────────────── */

/**
 * The whole point. Spec §6 names three facts; `requestId` is the handle the
 * picker posts back to attach, not a fourth fact.
 */
test("HostCandidateRow returns exactly the fields spec §6 allows, and no others", () => {
  assert.deepEqual(interfaceFields(code(SERVICE), "HostCandidateRow"), [
    "requestId: number",
    "requestNo: string | null",
    "departDate: string | null",
    "returnDate: string | null",
    // A bare name — never the coordinates, which the picker does not draw and
    // which migration 135 attaches to the host's own work location.
    "workLocations: string[]",
  ]);
});

/**
 * `RoomShareView` is what a guest is told about their own binding, and it must
 * not become a second, wider shape for the same host. Its `host` is typed as
 * `HostCandidateRow` precisely so the test above governs it too.
 */
test("RoomShareView adds only the binding itself, and reuses HostCandidateRow for the host", () => {
  const src = code(SERVICE);
  assert.deepEqual(interfaceFields(src, "RoomShareView"), [
    "guestRequestId: number",
    "hostStaffId: number | null",
    "host: HostCandidateRow",
  ]);
  assert.match(
    src,
    /host\s*:\s*HostCandidateRow\s*;/,
    "RoomShareView.host must stay typed as HostCandidateRow — an inline object type here " +
      "would be a second host shape the field allow-list above does not police",
  );
});

/* ─────────────────────────── the columns behind it ─────────────────────────── */

test("the picker's display columns are exactly the four the response needs", () => {
  const src = code(SERVICE);
  assert.deepEqual(columnsOf(src, "HOST_DISPLAY_COLUMNS"), [
    "r.Id",
    "r.RequestNo",
    "t.DepartDate",
    "t.ReturnDate",
  ]);
  assert.deepEqual(columnsOf(src, "HOST_LOCATION_COLUMNS"), ["t.RequestId", "w.Name"]);
});

/**
 * The admission read is a SEPARATE query on purpose, and its columns are
 * separately bounded: it feeds `canHost`, never the response. Widening it is
 * not a leak on its own — nothing maps it into a row — but it is the first half
 * of one, and it is where a `SELECT *` would look harmless.
 */
test("the admission columns stay the four canHost needs", () => {
  assert.deepEqual(columnsOf(code(SERVICE), "CANDIDATE_COLUMNS"), [
    "r.Id",
    "r.RequestNo",
    "r.Status",
    "t.NeedsRoomBooking",
  ]);
});

test("nothing in the room-share service selects *", () => {
  for (const file of [SERVICE, SHARE_ROUTE, HOSTS_ROUTE]) {
    assert.ok(
      !/SELECT\s+(\w+\.)?\*/i.test(code(file)),
      `${path.basename(file)} contains a SELECT * — the picker's shape must come from an ` +
        "explicit column list, which is how a field nobody intended to expose arrives",
    );
  }
});

/**
 * `loadHostDisplayRows` is the only function that builds a `HostCandidateRow`,
 * so every `SELECT` inside it must come from one of the two constants above.
 * A hand-spelled column list here would be a second, unpoliced source of the
 * response — the exact failure `perdiem-source-guard.test.ts` records having
 * been measured on its own subject.
 */
test("every SELECT that feeds the response interpolates a checked column list", () => {
  const body = bodyOf(code(SERVICE), "async function loadHostDisplayRows");
  const selects = body.match(/SELECT[^\n]*/gi) ?? [];
  assert.ok(selects.length >= 2, "expected the display read and the work-location read");
  for (const s of selects) {
    assert.match(
      s,
      /SELECT\s+\$\{HOST_(DISPLAY|LOCATION)_COLUMNS\}/,
      `loadHostDisplayRows spells a column list out instead of interpolating one: ${s.trim()}`,
    );
  }
});

/**
 * Defence in depth, and the stronger half of it: a column the service never
 * *reads* cannot be emitted however the mapping is later rewritten. These are
 * the AP-17 fields spec §6 names, plus the neighbours a careless join would
 * bring with them.
 */
test("the service never names a column the picker must not carry", () => {
  /* ONE carve-out, and it is deliberately the narrowest possible shape.
     `clearGuestOwnAccommodation` (final review I1) is a WRITE to the guest's
     OWN `AccTravelBooking` row, not a read of a colleague's — the invariant
     "a guest books nothing themselves", which until then lived only in a
     React state patch. This list is about what the picker may carry out of
     somebody else's request, and a file-wide `indexOf` cannot tell a write
     from a read.

     So the identifier is stripped — the EXACT identifier, and only after
     asserting it appears exactly twice (the import and the single call), so
     the carve-out cannot quietly grow. Every other occurrence of
     "Accommodation" in this file, `t.AccommodationName` in a SELECT column
     list very much included, still trips the ban below. Renaming the helper
     to dodge the substring was the alternative and was rejected: it would
     leave this list looking intact while meaning less. */
  const raw = code(SERVICE);
  const permitted = raw.match(/clearGuestOwnAccommodation/g) ?? [];
  assert.equal(
    permitted.length,
    2,
    `clearGuestOwnAccommodation appears ${permitted.length} times in room-share-service.ts, ` +
      "not the import plus one call. The carve-out below is sized to exactly those two — a " +
      "third occurrence is a new use nobody has argued for, and it must be argued for here",
  );
  const src = raw.split("clearGuestOwnAccommodation").join("");
  const forbidden = [
    "TotalAmount",
    "ForeignAmount",
    "ExchangeRate",
    "PerDiem",
    "AllowanceSnapshot",
    "PaymentDate",
    "Phone",
    "WorkDetail",
    "Notes",
    "BrandCode",
    "CompanyName",
    "ManagerStaffId",
    "ManagerEmail",
    "Requester",
    "AccRequestFile",
    "AccTravelBookingDetail",
    "IdCard",
    "Accommodation",
  ];
  for (const column of forbidden) {
    assert.ok(
      src.indexOf(column) === -1,
      `room-share-service.ts names "${column}". The picker answers a colleague's running ` +
        "number, dates and work location and nothing else (spec §6) — if this column is " +
        "genuinely needed, that is a change to the spec, not to this list",
    );
  }
});

/* ─────────────────────────── the endpoint's gate ─────────────────────────── */

/**
 * The reach this endpoint grants is bounded by the caller already holding an
 * editable AP-17 request of their own. Deleting the gate leaves a working
 * endpoint that answers every authenticated session — which is exactly the
 * shape of regression this project has measured a green suite against before
 * (`approvals-route-authz-guard.test.ts`, `erp-queue-route-authz-guard.test.ts`).
 */
test("the hosts endpoint gates on an editable request of the caller's own, before it reads", () => {
  const src = code(HOSTS_ROUTE);
  const gate = src.indexOf("await authorizeAccRequest(");
  assert.notEqual(
    gate,
    -1,
    "the hosts endpoint no longer calls authorizeAccRequest — one person listing another " +
      "person's requests is open to every authenticated session without it",
  );
  assert.match(
    src.slice(gate),
    /^await authorizeAccRequest\(\s*session,\s*guestRequestId,\s*"mutate",\s*AP17_FORM_CODE\s*\)/,
    'the gate must be ("mutate", AP17_FORM_CODE) on the caller\'s OWN request',
  );
  assert.match(
    src.slice(gate),
    /if \(gate instanceof Response\) return gate;/,
    "the gate's refusal must be returned, not merely computed",
  );

  const read = src.indexOf("await loadHostableRequests(");
  assert.notEqual(read, -1, "loadHostableRequests is no longer called — has it been renamed?");
  assert.ok(
    gate < read,
    "authorizeAccRequest must run BEFORE a single colleague's row is read",
  );
});

test("all three binding handlers gate before they touch the service", () => {
  const src = code(SHARE_ROUTE);
  const calls: [string, string][] = [
    ["loadRoomShare(", '"read"'],
    ["attachRoomShare(", '"mutate"'],
    ["detachRoomShare(", '"mutate"'],
  ];
  for (const [fn, mode] of calls) {
    const use = src.indexOf(`await ${fn}`);
    assert.notEqual(use, -1, `${fn} is no longer called from the route`);
    const before = src.slice(0, use);
    const gate = before.lastIndexOf("await authorizeAccRequest(");
    assert.notEqual(gate, -1, `${fn} is reached without authorizeAccRequest above it`);
    assert.match(
      src.slice(gate, use),
      new RegExp(`authorizeAccRequest\\(\\s*session,\\s*guestRequestId,\\s*${mode}`),
      `${fn} must be gated with authorizeAccRequest(..., ${mode}, AP17_FORM_CODE)`,
    );
    assert.match(
      src.slice(gate, use),
      /if \(gate instanceof Response\) return gate;/,
      `${fn}'s gate refusal must be returned`,
    );
  }
});

/**
 * The routes must hold no SQL of their own, and must not reach for a wide
 * reader. `getTravelBookingRequest` is the detail read spec §6 names as the
 * thing this endpoint must not become.
 */
test("the routes hold no query of their own and reach for no wide reader", () => {
  for (const file of [SHARE_ROUTE, HOSTS_ROUTE]) {
    const src = code(file);
    assert.ok(
      !/\bSELECT\b/i.test(src) && !/getAccPool\s*\(/.test(src),
      `${path.basename(file)} has grown SQL of its own — every read belongs in the service, ` +
        "where the column lists above police it",
    );
    assert.ok(
      src.indexOf("getTravelBookingRequest") === -1,
      `${path.basename(file)} imports the detail read shape. That is precisely how a field ` +
        "nobody intended to expose arrives by inheritance (spec §6)",
    );
  }
});

/**
 * One success response, carrying the bare `data` the service returned.
 *
 * A second `ok: true` arm, or a spread beside `data`, is how a caller's own
 * extra field joins the payload without touching any column list.
 */
test("the hosts endpoint answers the service's rows and nothing beside them", () => {
  const src = code(HOSTS_ROUTE);
  // Counted on the RESPONSE, not on `ok: true` alone — `parseYmd` answers its
  // own `{ ok: true, value }` and is not a payload.
  const successes = src.match(/NextResponse\.json\(\{\s*ok:\s*true/g) ?? [];
  assert.equal(successes.length, 1, "the hosts endpoint has more than one success response");
  assert.match(
    src,
    /NextResponse\.json\(\{\s*ok:\s*true,\s*data\s*\}\)/,
    "the success response must be the bare `{ ok: true, data }` — anything assembled " +
      "alongside it is outside every check in this file",
  );
});

/* ─────────────────────────── the module's surface ─────────────────────────── */

/**
 * A wide reader added *beside* the narrow one is the case none of the tests
 * above would see: they police `HostCandidateRow` and the two column lists, not
 * a brand-new function with its own. Pinning the export list means such a
 * function cannot be added silently — it fails here, and whoever adds it has to
 * say what it is for.
 */
test("the service exports exactly the surface Task 4 defines", () => {
  const src = code(SERVICE);
  const found: string[] = [];
  const re = /export\s+(?:async\s+function|function|interface|type|const)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) found.push(m[1]);
  found.sort();
  assert.deepEqual(found, [
    "HOST_NOT_FILED_MESSAGE",
    "HostCandidateRow",
    "HostSearchFilters",
    "RoomShareView",
    "attachRoomShare",
    "detachRoomShare",
    "loadGuestsOf",
    "loadHostableRequests",
    "loadRoomShare",
  ]);
});

/* ─────────────────────────── the cascade's loader ─────────────────────────── */

/**
 * `loadGuestsOf` is called by Task 6 from **inside** the transaction that is
 * cancelling or re-dating the host — that is the whole safety property of the
 * cascade (spec §4: if it fails, the host's own cancellation rolls back). A
 * loader that opened its own pool would read from outside that transaction and
 * miss the change it is reacting to, silently.
 */
test("loadGuestsOf takes a runner and opens no pool of its own", () => {
  const src = code(SERVICE);
  assert.match(
    src,
    /export async function loadGuestsOf\(\s*runner:\s*SqlRunner,/,
    "loadGuestsOf must take a SqlRunner (a pool OR an open transaction) as its first " +
      "parameter — the shape perdiem-dependency-load.ts already uses",
  );
  const body = bodyOf(src, "export async function loadGuestsOf");
  assert.ok(
    body.indexOf("getAccPool(") === -1,
    "loadGuestsOf opens its own pool, so the cascade would read the host's guests from " +
      "OUTSIDE the transaction that is changing the host",
  );
});

/**
 * **A list and an action that disagree about what is offerable is the whole
 * hazard here**, so every rule this module adds has to be applied at both
 * sites. `hostHasBeenFiled` is the one condition beyond `canHost`;
 * `requireEditableGuest` is the guest's own `Draft`/`Returned` rule, which
 * Task 2's `canAttach` deliberately does not test and which therefore has no
 * other home.
 */
test("the filed-host rule and the guest editability rule are applied at every site", () => {
  const src = code(SERVICE);
  const sites: [string, string[]][] = [
    ["export async function loadHostableRequests", ["hostHasBeenFiled(", "canHost("]],
    [
      "export async function attachRoomShare",
      ["requireEditableGuest(", "hostHasBeenFiled(", "canAttach("],
    ],
    ["export async function detachRoomShare", ["requireEditableGuest("]],
  ];
  for (const [decl, calls] of sites) {
    const body = bodyOf(src, decl);
    for (const call of calls) {
      assert.ok(
        body.indexOf(call) !== -1,
        `${decl.replace("export async function ", "")} no longer calls ${call} — the picker ` +
          "and the attach must apply the same rules or one of them is decoration",
      );
    }
  }
});

/**
 * **Final review I1.** "A guest books nothing themselves" (spec §1) was
 * enforced by `TravelBookingTab.tsx`'s `onAttached` patch and by nothing
 * else, so a reload between the attach and the next save restored the
 * accommodation from the server — into a grid that `isRoomShareGuest` hides,
 * where the requester could neither see nor clear it — and the next save
 * posted it back, `deriveBookingFlags` set `NeedsRoomBooking`, and
 * `approveByManager` routed the request to `ADMIN` for a room nobody needed.
 *
 * Both halves are asserted, because each fails differently: the call missing
 * is the invariant back in the browser, and the call after `tx.commit()` is
 * the binding surviving a failed clear — the same half-state, reached by a
 * crash instead of by a reload.
 */
test("the attach clears the guest's own accommodation, inside its own transaction", () => {
  const body = bodyOf(code(SERVICE), "export async function attachRoomShare");
  const clear = body.indexOf("clearGuestOwnAccommodation(tx");
  assert.notEqual(
    clear,
    -1,
    "attachRoomShare no longer calls clearGuestOwnAccommodation(tx, …). The guest's own " +
      "AccommodationId/NeedsRoomBooking survive the attach, the grid that would show them is " +
      "hidden, and the next save hands the Admin desk a hotel room to book for somebody who " +
      "is sharing one — a client-side state patch is not an invariant",
  );
  const commit = body.indexOf("tx.commit()");
  assert.notEqual(commit, -1, "attachRoomShare no longer commits — has it been restructured?");
  assert.ok(
    clear < commit,
    "clearGuestOwnAccommodation runs after the commit, so a failure leaves the binding " +
      "recorded and the accommodation live. They must stand or fall together",
  );
});

/**
 * The same three conditions in two places is how a list and an action drift
 * apart. Spec §6's "alive, not already a guest, needsRoomBooking = true" is
 * `canHost`'s, and the service must ask it rather than re-express it in SQL —
 * where the attach path could not ask the same question.
 */
test("hostability is decided by canHost, not re-expressed as SQL", () => {
  const src = code(SERVICE);
  assert.match(src, /canHost\(candidate\)\s*!==\s*null/, "the listing no longer filters on canHost");
  assert.match(src, /canAttach\(guest,\s*host\)/, "the attach no longer re-checks canAttach");
  for (const sqlish of ["NeedsRoomBooking = 1", "Status NOT IN", "Status <> 'Cancelled'"]) {
    assert.ok(
      src.indexOf(sqlish) === -1,
      `the service re-expresses part of canHost as SQL ("${sqlish}"), which the attach path ` +
        "cannot ask and so cannot agree with",
    );
  }
});
