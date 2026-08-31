import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOOKING_BRAND_SCOPE_ERROR,
  bookingBrandScope,
  canActOnBookingBrand,
  filterRowsForBookingBrandAccess,
  normalizeBrandCode,
  normalizeBrandCodes,
} from "./booking-brand-access-shared";

/**
 * Who may see which brand's AP-17 requests.
 *
 * The default direction matters more than anything else here: **no rows means
 * every brand**. This narrows a permission the four people on the roster already
 * have, unlike AP-17's tab grants which hand out something new — so an empty
 * table on deploy day must change nothing, not blind everybody.
 */

const ALL = { allAccess: true, allowedCodes: [] };
const SCOPED = { allAccess: false, allowedCodes: ["KSI"] };
/** What a non-approver resolves to: scoped, with nothing in scope. */
const NOTHING = { allAccess: false, allowedCodes: [] };

/* ── normalisation ────────────────────────────────────────────────────── */

test("a code is trimmed and upper-cased", () => {
  assert.equal(normalizeBrandCode(" ksi "), "KSI");
  assert.equal(normalizeBrandCode("PCTH"), "PCTH");
  assert.equal(normalizeBrandCode(null), "");
  assert.equal(normalizeBrandCode(undefined), "");
  assert.equal(normalizeBrandCode("   "), "");
});

test("a list is normalised, de-duplicated, sorted, and drops blanks", () => {
  assert.deepEqual(normalizeBrandCodes([" ksi ", "PCTH", "ksi", "", "  "]), ["KSI", "PCTH"]);
  assert.deepEqual(normalizeBrandCodes([]), []);
});

/* ── the scope ────────────────────────────────────────────────────────── */

test("no rows is every brand", () => {
  assert.deepEqual(bookingBrandScope(ALL), { kind: "all" });
});

/**
 * THE UNREPRESENTABLE STATE. A scoped actor with nothing in scope must never
 * become `{kind:"codes", codes: []}` — a caller building SQL from that emits
 * `IN ()`, which is a syntax error, and a caller writing
 * `codes.length === 0 ? allow : filter` turns an empty scope into full access.
 * Making it a distinct kind is what stops both.
 */
test("a scoped actor with nothing in scope is 'none', never empty codes", () => {
  const scope = bookingBrandScope(NOTHING);
  assert.deepEqual(scope, { kind: "none" });
  assert.equal((scope as { kind: string; codes?: string[] }).codes, undefined);
});

test("a scoped actor with brands lists them, normalised", () => {
  assert.deepEqual(bookingBrandScope({ allAccess: false, allowedCodes: [" ksi ", "KSI", "pcth"] }), {
    kind: "codes",
    codes: ["KSI", "PCTH"],
  });
});

/* ── acting on one request ────────────────────────────────────────────── */

test("an unscoped actor may act on any brand", () => {
  assert.equal(canActOnBookingBrand(ALL, "KSI"), true);
  assert.equal(canActOnBookingBrand(ALL, "PCTH"), true);
});

test("a scoped actor may act only on their own brands", () => {
  assert.equal(canActOnBookingBrand(SCOPED, "KSI"), true);
  assert.equal(canActOnBookingBrand(SCOPED, " ksi "), true);
  assert.equal(canActOnBookingBrand(SCOPED, "PCTH"), false);
});

/**
 * A request with no brand is the case that decides whether this is a real
 * control. Measured 2026-08-31, one AP-17 request in the UAT database has
 * BrandCode NULL — a draft saved before the brand became required — so this is
 * not theoretical. A scoped actor is refused it: an unbranded request cannot be
 * shown to belong to their brand.
 */
test("a request with no brand is refused while scoped and allowed while not", () => {
  for (const blank of [null, undefined, "", "   "]) {
    assert.equal(canActOnBookingBrand(SCOPED, blank), false, `scoped should refuse: ${String(blank)}`);
    assert.equal(canActOnBookingBrand(ALL, blank), true, `unscoped should allow: ${String(blank)}`);
  }
});

/**
 * Scoped with nothing in scope refuses everything, and must never be read as
 * "unrestricted". That is what a non-approver resolves to.
 */
test("scoped-with-nothing refuses every brand, including a blank one", () => {
  for (const c of ["KSI", "PCTH", null, ""]) {
    assert.equal(canActOnBookingBrand(NOTHING, c), false, `should refuse: ${String(c)}`);
  }
});

/* ── filtering a list ─────────────────────────────────────────────────── */

const ROWS = [
  { id: 1, brandCode: "KSI" },
  { id: 2, brandCode: "PCTH" },
  { id: 3, brandCode: null },
  { id: 4, brandCode: " ksi " },
];

test("an unscoped actor sees everything, including the unbranded row", () => {
  assert.deepEqual(
    filterRowsForBookingBrandAccess(ROWS, ALL).map((r) => r.id),
    [1, 2, 3, 4],
  );
});

test("a scoped actor sees only their brands, and not the unbranded row", () => {
  assert.deepEqual(
    filterRowsForBookingBrandAccess(ROWS, SCOPED).map((r) => r.id),
    [1, 4],
  );
});

test("scoped-with-nothing sees nothing at all", () => {
  assert.deepEqual(filterRowsForBookingBrandAccess(ROWS, NOTHING), []);
});

test("filtering does not disturb the input", () => {
  const snapshot = JSON.stringify(ROWS);
  filterRowsForBookingBrandAccess(ROWS, SCOPED);
  assert.equal(JSON.stringify(ROWS), snapshot);
});

/** The refusal names no brand: an actor scoped out of a request should not learn whose it is. */
test("the refusal message does not name a brand", () => {
  assert.ok(BOOKING_BRAND_SCOPE_ERROR.length > 0);
  for (const code of ["KSI", "PCTH", "PCMY", "UNO"]) {
    assert.equal(BOOKING_BRAND_SCOPE_ERROR.indexOf(code), -1);
  }
});
