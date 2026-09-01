import { test } from "node:test";
import assert from "node:assert/strict";
import { cityNameFromPlace, matchProvinceOption } from "./province-match";

/**
 * A city picked from Google is matched against the managed จังหวัด/เมือง list
 * before it is stored.
 *
 * A hit stores the row's id, and the request keeps its place in the report's
 * by-province filter. A miss stores the typed name — still recorded, still on
 * the report, just outside that filter. So a match that is too eager is worse
 * than one that is too shy: it files a trip under a place it did not go to, and
 * nothing on any screen contradicts it.
 */

const OPTIONS = [
  { id: 1, nameTh: "เชียงใหม่", nameEn: "Chiang Mai" },
  { id: 2, nameTh: "กรุงเทพมหานคร", nameEn: "Bangkok" },
  { id: 3, nameTh: "ลอนดอน", nameEn: "London" },
  { id: 4, nameTh: "น่าน", nameEn: "Nan" },
];

/* ── extracting the city from what Google hands back ──────────────────── */

test("the main text is the city, the secondary is where it is", () => {
  assert.equal(cityNameFromPlace("Chiang Mai", "Thailand"), "Chiang Mai");
  assert.equal(cityNameFromPlace("ลอนดอน", "สหราชอาณาจักร"), "ลอนดอน");
});

test("a blank main text falls back to the whole label", () => {
  assert.equal(cityNameFromPlace("", "London, UK"), "London, UK");
  assert.equal(cityNameFromPlace(null, "London, UK"), "London, UK");
});

test("nothing usable is null, never an empty name", () => {
  assert.equal(cityNameFromPlace(null, null), null);
  assert.equal(cityNameFromPlace("  ", "  "), null);
});

/* ── matching ─────────────────────────────────────────────────────────── */

test("an exact Thai or English name matches", () => {
  assert.equal(matchProvinceOption("เชียงใหม่", OPTIONS)?.id, 1);
  assert.equal(matchProvinceOption("Chiang Mai", OPTIONS)?.id, 1);
  assert.equal(matchProvinceOption("London", OPTIONS)?.id, 3);
});

test("case and surrounding space do not matter", () => {
  assert.equal(matchProvinceOption("  chiang mai  ", OPTIONS)?.id, 1);
  assert.equal(matchProvinceOption("BANGKOK", OPTIONS)?.id, 2);
});

/**
 * Google hands back comma-separated text in two shapes and the province is at a
 * different end of each:
 *
 *   a city suggestion's own text  → "Bangkok, Thailand"        (province FIRST)
 *   a venue's secondary text      → "ถ.พระรามที่ 4, กรุงเทพมหานคร" (province LAST)
 *
 * So every segment is tried, each still compared whole. Trying only the first —
 * which is what this did until the venue case was traced — matched nothing for
 * any real place, because the first segment there is a road.
 */
test("a comma-separated label matches on any of its segments", () => {
  assert.equal(matchProvinceOption("Bangkok, Thailand", OPTIONS)?.id, 2);
  assert.equal(matchProvinceOption("London, United Kingdom", OPTIONS)?.id, 3);
  assert.equal(matchProvinceOption("ถ.พระรามที่ 4, กรุงเทพมหานคร", OPTIONS)?.id, 2);
  assert.equal(matchProvinceOption("123 Nimman Rd, Chiang Mai, Thailand", OPTIONS)?.id, 1);
});

/** Segments are still whole names — a segment that merely contains one is not a match. */
test("a segment is compared whole, not searched", () => {
  assert.equal(matchProvinceOption("Greater London Authority, England", OPTIONS), null);
  assert.equal(matchProvinceOption("Nantes, France", OPTIONS), null);
});

test("somewhere the list does not have matches nothing", () => {
  assert.equal(matchProvinceOption("Osaka", OPTIONS), null);
  assert.equal(matchProvinceOption("โอซาก้า", OPTIONS), null);
});

/**
 * THE ONE THAT MUST NOT MATCH. A substring rule would file a trip to
 * Londonderry under London, and the report would then count it as a London
 * trip. Only whole names count.
 */
test("a near-miss is not a match", () => {
  assert.equal(matchProvinceOption("Londonderry", OPTIONS), null);
  assert.equal(matchProvinceOption("New London", OPTIONS), null);
  assert.equal(matchProvinceOption("Nantes", OPTIONS), null);
  assert.equal(matchProvinceOption("เชียงใหม่เหนือ", OPTIONS), null);
});

test("blank matches nothing", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.equal(matchProvinceOption(v, OPTIONS), null);
  }
});

test("an empty list matches nothing and does not throw", () => {
  assert.equal(matchProvinceOption("Bangkok", []), null);
});

/** A row with no English name must not make every blank query match it. */
test("a row missing its English name is skipped rather than matching blank", () => {
  const opts = [{ id: 9, nameTh: "ตราด", nameEn: null }];
  assert.equal(matchProvinceOption("", opts), null);
  assert.equal(matchProvinceOption("Trat", opts), null);
  assert.equal(matchProvinceOption("ตราด", opts)?.id, 9);
});
