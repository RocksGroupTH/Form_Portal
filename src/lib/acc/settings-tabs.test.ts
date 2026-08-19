import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GRANTABLE_SETTINGS_TABS,
  isGrantableSettingsTabKey,
  filterGrantableTabKeys,
} from "./settings-tabs";

test("exactly five tabs are grantable", () => {
  assert.equal(GRANTABLE_SETTINGS_TABS.length, 5);
  assert.deepEqual(
    GRANTABLE_SETTINGS_TABS.map((t) => t.key),
    ["brands", "sameDayBrand", "vehicles", "departments", "erpInterface"],
  );
});

test("the approvers tab is never grantable", () => {
  assert.equal(isGrantableSettingsTabKey("approvers"), false);
  assert.deepEqual(filterGrantableTabKeys(["approvers"]), []);
});

test("filterGrantableTabKeys trims, drops unknowns and de-duplicates", () => {
  assert.deepEqual(
    filterGrantableTabKeys([" brands ", "brands", "nope", "vehicles"]),
    ["brands", "vehicles"],
  );
});

test("filterGrantableTabKeys preserves the caller's order", () => {
  assert.deepEqual(
    filterGrantableTabKeys(["vehicles", "brands"]),
    ["vehicles", "brands"],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(filterGrantableTabKeys([]), []);
});
