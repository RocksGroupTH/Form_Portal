import { test } from "node:test";
import assert from "node:assert/strict";
import { selectErpSendBatchRows, sameRequestIdSet } from "./erp-send-batch";
import type { ErpSendBatchCandidate } from "./erp-send-batch";

type Row = ErpSendBatchCandidate & { id: number };

const interfaceByClaim: Record<string, string> = {
  PCTH: "PCTH",
  PCMY: "PCTH",
  KSI: "KSI",
};

function row(
  id: number,
  brandCode: string | null,
  prepStatus: Row["prepStatus"],
  erpInterfaceStatus: Row["erpInterfaceStatus"] = null,
): Row {
  return { id, brandCode, prepStatus, erpInterfaceStatus };
}

const ids = (rows: Row[]): number[] => rows.map((r) => r.id);

test("only rows mapped to the requested interface target join the batch", () => {
  const rows = [
    row(1, "PCTH", "ready"),
    row(2, "KSI", "ready"),
    row(3, "PCMY", "ready"), // maps to PCTH
  ];
  assert.deepEqual(ids(selectErpSendBatchRows(rows, interfaceByClaim, "PCTH")), [1, 3]);
  assert.deepEqual(ids(selectErpSendBatchRows(rows, interfaceByClaim, "KSI")), [2]);
});

test("an approval in another interface target does not change this target's batch", () => {
  // The regression this exists for: the staleness gate used to compare against
  // every Approved row, so a KSI approval invalidated an open PCTH prep page.
  const before = [row(1, "PCTH", "ready")];
  const after = [row(1, "PCTH", "ready"), row(2, "KSI", "ready")];
  assert.deepEqual(
    ids(selectErpSendBatchRows(before, interfaceByClaim, "PCTH")),
    ids(selectErpSendBatchRows(after, interfaceByClaim, "PCTH")),
  );
});

test("incomplete rows never join the batch", () => {
  const rows = [row(1, "PCTH", "ready"), row(2, "PCTH", "incomplete")];
  assert.deepEqual(ids(selectErpSendBatchRows(rows, interfaceByClaim, "PCTH")), [1]);
});

test("rows already Sent never join the batch, but Failed and Pending do", () => {
  const rows = [
    row(1, "PCTH", "ready", "Sent"),
    row(2, "PCTH", "ready", "Failed"),
    row(3, "PCTH", "ready", "Pending"),
    row(4, "PCTH", "ready", null),
  ];
  assert.deepEqual(ids(selectErpSendBatchRows(rows, interfaceByClaim, "PCTH")), [2, 3, 4]);
});

test("an unmapped brand falls outside every real interface target", () => {
  const rows = [row(1, "UNO", "ready"), row(2, null, "ready")];
  assert.deepEqual(ids(selectErpSendBatchRows(rows, interfaceByClaim, "PCTH")), []);
});

test("sameRequestIdSet ignores order", () => {
  assert.equal(sameRequestIdSet([3, 1, 2], [1, 2, 3]), true);
  assert.equal(sameRequestIdSet([], []), true);
});

test("sameRequestIdSet rejects a subset, a superset and a same-size disjoint set", () => {
  assert.equal(sameRequestIdSet([1, 2, 3], [1, 2]), false);
  assert.equal(sameRequestIdSet([1, 2], [1, 2, 3]), false);
  assert.equal(sameRequestIdSet([1, 2], [3, 4]), false);
});

test("sameRequestIdSet rejects duplicates rather than treating them as a match", () => {
  assert.equal(sameRequestIdSet([1, 1], [1, 2]), false);
  assert.equal(sameRequestIdSet([1, 2], [1, 1]), false);
});
