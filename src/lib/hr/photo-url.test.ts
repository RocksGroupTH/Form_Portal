import { test } from "node:test";
import assert from "node:assert/strict";
import { hrPhotoUrl } from "./photo-url";

/* The one place the cached photo endpoint's shape is written down. It is built
   in eight server-side lookups already; the detail screens need it on the
   client too, and a ninth hand-typed copy is how the ninth one goes wrong. */

test("a staff id becomes the cached photo endpoint", () => {
  assert.equal(hrPhotoUrl(10177), "/api/hr/photo/10177");
});

test("no staff id means no photo, not a URL that 404s", () => {
  // Avatar treats undefined as "draw the initials", which is the right answer
  // for a person we cannot identify — a broken <img> is not.
  assert.equal(hrPhotoUrl(null), undefined);
  assert.equal(hrPhotoUrl(undefined), undefined);
});

test("a nonsense id is not turned into a request", () => {
  assert.equal(hrPhotoUrl(0), undefined);
  assert.equal(hrPhotoUrl(-1), undefined);
  assert.equal(hrPhotoUrl(Number.NaN), undefined);
});
