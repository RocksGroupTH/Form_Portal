import { test } from "node:test";
import assert from "node:assert/strict";
import { continuationFlags } from "@/lib/acc/travel-booking/continuation-chain";
import {
  buildEstimateChainTrips,
  estimateContinuationSources,
  moneyWithheldForRoom,
} from "./perdiem-estimate-inputs";

/* ── buildEstimateChainTrips ── */

test("an unsaved tab gets a synthetic negative id, distinct from every real one", () => {
  const chain = buildEstimateChainTrips(
    [{ departDate: "2026-09-20", returnDate: "2026-09-22" }],
    [],
  );
  assert.equal(chain.length, 1);
  assert.ok(chain[0].requestId < 0);
});

test("a saved tab keeps its real AccRequest.Id", () => {
  const chain = buildEstimateChainTrips(
    [{ id: 12345, departDate: "2026-09-20", returnDate: "2026-09-22" }],
    [],
  );
  assert.equal(chain[0].requestId, 12345);
});

test("own tabs get their array index as sortOrder — parity with request-service.ts's own chainTrips", () => {
  const chain = buildEstimateChainTrips(
    [
      { departDate: "2026-09-01", returnDate: "2026-09-02" },
      { id: 500, departDate: "2026-09-10", returnDate: "2026-09-12" },
    ],
    [],
  );
  assert.equal(chain[0].sortOrder, 0);
  assert.equal(chain[1].sortOrder, 1);
});

test("every trip in the chain is marked alive — otherTrips is already alive-filtered upstream", () => {
  const chain = buildEstimateChainTrips(
    [{ departDate: "2026-09-01", returnDate: "2026-09-02" }],
    [{ requestId: 900001, requestNo: null, departDate: "2026-08-01", returnDate: "2026-08-03", sortOrder: 0 }],
  );
  assert.ok(chain.every((t) => t.alive));
});

/**
 * Task 8 fix round 1: the requester's OTHER trips now carry their real
 * `AccTravelBooking.SortOrder` (from the widened
 * `/api/request/travel-booking/date-ranges`), not a `requestId` stand-in —
 * so the value on the chain must be the real column, and must NOT equal the
 * request id it came with (a coincidence that would hide a regression back
 * to the old stand-in).
 */
test("an other trip's real SortOrder lands on the chain, not its requestId", () => {
  const chain = buildEstimateChainTrips(
    [],
    [{ requestId: 900050, requestNo: null, departDate: "2026-09-01", returnDate: "2026-09-03", sortOrder: 4 }],
  );
  assert.equal(chain[0].sortOrder, 4);
  assert.notEqual(chain[0].sortOrder, chain[0].requestId);
});

/**
 * The whole point of Task 8's Step 2: a trip filed last week (an "other
 * trip", already saved under a different request) whose return date meets
 * THIS form's own tab's depart date must still be seen as a continuation —
 * the private `tabs[i - 1]` look-back this replaces could never see it,
 * because it only ever looked at this form's own previous tab.
 */
test("an other (already-saved) trip's return date feeding this tab's depart date is a continuation", () => {
  const chain = buildEstimateChainTrips(
    [{ departDate: "2026-09-06", returnDate: "2026-09-08" }],
    [{ requestId: 900001, requestNo: null, departDate: "2026-09-01", returnDate: "2026-09-06", sortOrder: 0 }],
  );
  const flags = continuationFlags(chain);
  const ownTripId = chain.find((t) => t.requestId < 0)!.requestId;
  assert.equal(flags.get(ownTripId), true);
});

test("with no other trips touching it, an own tab's continuation still comes from the previous own tab", () => {
  const chain = buildEstimateChainTrips(
    [
      { departDate: "2026-09-01", returnDate: "2026-09-03" },
      { departDate: "2026-09-03", returnDate: "2026-09-05" },
    ],
    [],
  );
  const flags = continuationFlags(chain);
  const [first, second] = chain;
  assert.equal(flags.get(first.requestId), false);
  assert.equal(flags.get(second.requestId), true);
});

/* ── moneyWithheldForRoom ── */

test("no accommodation chosen yet withholds the money", () => {
  assert.equal(moneyWithheldForRoom(null, false), true);
});

test("a chosen accommodation that needs no room booking withholds the money", () => {
  assert.equal(moneyWithheldForRoom(7, false), true);
});

test("a chosen accommodation that needs a room booking does not withhold the money", () => {
  assert.equal(moneyWithheldForRoom(7, true), false);
});

/* ── estimateContinuationSources ── */

const OTHER = (requestId: number, requestNo: string | null, departDate: string, returnDate: string) =>
  ({ requestId, requestNo, departDate, returnDate, sortOrder: 0 });

test("a tab that continues nothing reports no source", () => {
  const sources = estimateContinuationSources(
    [{ departDate: "2026-09-20", returnDate: "2026-09-22" }],
    [],
  );
  assert.deepEqual(sources, [{ kind: "none" }]);
});

test("a tab continuing one of the requester's other requests names that request's number", () => {
  const sources = estimateContinuationSources(
    [{ departDate: "2026-09-24", returnDate: "2026-09-26" }],
    [OTHER(900, "TRL26-09007", "2026-09-20", "2026-09-24")],
  );
  assert.deepEqual(sources, [{ kind: "request", requestNo: "TRL26-09007" }]);
});

test("a tab continuing a SIBLING tab reports a sibling, never a number — a tab in this group has no running number until submit", () => {
  const sources = estimateContinuationSources(
    [
      { departDate: "2026-09-20", returnDate: "2026-09-24" },
      { departDate: "2026-09-24", returnDate: "2026-09-26" },
    ],
    [],
  );
  assert.deepEqual(sources, [{ kind: "none" }, { kind: "sibling" }]);
});

test("a SAVED sibling tab is still a sibling — a Draft carries an AccRequest.Id but no RequestNo", () => {
  const sources = estimateContinuationSources(
    [
      { id: 401, departDate: "2026-09-20", returnDate: "2026-09-24" },
      { id: 402, departDate: "2026-09-24", returnDate: "2026-09-26" },
    ],
    [],
  );
  assert.deepEqual(sources[1], { kind: "sibling" });
});

test("an other trip whose running number is missing still reports the request kind, with a null number", () => {
  const sources = estimateContinuationSources(
    [{ departDate: "2026-09-24", returnDate: "2026-09-26" }],
    [OTHER(900, null, "2026-09-20", "2026-09-24")],
  );
  assert.deepEqual(sources, [{ kind: "request", requestNo: null }]);
});

test("the source agrees with continuationFlags — a tab with a source is exactly a tab flagged as a continuation", () => {
  const tabs = [
    { departDate: "2026-09-24", returnDate: "2026-09-26" },
    { departDate: "2026-10-10", returnDate: "2026-10-11" },
  ];
  const others = [OTHER(900, "TRL26-09007", "2026-09-20", "2026-09-24")];
  const sources = estimateContinuationSources(tabs, others);
  const flags = continuationFlags(buildEstimateChainTrips(tabs, others));
  const chain = buildEstimateChainTrips(tabs, others);
  for (let i = 0; i < tabs.length; i++) {
    assert.equal(sources[i].kind !== "none", flags.get(chain[i].requestId) === true);
  }
});
