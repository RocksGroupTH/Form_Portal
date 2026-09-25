import { test } from "node:test";
import assert from "node:assert/strict";
import { wideCardStyle, WIDE_INSET } from "./wide-card-width";

test("narrow mode asks for no style at all", () => {
  assert.equal(wideCardStyle(false, 1440), undefined);
});

test("a widened card is the viewport less an inset on each side", () => {
  const s = wideCardStyle(true, 1440);
  assert.equal(s?.width, 1440 - WIDE_INSET * 2);
});

/* The card sits inside a narrower page column, so widening it is not enough —
   it has to be pulled back to the viewport's left edge. Half the difference,
   expressed from the card's own centre. */
test("a widened card is centred on the viewport, not on its column", () => {
  const s = wideCardStyle(true, 1440);
  assert.equal(s?.marginLeft, `calc(50% - ${(1440 - WIDE_INSET * 2) / 2}px)`);
});

/* Null is what the measuring effect reports before its first measurement.
   Styling on it would jump the card to zero width for one frame. */
test("no measurement yet is the same as narrow", () => {
  assert.equal(wideCardStyle(true, null), undefined);
});

/* A viewport narrower than the insets would ask for a negative width, which
   renders as a collapsed card rather than an error. */
test("a viewport too narrow for the insets stays narrow", () => {
  assert.equal(wideCardStyle(true, WIDE_INSET * 2), undefined);
  assert.equal(wideCardStyle(true, 10), undefined);
});
