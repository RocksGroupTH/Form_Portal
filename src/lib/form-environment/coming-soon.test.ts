import { test } from "node:test";
import assert from "node:assert/strict";
import { isComingSoon, pickEnvironment } from "./pick-environment";

const bothOpen = { productionEnabled: true, uatEnabled: true };
const uatOnly = { productionEnabled: false, uatEnabled: true };
const productionOnly = { productionEnabled: true, uatEnabled: false };
const closed = { productionEnabled: false, uatEnabled: false };

test("a form being piloted in UAT reads as 'soon' to everyone outside the pilot", () => {
  // The whole point: AP-17 open for testing and not yet live used to vanish
  // from the catalogue, so searching "AP-17" answered "no results".
  assert.equal(isComingSoon(uatOnly, false), true);
});

test("both switches off is not 'soon' — nobody is working on that form", () => {
  // "Soon" is a promise. A form nobody is piloting stays hidden, exactly as it
  // was before this predicate existed.
  assert.equal(isComingSoon(closed, false), false);
});

test("a tester in UAT mode never sees 'soon'", () => {
  // The form they are piloting is open to them — they are the pilot.
  assert.equal(isComingSoon(uatOnly, true), false);
  // And a live form that is not part of the test is not "soon" for them
  // either; it simply stays hidden while their UAT mode is on.
  assert.equal(isComingSoon(productionOnly, true), false);
  assert.equal(isComingSoon(bothOpen, true), false);
  assert.equal(isComingSoon(closed, true), false);
});

test("a form anyone can already file is never 'soon'", () => {
  assert.equal(isComingSoon(bothOpen, false), false);
  assert.equal(isComingSoon(productionOnly, false), false);
});

test("a form with no row stays available rather than being deferred", () => {
  // Fail-open, same as everywhere else here: no row means PRODUCTION_ONLY, and
  // a form the payload does not know about must never end up behind a
  // watermark promising it is coming.
  assert.equal(isComingSoon(null, false), false);
  assert.equal(isComingSoon(null, true), false);
});

test("'soon' and 'available' can never both be true", () => {
  // The two catalogues branch on one and then the other. A form satisfying
  // both would render as a clickable card wearing a Soon watermark.
  const forms = [bothOpen, uatOnly, productionOnly, closed, null];
  for (const form of forms) {
    for (const viewerUatMode of [false, true]) {
      const soon = isComingSoon(form, viewerUatMode);
      const { available } = pickEnvironment({ viewerUatMode, form });
      assert.equal(
        soon && available,
        false,
        `form=${JSON.stringify(form)} viewerUatMode=${viewerUatMode}`,
      );
    }
  }
});

test("every form an ordinary viewer cannot file is either 'soon' or deliberately hidden", () => {
  // The catalogue renders `available || comingSoon`, so anything false on both
  // is a form it drops. Only a closed form may land there — if this ever
  // catches uatOnly again, the pilot has gone invisible a second time.
  const hidden = ([bothOpen, uatOnly, productionOnly, closed] as const).filter(
    (form) => !pickEnvironment({ viewerUatMode: false, form }).available && !isComingSoon(form, false),
  );
  assert.deepEqual(hidden, [closed]);
});
