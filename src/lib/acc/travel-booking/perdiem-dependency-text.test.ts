import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dependencyRefusalText,
  dependencyRequestLabel,
  dependencyStatusReason,
  dependencyWarningText,
} from "./perdiem-dependency-text";
import type { PerDiemDependency } from "./perdiem-dependency";

const dep = (over: Partial<PerDiemDependency> = {}): PerDiemDependency => ({
  requestId: 12,
  requestNo: "TRL26-0012",
  status: "Submitted",
  settled: false,
  ...over,
});

test("a request with a number is named by it", () => {
  assert.equal(dependencyRequestLabel(dep()), "TRL26-0012");
});

test("a request with no number yet falls back to its id", () => {
  // A draft in the group has no running number — it is minted at submit.
  assert.equal(dependencyRequestLabel(dep({ requestNo: null })), "#12");
});

test("each unsettled status gets its own reason", () => {
  const draft = dependencyStatusReason("Draft");
  const submitted = dependencyStatusReason("Submitted");
  const returned = dependencyStatusReason("Returned");
  assert.notEqual(draft, submitted);
  assert.notEqual(submitted, returned);
  assert.notEqual(draft, returned);
});

test("a status this file has never heard of is named, not guessed at", () => {
  // `perdiem-dependency.ts` treats an unknown status as unsettled, so the copy
  // has to be able to say something true about one.
  assert.match(dependencyStatusReason("SomethingNew"), /SomethingNew/);
});

test("both sentences name the request being waited on", () => {
  const d = dep();
  assert.match(dependencyWarningText(d), /TRL26-0012/);
  assert.match(dependencyRefusalText(d), /TRL26-0012/);
});

test("both sentences carry the reason the request is not settled", () => {
  const d = dep({ status: "Returned" });
  const reason = dependencyStatusReason("Returned");
  assert.ok(dependencyWarningText(d).indexOf(reason) !== -1);
  assert.ok(dependencyRefusalText(d).indexOf(reason) !== -1);
});
