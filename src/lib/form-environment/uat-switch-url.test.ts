import { test } from "node:test";
import assert from "node:assert/strict";
import { uatSwitchLeavesRecord, urlAfterUatSwitch } from "./uat-switch-url";

const AP1 = "https://portal.example.com/request/travel-expense";

test("switching to PRO drops a UAT record's id", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=900001`, false), true);
  assert.equal(urlAfterUatSwitch(`${AP1}?id=900001`, false), AP1);
});

test("switching to UAT drops a production record's id", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=42`, true), true);
  assert.equal(urlAfterUatSwitch(`${AP1}?id=42`, true), AP1);
});

test("an id that already agrees with the target mode is kept", () => {
  // Nothing to walk away from — the reload should behave exactly as before.
  const uatUrl = `${AP1}?id=900001`;
  assert.equal(uatSwitchLeavesRecord(uatUrl, true), false);
  assert.equal(urlAfterUatSwitch(uatUrl, true), uatUrl);

  const proUrl = `${AP1}?id=42`;
  assert.equal(uatSwitchLeavesRecord(proUrl, false), false);
  assert.equal(urlAfterUatSwitch(proUrl, false), proUrl);
});

test("the seed id itself counts as a UAT record", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=900000`, false), true);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=899999`, false), false);
});

test("every other query parameter survives", () => {
  const next = urlAfterUatSwitch(`${AP1}?from=/my-request&id=900001&new=1`, false);
  const params = new URL(next).searchParams;
  assert.equal(params.get("id"), null);
  assert.equal(params.get("from"), "/my-request");
  assert.equal(params.get("new"), "1");
  assert.equal(new URL(next).pathname, "/request/travel-expense");
});

test("the path and hash are never changed", () => {
  const next = urlAfterUatSwitch(`${AP1}?id=900001#day-2`, false);
  assert.equal(next, `${AP1}#day-2`);
});

test("a URL with no id is returned untouched", () => {
  // Detail pages carry the id as a path segment, and a blank fill page has none.
  const detail = "https://portal.example.com/request/travel-expense/900001";
  assert.equal(uatSwitchLeavesRecord(detail, false), false);
  assert.equal(urlAfterUatSwitch(detail, false), detail);
  assert.equal(urlAfterUatSwitch(`${AP1}?new=1`, false), `${AP1}?new=1`);
});

test("AP-17 resumes by groupKey, which names no environment", () => {
  const url = "https://portal.example.com/request/travel-booking?groupKey=abc-123";
  assert.equal(uatSwitchLeavesRecord(url, false), false);
  assert.equal(uatSwitchLeavesRecord(url, true), false);
});

test("an unreadable id or URL leaves the reload alone", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=abc`, false), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=`, false), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=-5`, true), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=1.5`, true), false);
  assert.equal(uatSwitchLeavesRecord("not a url?id=900001", false), false);
  assert.equal(urlAfterUatSwitch("not a url?id=900001", false), "not a url?id=900001");
});

test("an unchanged URL comes back equal, so the caller's !== picks reload", () => {
  const url = `${AP1}?id=42`;
  assert.equal(urlAfterUatSwitch(url, false), url);
});

test("the reload target can never leave this origin", () => {
  // The input is window.location.href and the output is fed to location.assign,
  // so a path or query that could move the origin would be a redirect anybody
  // could aim by crafting a link.
  const hostile = [
    `${AP1}?id=900001`,
    `https://portal.example.com//evil.example.net?id=900001`,
    `https://portal.example.com/request/travel-expense?id=900001&next=https://evil.example.net`,
    `https://portal.example.com/request/travel-expense?id=900001#//evil.example.net`,
  ];
  for (const input of hostile) {
    const next = urlAfterUatSwitch(input, true);
    assert.equal(new URL(next).origin, new URL(input).origin);
  }
});
