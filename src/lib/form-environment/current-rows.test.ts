import { test } from "node:test";
import assert from "node:assert/strict";
import { keepRowsInCurrentEnvironment } from "./current-rows";

const rows = [
  { id: 1, formCode: "AP-1", environment: "Production" as const },
  { id: 2, formCode: "AP-1", environment: "UAT" as const },
  { id: 3, formCode: "AP-17", environment: "Production" as const },
  { id: 4, formCode: "AP-17", environment: "UAT" as const },
];

test("each form keeps only the database it resolves to for this viewer", () => {
  const kept = keepRowsInCurrentEnvironment(rows, { "AP-1": "UAT", "AP-17": "Production" });
  assert.deepEqual(kept.map((r) => r.id), [2, 3]);
});

test("a form absent from the viewer's map is Production", () => {
  const kept = keepRowsInCurrentEnvironment(rows, { "AP-1": "UAT" });
  assert.deepEqual(kept.map((r) => r.id), [2, 3]);
});

test("untagged rows are from a single-pool read and always survive", () => {
  const untagged = [{ id: 9, formCode: "AP-1" }];
  assert.deepEqual(keepRowsInCurrentEnvironment(untagged, { "AP-1": "UAT" }), untagged);
});

test("a row with no form code is judged as Production", () => {
  const orphan = [
    { id: 7, formCode: null, environment: "Production" as const },
    { id: 8, formCode: null, environment: "UAT" as const },
  ];
  assert.deepEqual(
    keepRowsInCurrentEnvironment(orphan, { "AP-1": "UAT" }).map((r) => r.id),
    [7],
  );
});

test("an empty list stays empty", () => {
  assert.deepEqual(keepRowsInCurrentEnvironment([], { "AP-1": "UAT" }), []);
});
