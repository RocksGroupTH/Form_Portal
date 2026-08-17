import { test } from "node:test";
import assert from "node:assert/strict";
import { canSwitchEnvironment } from "./viewer-controls";
import type { ViewerUatStatus } from "./payload-types";

const viewer = (over: Partial<ViewerUatStatus>): ViewerUatStatus => ({
  isTester: false,
  uatMode: false,
  anyUatForm: false,
  hasUatManager: false,
  ...over,
});

test("an ordinary user has nothing to switch between", () => {
  assert.equal(canSwitchEnvironment(viewer({})), false);
  // Somebody else's pilot is not this person's business.
  assert.equal(canSwitchEnvironment(viewer({ anyUatForm: true })), false);
});

test("a tester with no form open for testing has nothing to switch to", () => {
  assert.equal(canSwitchEnvironment(viewer({ isTester: true })), false);
});

test("a tester gets the control as soon as a form is open for testing", () => {
  assert.equal(canSwitchEnvironment(viewer({ isTester: true, anyUatForm: true })), true);
});

test("somebody already in UAT mode always keeps the control", () => {
  // An admin turning off the last UAT-enabled form must not strand them there
  // with no way back.
  assert.equal(canSwitchEnvironment(viewer({ isTester: true, uatMode: true })), true);
  assert.equal(canSwitchEnvironment(viewer({ uatMode: true })), true);
});

test("no payload yet means no control", () => {
  // The chips and the switch both render nothing rather than guess, so a slow
  // or failed fetch must not flash a control that then disappears.
  assert.equal(canSwitchEnvironment(undefined), false);
  assert.equal(canSwitchEnvironment(null), false);
});
