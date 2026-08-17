import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerListEnvironment } from "./pick-environment";
import { keepRowsInCurrentEnvironment } from "./current-rows";

const bothOpen = { productionEnabled: true, uatEnabled: true };
const uatOnly = { productionEnabled: false, uatEnabled: true };
const productionOnly = { productionEnabled: true, uatEnabled: false };
const closed = { productionEnabled: false, uatEnabled: false };

test("an ordinary viewer is on Production, whatever the switches say", () => {
  assert.equal(viewerListEnvironment(bothOpen, false), "Production");
  assert.equal(viewerListEnvironment(productionOnly, false), "Production");
  // A form piloted in UAT is not theirs to see; their list stays production.
  assert.equal(viewerListEnvironment(uatOnly, false), "Production");
  assert.equal(viewerListEnvironment(closed, false), "Production");
  assert.equal(viewerListEnvironment(null, false), "Production");
});

test("a tester in UAT mode is on UAT only where the UAT switch is on", () => {
  assert.equal(viewerListEnvironment(bothOpen, true), "UAT");
  assert.equal(viewerListEnvironment(uatOnly, true), "UAT");
});

test("a tester in UAT mode still sees Production rows for a form UAT is off for", () => {
  // The defect this function exists to close: `pickEnvironment().environment`
  // alone says "UAT" for any viewer in UAT mode, so an account approver — who
  // the design forces onto the tester list — lost every real AP-1 and AP-17
  // row from /my-work while their 30-day cookie was set.
  assert.equal(viewerListEnvironment(productionOnly, true), "Production");
  assert.equal(viewerListEnvironment(null, true), "Production");
});

test("both switches off strands nobody — the list falls back to Production", () => {
  assert.equal(viewerListEnvironment(closed, true), "Production");
  assert.equal(viewerListEnvironment(closed, false), "Production");
});

test("end to end: the map a tester in UAT mode gets keeps their real work", () => {
  // AP-1 is being piloted, AP-17 is not. The tester must see UAT AP-1 rows and
  // Production AP-17 rows in the same merged list.
  const map = {
    "AP-1": viewerListEnvironment(bothOpen, true),
    "AP-17": viewerListEnvironment(productionOnly, true),
  };
  assert.deepEqual(map, { "AP-1": "UAT", "AP-17": "Production" });

  const rows = [
    { formCode: "AP-1", environment: "UAT" as const, id: 900001 },
    { formCode: "AP-1", environment: "Production" as const, id: 4001 },
    { formCode: "AP-17", environment: "Production" as const, id: 4002 },
    { formCode: "AP-17", environment: "UAT" as const, id: 900002 },
  ];
  assert.deepEqual(
    keepRowsInCurrentEnvironment(rows, map).map((r) => r.id),
    [900001, 4002],
  );
});

test("a Fast_Core failure degrades to the ordinary user's list, not an empty one", () => {
  // What `viewerEnvironmentMapOrProduction` falls back to in report-service:
  // an empty map, which `keepRowsInCurrentEnvironment` reads as Production
  // everywhere.
  const rows = [
    { formCode: "AP-1", environment: "Production" as const, id: 4001 },
    { formCode: "AP-1", environment: "UAT" as const, id: 900001 },
  ];
  assert.deepEqual(
    keepRowsInCurrentEnvironment(rows, {}).map((r) => r.id),
    [4001],
  );
});
