import { test } from "node:test";
import assert from "node:assert/strict";
import { boundIdEnvironment, environmentWritable, pickEnvironment } from "./pick-environment";

const bothOpen = { productionEnabled: true, uatEnabled: true };
const uatOnly = { productionEnabled: false, uatEnabled: true };
const productionOnly = { productionEnabled: true, uatEnabled: false };
const closed = { productionEnabled: false, uatEnabled: false };

/**
 * The composition `resolveCurrentFormWritable` performs, as a pure function, so
 * the write rule can be exercised without a request scope: bound the id, pick the
 * environment, then judge that environment's own switch.
 */
function writable(
  idEnvironment: "Production" | "UAT" | null,
  form: { productionEnabled: boolean; uatEnabled: boolean } | null,
  viewerUatMode: boolean,
): boolean {
  const bound = boundIdEnvironment(idEnvironment, form, viewerUatMode);
  const decision = pickEnvironment({ idEnvironment: bound, viewerUatMode, form });
  return environmentWritable(decision.environment, form);
}

test("the switch for the resolved environment decides, not the viewer", () => {
  assert.equal(environmentWritable("Production", bothOpen), true);
  assert.equal(environmentWritable("Production", productionOnly), true);
  assert.equal(environmentWritable("Production", uatOnly), false);
  assert.equal(environmentWritable("UAT", bothOpen), true);
  assert.equal(environmentWritable("UAT", uatOnly), true);
  assert.equal(environmentWritable("UAT", productionOnly), false);
  assert.equal(environmentWritable("Production", closed), false);
  assert.equal(environmentWritable("UAT", closed), false);
});

test("a form with no row is production-only, and writable there", () => {
  assert.equal(environmentWritable("Production", null), true);
  assert.equal(environmentWritable("UAT", null), false);
});

test("production switched off refuses a submit that carries a production id", () => {
  // The defect this predicate exists for: every draft already in flight names its
  // id in the path, so `pickEnvironment` calls it available and the write guard
  // was a no-op. Turning ProductionEnabled off has to stop those too.
  assert.equal(
    pickEnvironment({ idEnvironment: "Production", viewerUatMode: false, form: uatOnly }).available,
    true,
  );
  assert.equal(writable("Production", uatOnly, false), false);
  assert.equal(writable("Production", closed, false), false);
});

test("UAT switched off refuses a tester's write to a UAT id", () => {
  // The tester still reaches the record — boundIdEnvironment keeps them in UAT so
  // they can read what they filed — but the pilot is over and nothing new lands.
  assert.equal(boundIdEnvironment("UAT", productionOnly, true), "UAT");
  assert.equal(
    pickEnvironment({ idEnvironment: "UAT", viewerUatMode: true, form: productionOnly }).available,
    true,
  );
  assert.equal(writable("UAT", productionOnly, true), false);
});

test("both switches on lets the write through, whichever id it carries", () => {
  assert.equal(writable("Production", bothOpen, false), true);
  assert.equal(writable("UAT", bothOpen, true), true);
  // A non-tester opening a tester's UAT record is still routed there by the id,
  // and UAT being open is what decides whether their action may write.
  assert.equal(writable("UAT", bothOpen, false), true);
});

test("a new draft carries no id, and is judged exactly as it is today", () => {
  // With no id, writability and `pickEnvironment().available` are the same
  // answer — this predicate changes nothing for a brand-new request.
  for (const form of [bothOpen, uatOnly, productionOnly, closed, null]) {
    for (const viewerUatMode of [false, true]) {
      const decision = pickEnvironment({ viewerUatMode, form });
      assert.equal(
        environmentWritable(decision.environment, form),
        decision.available,
        `form=${JSON.stringify(form)} viewerUatMode=${viewerUatMode}`,
      );
    }
  }
});
