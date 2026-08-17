import { test } from "node:test";
import assert from "node:assert/strict";
import { pickEnvironment, PRODUCTION_ONLY } from "./pick-environment";

const bothOpen = { productionEnabled: true, uatEnabled: true };
const uatOnly = { productionEnabled: false, uatEnabled: true };
const productionOnly = { productionEnabled: true, uatEnabled: false };
const closed = { productionEnabled: false, uatEnabled: false };

test("the request id decides, whoever is asking", () => {
  // A manager who is not a tester must still be able to open a tester's UAT
  // request; the record names its own database.
  assert.deepEqual(
    pickEnvironment({ idEnvironment: "UAT", viewerUatMode: false, form: productionOnly }),
    { environment: "UAT", available: true },
  );
  assert.deepEqual(
    pickEnvironment({ idEnvironment: "Production", viewerUatMode: true, form: bothOpen }),
    { environment: "Production", available: true },
  );
});

test("a viewer in UAT mode sees only what is open for testing", () => {
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: true, form: bothOpen }),
    { environment: "UAT", available: true },
  );
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: true, form: uatOnly }),
    { environment: "UAT", available: true },
  );
  // Production being on is irrelevant to them while they are in UAT mode.
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: true, form: productionOnly }),
    { environment: "UAT", available: false },
  );
});

test("everyone else follows the production switch alone", () => {
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: false, form: bothOpen }),
    { environment: "Production", available: true },
  );
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: false, form: productionOnly }),
    { environment: "Production", available: true },
  );
  // A form piloted in UAT is invisible to an ordinary user.
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: false, form: uatOnly }),
    { environment: "Production", available: false },
  );
});

test("both switches off hides the form from everybody", () => {
  assert.equal(pickEnvironment({ viewerUatMode: false, form: closed }).available, false);
  assert.equal(pickEnvironment({ viewerUatMode: true, form: closed }).available, false);
});

test("a form with no row behaves as production-only", () => {
  assert.deepEqual(PRODUCTION_ONLY, { productionEnabled: true, uatEnabled: false });
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: false, form: null }),
    { environment: "Production", available: true },
  );
  assert.deepEqual(
    pickEnvironment({ viewerUatMode: true, form: null }),
    { environment: "UAT", available: false },
  );
});

test("an id still wins when the form is closed — reading what exists is not filing something new", () => {
  assert.deepEqual(
    pickEnvironment({ idEnvironment: "UAT", viewerUatMode: false, form: closed }),
    { environment: "UAT", available: true },
  );
});
