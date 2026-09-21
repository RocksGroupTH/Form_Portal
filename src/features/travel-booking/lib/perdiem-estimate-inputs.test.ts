import { test } from "node:test";
import assert from "node:assert/strict";
import { continuationFlags } from "@/lib/acc/travel-booking/continuation-chain";
import { buildEstimateChainTrips, moneyWithheldForRoom } from "./perdiem-estimate-inputs";

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
    [{ requestId: 900001, departDate: "2026-08-01", returnDate: "2026-08-03" }],
  );
  assert.ok(chain.every((t) => t.alive));
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
    [{ requestId: 900001, departDate: "2026-09-01", returnDate: "2026-09-06" }],
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
