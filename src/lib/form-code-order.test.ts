import { test } from "node:test";
import assert from "node:assert/strict";
import { compareFormCodes, parseFormCode, sortByFormCode } from "./form-code-order";
// Relative, not "@/": tsx does not resolve the alias for a bare test run.
import { REQUEST_CARDS } from "./constants";

test("the live forms come out AP-1, AP-4, AP-17", () => {
  // The whole point: a plain string sort gives AP-1, AP-17, AP-4.
  const sorted = sortByFormCode(["AP-1", "AP-17", "AP-4"], (c) => c);
  assert.deepEqual(sorted, ["AP-1", "AP-4", "AP-17"]);
  assert.deepEqual(["AP-1", "AP-17", "AP-4"].slice().sort(), ["AP-1", "AP-17", "AP-4"]);
});

test("the number is compared as a number, not a string", () => {
  assert.ok(compareFormCodes("AP-4", "AP-17") < 0);
  assert.ok(compareFormCodes("AP-17", "AP-4") > 0);
  assert.ok(compareFormCodes("AP-2", "AP-10") < 0);
  assert.ok(compareFormCodes("AP-100", "AP-99") > 0);
  assert.equal(compareFormCodes("AP-4", "AP-4"), 0);
});

test("a different prefix never interleaves", () => {
  const sorted = sortByFormCode(["HR-2", "AP-17", "AP-1", "HR-10"], (c) => c);
  assert.deepEqual(sorted, ["AP-1", "AP-17", "HR-2", "HR-10"]);
});

test("the prefix compares case-insensitively", () => {
  assert.equal(compareFormCodes("ap-4", "AP-4"), 0);
  assert.ok(compareFormCodes("ap-4", "AP-17") < 0);
});

test("surrounding whitespace is tolerated", () => {
  assert.equal(compareFormCodes(" AP-4 ", "AP-4"), 0);
});

test("anything unparseable sorts last and keeps its own order", () => {
  // The real shape: cards, where the *code* is missing or odd but the element
  // itself is an object. Relative order among them is the source order.
  const cards = [
    { id: "booking", badge: "AP-17" },
    { id: "general", badge: "General" },
    { id: "travel", badge: "AP-1" },
    { id: "nameless", badge: undefined },
    { id: "odd", badge: "AP-4x" },
  ];
  assert.deepEqual(
    sortByFormCode(cards, (c) => c.badge).map((c) => c.id),
    ["travel", "booking", "general", "nameless", "odd"],
  );
});

test("a literally undefined element is the one thing order cannot be promised for", () => {
  // Array.prototype.sort moves undefined *elements* to the end without ever
  // calling the comparator — a spec rule, not something this module decides.
  // It costs nothing in practice: callers sort card objects and read the code
  // off a field, so the element is never undefined. Pinned so a future reader
  // measuring this behaviour finds it already known.
  const sorted = sortByFormCode(["AP-17", undefined, "AP-1"], (c) => c);
  assert.deepEqual(sorted, ["AP-1", "AP-17", undefined]);
});

test("parseFormCode answers null rather than guessing", () => {
  assert.equal(parseFormCode("AP"), null);
  assert.equal(parseFormCode("AP-"), null);
  assert.equal(parseFormCode("-4"), null);
  assert.equal(parseFormCode("AP-4.5"), null);
  assert.equal(parseFormCode("AP--4"), null);
  assert.equal(parseFormCode(""), null);
  assert.equal(parseFormCode(null), null);
  assert.equal(parseFormCode(undefined), null);
  assert.deepEqual(parseFormCode("AP-17"), { prefix: "AP", number: 17 });
});

test("the source list is never reordered in place", () => {
  // Callers pass module constants; sorting one in place would reorder it for
  // every other importer, at import time, for the life of the process.
  const source = Object.freeze(["AP-17", "AP-1", "AP-4"]);
  const sorted = sortByFormCode(source, (c) => c);
  assert.deepEqual(source, ["AP-17", "AP-1", "AP-4"]);
  assert.deepEqual(sorted, ["AP-1", "AP-4", "AP-17"]);
  assert.notEqual(sorted, source);
});

test("sorting objects keys off whatever field carries the code", () => {
  const cards = [
    { id: "booking", badge: "AP-17" },
    { id: "reimburse", badge: "AP-4" },
    { id: "travel", badge: "AP-1" },
  ];
  assert.deepEqual(
    sortByFormCode(cards, (c) => c.badge).map((c) => c.id),
    ["travel", "reimburse", "booking"],
  );
});

/* ── the surfaces this exists for ── */

test("every Request hub group comes out in ascending form-number order", () => {
  // `src/app/(dashboard)/request/page.tsx` groups REQUEST_CARDS by `group`
  // and sorts each group through sortByFormCode; `?group=Settings` is the
  // Accounting Admin view. Asserted as a property rather than a literal list,
  // so this says the same true thing whichever forms are live on the branch.
  for (const group of ["Accounting", "Settings"]) {
    const cards = REQUEST_CARDS.filter((c) => c.group === group);
    assert.ok(cards.length >= 2, group + " has too few cards to order");

    const sorted = sortByFormCode(cards, (c) => c.badge);
    assert.equal(sorted.length, cards.length, group + " lost or gained a card");

    const shown = sorted.map((c) => c.badge).join(", ");
    for (let i = 1; i < sorted.length; i++) {
      const prev = parseFormCode(sorted[i - 1].badge);
      const here = parseFormCode(sorted[i].badge);
      assert.ok(prev && here, group + ": " + shown);
      // Non-decreasing, not strictly ascending: a form can carry more than one
      // card in the same group (AP-17 has two Settings cards — its admin hub
      // and its accounting sign-off queue), and `compareFormCodes` already
      // defines equal codes as a tie (see "the number is compared as a number"
      // above), preserved in source order by the stable sort. What this test
      // must never allow is a *later* card sorting before an *earlier* one's
      // number, which `<=` still catches.
      assert.ok(prev.number <= here.number, group + ": " + shown);
    }
  }
});

test("every Request hub card carries a parseable form code", () => {
  // Not a style rule: a card without one sorts to the end of its group, so
  // adding a form and forgetting the badge puts it somewhere nobody chose.
  for (const card of REQUEST_CARDS) {
    assert.notEqual(parseFormCode(card.badge), null, card.id);
  }
});
