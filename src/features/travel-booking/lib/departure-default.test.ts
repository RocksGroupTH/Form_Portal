import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDeparturePlace } from "./departure-default";

test("an empty field takes the default", () => {
  assert.equal(
    nextDeparturePlace({ current: "", appliedDefault: null, nextDefault: "กรุงเทพมหานคร" }),
    "กรุงเทพมหานคร",
  );
});

test("a blank-looking field counts as empty", () => {
  assert.equal(
    nextDeparturePlace({ current: "   ", appliedDefault: null, nextDefault: "เชียงใหม่" }),
    "เชียงใหม่",
  );
  assert.equal(
    nextDeparturePlace({ current: null, appliedDefault: null, nextDefault: "เชียงใหม่" }),
    "เชียงใหม่",
  );
});

test("a field still holding the previous default follows the province change", () => {
  assert.equal(
    nextDeparturePlace({
      current: "เชียงใหม่",
      appliedDefault: "เชียงใหม่",
      nextDefault: "ภูเก็ต",
    }),
    "ภูเก็ต",
  );
});

test("a place the requester chose is left alone", () => {
  assert.equal(
    nextDeparturePlace({
      current: "สนามบินดอนเมือง",
      appliedDefault: "กรุงเทพมหานคร",
      nextDefault: "เชียงใหม่",
    }),
    null,
  );
});

test("a hand-typed province name is left alone — this is why the applied default is tracked", () => {
  // Same text a default would have written, but nothing put it there. Without
  // `appliedDefault` this case is indistinguishable from the one above it.
  assert.equal(
    nextDeparturePlace({
      current: "เชียงใหม่",
      appliedDefault: null,
      nextDefault: "ภูเก็ต",
    }),
    null,
  );
});

test("a field already equal to the default needs no change", () => {
  assert.equal(
    nextDeparturePlace({
      current: "กรุงเทพมหานคร",
      appliedDefault: "กรุงเทพมหานคร",
      nextDefault: "กรุงเทพมหานคร",
    }),
    null,
  );
});

test("no default to apply yet leaves an empty field empty", () => {
  // The return leg's default is the chosen province; none is chosen yet.
  assert.equal(
    nextDeparturePlace({ current: "", appliedDefault: null, nextDefault: null }),
    null,
  );
  assert.equal(
    nextDeparturePlace({ current: "", appliedDefault: null, nextDefault: "  " }),
    null,
  );
});

test("clearing the province does not wipe the place it had already filled in", () => {
  assert.equal(
    nextDeparturePlace({ current: "เชียงใหม่", appliedDefault: "เชียงใหม่", nextDefault: null }),
    null,
  );
});
