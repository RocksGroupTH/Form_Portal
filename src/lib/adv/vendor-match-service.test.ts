import assert from "node:assert/strict";
import { test } from "node:test";
import { runRequesterCodeMatch } from "./vendor-match-core";

/**
 * One rule, and it is deliberately blunt: the vendor comes from the requester's
 * staff code on a vendor's Home Page, or it does not come at all. The payee's
 * name is not an input any more, and neither is an LLM.
 */

const found = { kind: "found" as const, vendor: { vendorNo: "ADV0080", displayName: "นายภาสพงษ์ พิษณุพจน์" } };

test("one vendor carries the code → suggested, never confirmed", async () => {
  const r = await runRequesterCodeMatch(10177, async () => found);
  assert.equal(r.status, "suggested");
  assert.equal(r.vendorNo, "ADV0080");
  assert.equal(r.confidence, "high");
  assert.match(r.reason ?? "", /10177/);
});

test("the payee type is not consulted — a คู่ค้า advance still matches the requester", async () => {
  // The signature no longer takes a payee type at all, which is the point: an
  // advance paid out to a vendor is still owed by the person who requested it.
  const r = await runRequesterCodeMatch(10177, async () => found);
  assert.equal(r.vendorNo, "ADV0080");
});

test("no vendor carries the code → none, and the reason says what to fix", async () => {
  const r = await runRequesterCodeMatch(10177, async () => ({ kind: "none" }));
  assert.equal(r.status, "none");
  assert.equal(r.vendorNo, null);
  assert.match(r.reason ?? "", /Home Page/);
});

test("two vendors on one code refuses rather than picking one", async () => {
  const r = await runRequesterCodeMatch(10177, async () => ({ kind: "ambiguous" }));
  assert.equal(r.status, "none");
  assert.equal(r.vendorNo, null);
  assert.match(r.reason ?? "", /มากกว่าหนึ่ง/);
});

test("no staff id → none, without touching the lookup", async () => {
  const r = await runRequesterCodeMatch(null, async () => {
    throw new Error("must not look anything up without a staff id");
  });
  assert.equal(r.status, "none");
  assert.equal(r.vendorNo, null);
});

test("every unmatched case carries a reason the officer can act on", async () => {
  // A blank cell with no explanation is the thing this rule trades away
  // matching rate for; it must not also be silent.
  for (const lookup of [{ kind: "none" as const }, { kind: "ambiguous" as const }]) {
    const r = await runRequesterCodeMatch(10177, async () => lookup);
    assert.ok((r.reason ?? "").length > 0, `${lookup.kind} must explain itself`);
  }
  const noId = await runRequesterCodeMatch(null, async () => ({ kind: "none" }));
  assert.ok((noId.reason ?? "").length > 0);
});
