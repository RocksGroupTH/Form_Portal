import { test } from "node:test";
import assert from "node:assert/strict";
import { orderBrandCodesForSave } from "./brand-order";

const MASTER = ["ROCKS", "PCTH", "PCMY", "KSI", "UNO", "PLM", "SMR"];

test("the saved order is the order the panel shows, not the order boxes were ticked", () => {
  // A Set iterates in insertion order, so ticking PCTH and then ROCKS used to
  // post ["PCTH","ROCKS"] and store SortOrder 0,1 in that order — which the
  // AP-4 form then rendered, disagreeing with the settings page above it.
  const ticked = new Set<string>();
  ticked.add("PCTH");
  ticked.add("ROCKS");
  assert.deepEqual(orderBrandCodesForSave(ticked, MASTER), ["ROCKS", "PCTH"]);
});

test("ticking in display order already agrees, and stays put", () => {
  assert.deepEqual(orderBrandCodesForSave(["ROCKS", "PCTH"], MASTER), ["ROCKS", "PCTH"]);
});

test("every ticked code survives — this list is the complete active set", () => {
  // setFormBrands deactivates everything absent from what it is handed, so a
  // code dropped here is a brand silently switched off.
  const ticked = ["SMR", "KSI", "ROCKS", "PLM", "PCMY", "UNO", "PCTH"];
  const out = orderBrandCodesForSave(ticked, MASTER);
  assert.deepEqual(out.slice().sort(), ticked.slice().sort());
  assert.deepEqual(out, MASTER);
});

test("a code the brand master does not carry is kept, and sorts last", () => {
  // An orphan: granted once, since removed from the master. It has no row on
  // the settings grid, so it has no display position — but it is still in the
  // posted set, and dropping it would deactivate a brand nobody asked to touch.
  assert.deepEqual(
    orderBrandCodesForSave(["OLDCO", "PCTH"], MASTER),
    ["PCTH", "OLDCO"],
  );
});

test("two orphans keep the order they arrived in", () => {
  assert.deepEqual(
    orderBrandCodesForSave(["ZZZ", "AAA", "ROCKS"], MASTER),
    ["ROCKS", "ZZZ", "AAA"],
  );
});

test("nothing ticked posts nothing, rather than the whole master", () => {
  assert.deepEqual(orderBrandCodesForSave([], MASTER), []);
});

test("an unreadable master leaves the ticks in the order they came", () => {
  // `allBrands` is [] when its fetch fails. Reordering against an empty list
  // must be a no-op, not a reshuffle.
  assert.deepEqual(orderBrandCodesForSave(["PCTH", "ROCKS"], []), ["PCTH", "ROCKS"]);
});

/* ── the read side: what AP-4's picker renders ── */

import { orderBrandsForDisplay } from "./brand-order";

/** Only the fields the orderer reads; the real rows carry a logo and currencies too. */
const opt = (brandCode: string) => ({ brandCode, brandName: brandCode });

test("the picker follows the brand master, not the stored SortOrder", () => {
  // Measured 2026-09-10: AccFormBrand holds AP-4 as PCTH(SortOrder=0),
  // ROCKS(1) — the order somebody happened to tick the boxes in, which is the
  // only thing SortOrder has ever recorded, since no screen lets an admin
  // choose one. The settings grid renders the master's order, so that is the
  // order a human has actually seen.
  assert.deepEqual(
    orderBrandsForDisplay([opt("PCTH"), opt("ROCKS")], ["ROCKS", "PCTH", "PCMY"]).map((b) => b.brandCode),
    ["ROCKS", "PCTH"],
  );
});

test("no allowed brand is dropped, whatever the master says", () => {
  const allowed = [opt("KSI"), opt("ROCKS"), opt("PCTH")];
  const out = orderBrandsForDisplay(allowed, ["ROCKS", "PCTH", "PCMY", "KSI"]);
  assert.deepEqual(out.map((b) => b.brandCode), ["ROCKS", "PCTH", "KSI"]);
  assert.equal(out.length, allowed.length);
});

test("a brand the master no longer carries still reaches the picker, last", () => {
  // A claim already saved against it must still find it in the list, or the
  // form silently re-points the request at another company.
  assert.deepEqual(
    orderBrandsForDisplay([opt("OLDCO"), opt("PCTH")], ["ROCKS", "PCTH"]).map((b) => b.brandCode),
    ["PCTH", "OLDCO"],
  );
});

test("an empty master leaves the allowed list exactly as it came", () => {
  // listAllBrands() can answer nothing — Rocks_Codex unreachable. Reordering
  // against nothing must be a no-op, never a reshuffle or a truncation.
  assert.deepEqual(
    orderBrandsForDisplay([opt("PCTH"), opt("ROCKS")], []).map((b) => b.brandCode),
    ["PCTH", "ROCKS"],
  );
});
