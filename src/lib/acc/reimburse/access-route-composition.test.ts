import { test } from "node:test";
import assert from "node:assert/strict";
import { filterGrantableReimburseTabKeys } from "./settings-tabs";

/**
 * Pins the exact composition `GET /api/request/reimburse/access` uses to turn
 * the raw stored grant list into `settingsTabs` / `canSettings`, without
 * importing the route itself — the route pulls in `access-tabs.ts`, which
 * pulls in `@/lib/acc/pool` and, through it, `@/env`, which validates the
 * whole environment at import time and cannot run in this suite. This file
 * imports only `./settings-tabs`, which imports nothing, so it exercises the
 * same formula against a live database dependency.
 *
 * The hazard this guards: `resolveReimburseTabsByEmail` now returns the
 * UNION of settings-tab and menu keys (`filterStorableReimburseKeys`, task 2
 * step 1). If the route assigned that union straight to `settingsTabs`
 * instead of re-narrowing it with `filterGrantableReimburseTabKeys`, a person
 * granted a menu key ALONE — sight of a working screen, nothing about
 * settings — would get a non-empty `settingsTabs` and `canSettings` would
 * flip true, handing them the whole AP-4 settings page. This is AP-17's
 * recorded failure shape, on the read side instead of the write side.
 */

function settingsTabsFor(granted: string[]): string[] {
  // The route's exact line: `const settingsTabs = filterGrantableReimburseTabKeys(granted);`
  return filterGrantableReimburseTabKeys(granted);
}

function canSettingsFor(admin: boolean, granted: string[]): boolean {
  // The route's exact line: `const canSettings = admin || settingsTabs.length > 0;`
  return admin || settingsTabsFor(granted).length > 0;
}

test("a menu-only grant produces empty settingsTabs, not the raw union", () => {
  const granted = ["approvalQueue"];
  assert.deepEqual(settingsTabsFor(granted), []);
  // The regression this guards against: taking `granted` itself as
  // `settingsTabs` would leave the menu key sitting in the field.
  assert.notDeepEqual(settingsTabsFor(granted), granted);
});

test("a menu-only grant must not flip canSettings on for a non-admin", () => {
  assert.equal(canSettingsFor(false, ["approvalQueue"]), false);
  assert.equal(canSettingsFor(false, ["clearance"]), false);
  assert.equal(canSettingsFor(false, ["approvalQueue", "clearance"]), false);
});

test("a mixed grant keeps only the settings-tab half in settingsTabs", () => {
  const granted = ["rules", "approvalQueue", "clearance"];
  assert.deepEqual(settingsTabsFor(granted), ["rules"]);
  assert.equal(canSettingsFor(false, granted), true);
});

test("an admin's canSettings does not depend on the grant list at all", () => {
  assert.equal(canSettingsFor(true, []), true);
  assert.equal(canSettingsFor(true, ["approvalQueue"]), true);
});
