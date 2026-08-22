import { test } from "node:test";
import assert from "node:assert/strict";
import { UAT_SWITCH_LANDING, uatSwitchLeavesRecord, urlAfterUatSwitch } from "./uat-switch-url";

const ORIGIN = "https://portal.example.com";
const AP1 = `${ORIGIN}/request/travel-expense`;
const HOME = `${ORIGIN}/`;

/* ── where the switch lands ── */

test("the switch lands on Home, whatever page it was fired from", () => {
  const pages = [
    HOME,
    `${AP1}?id=900001`,
    `${AP1}?id=42&from=/my-request&new=1`,
    `${ORIGIN}/request/travel-expense/900001`,
    `${ORIGIN}/request/accounting/travel-booking/queue?status=Pending#row-7`,
    `${ORIGIN}/my-work`,
  ];
  for (const page of pages) {
    assert.equal(urlAfterUatSwitch(page), HOME, page);
  }
});

test("Home comes back equal to itself, so the caller's === picks reload", () => {
  // location.assign() to the URL you are already at is not reliably a fresh
  // load, and the whole point of the switch is that nothing survives it.
  assert.equal(urlAfterUatSwitch(HOME), HOME);
  // A query or hash on Home is not Home, so those reload by assignment.
  assert.notEqual(urlAfterUatSwitch(`${HOME}?tab=drafts`), `${HOME}?tab=drafts`);
  assert.equal(urlAfterUatSwitch(`${HOME}?tab=drafts`), HOME);
});

test("the landing target can never leave this origin", () => {
  // The output is fed to location.assign, so a path or query that could move
  // the origin would be a redirect anybody could aim by crafting a link.
  const hostile = [
    `${AP1}?id=900001`,
    `${ORIGIN}//evil.example.net?id=900001`,
    `${AP1}?id=900001&next=https://evil.example.net`,
    `${AP1}?id=900001#//evil.example.net`,
    `${ORIGIN}/@evil.example.net`,
  ];
  for (const input of hostile) {
    const next = urlAfterUatSwitch(input);
    assert.equal(new URL(next).origin, ORIGIN, input);
    assert.equal(new URL(next).pathname, UAT_SWITCH_LANDING, input);
  }
});

/* ── what the dialog warns about ── */

test("switching to PRO says a UAT record is being left behind", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=900001`, false), true);
});

test("switching to UAT says a production record is being left behind", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=42`, true), true);
});

test("an id that already agrees with the target mode warns about nothing", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=900001`, true), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=42`, false), false);
});

test("the seed id itself counts as a UAT record", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=900000`, false), true);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=899999`, false), false);
});

test("a URL with no id warns about nothing", () => {
  // Detail pages carry the id as a path segment, and a blank fill page has none.
  assert.equal(uatSwitchLeavesRecord(`${ORIGIN}/request/travel-expense/900001`, false), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?new=1`, false), false);
  assert.equal(uatSwitchLeavesRecord(HOME, false), false);
});

test("AP-17 resumes by groupKey, which names no environment", () => {
  const url = `${ORIGIN}/request/travel-booking?groupKey=abc-123`;
  assert.equal(uatSwitchLeavesRecord(url, false), false);
  assert.equal(uatSwitchLeavesRecord(url, true), false);
});

test("an unreadable id or URL stays quiet", () => {
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=abc`, false), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=`, false), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=-5`, true), false);
  assert.equal(uatSwitchLeavesRecord(`${AP1}?id=1.5`, true), false);
  assert.equal(uatSwitchLeavesRecord("not a url?id=900001", false), false);
});
