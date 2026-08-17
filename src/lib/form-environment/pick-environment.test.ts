import { test } from "node:test";
import assert from "node:assert/strict";
import { boundIdEnvironment, pickEnvironment, PRODUCTION_ONLY } from "./pick-environment";

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

/* ── boundIdEnvironment ── */

test("a UAT id is honoured while the form is still open for testing", () => {
  assert.equal(boundIdEnvironment("UAT", uatOnly, false), "UAT");
  assert.equal(boundIdEnvironment("UAT", bothOpen, false), "UAT");
});

test("a UAT id is dropped once UAT is off and the viewer is not a tester", () => {
  // Without this bound, switching UAT off would close nothing: any id >= 900000
  // would still open the UAT database to anybody who typed the URL.
  assert.equal(boundIdEnvironment("UAT", productionOnly, false), null);
  assert.equal(boundIdEnvironment("UAT", closed, false), null);
});

test("a tester keeps their own UAT records after the switch is turned off", () => {
  assert.equal(boundIdEnvironment("UAT", productionOnly, true), "UAT");
  assert.equal(boundIdEnvironment("UAT", closed, true), "UAT");
});

test("a Production id is never bounded", () => {
  // It names the live database, and it is what keeps a tester in UAT mode from
  // being bounced out of a production record they opened deliberately.
  assert.equal(boundIdEnvironment("Production", closed, true), "Production");
  assert.equal(boundIdEnvironment("Production", uatOnly, true), "Production");
  assert.equal(boundIdEnvironment("Production", productionOnly, false), "Production");
});

test("no id stays no id, and a form with no row is judged production-only", () => {
  assert.equal(boundIdEnvironment(null, bothOpen, true), null);
  assert.equal(boundIdEnvironment(undefined, bothOpen, true), null);
  // form: null means PRODUCTION_ONLY, so UAT is closed unless the viewer tests.
  assert.equal(boundIdEnvironment("UAT", null, false), null);
  assert.equal(boundIdEnvironment("UAT", null, true), "UAT");
});

test("the bound reproduces the pilot case the split resolver got wrong", () => {
  // prod=off, uat=on. A tester with UAT mode OFF opens their own UAT draft.
  // The id routes them to UAT, so the write check must judge them on UAT too —
  // reading from one database and being refused a save against the other is the
  // bug this bound plus resolveCurrentFormAccess exists to prevent.
  const idEnvironment = boundIdEnvironment("UAT", uatOnly, false);
  assert.equal(idEnvironment, "UAT");
  assert.deepEqual(
    pickEnvironment({ idEnvironment, viewerUatMode: false, form: uatOnly }),
    { environment: "UAT", available: true },
  );
});
