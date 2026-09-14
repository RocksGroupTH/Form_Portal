import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupByTarget,
  groupByTargetIncludingEmpty,
  groupValue,
} from "./erp-target-groups";

const ROWS = [
  { brandCode: "PCTH" },
  { brandCode: "ROCKS" },
  { brandCode: "KSI" },
  { brandCode: "PLM" },
];
const TARGETS: Record<string, string> = { PCTH: "PCTH", ROCKS: "PCTH", KSI: "KSI" };
const ORDER = ["PCTH", "KSI", "PCMY", "UNO"];

/* ── grouping ── */

test("claim brands land under the company their journals post into", () => {
  const { groups } = groupByTarget(ROWS, TARGETS, ORDER);
  assert.deepEqual(
    groups.map((g) => [g.target, g.members.map((m) => m.brandCode)]),
    [["PCTH", ["PCTH", "ROCKS"]], ["KSI", ["KSI"]]],
  );
});

test("a brand mapped to nothing is not in a group — it is the leftovers", () => {
  // Measured state on a fresh deployment: ROCKS is AP-4's only seeded claim
  // brand and has no AccBrandErpInterface row, so it is actionable by nobody
  // until an admin maps it. It must be visible, not absent.
  const { unassigned } = groupByTarget(ROWS, TARGETS, ORDER);
  assert.deepEqual(unassigned.map((u) => u.brandCode), ["PLM"]);
});

test("groups come out in the picker's order, not alphabetically", () => {
  const { groups } = groupByTarget(ROWS, { PCTH: "KSI", KSI: "PCTH" }, ORDER);
  assert.deepEqual(groups.map((g) => g.target), ["PCTH", "KSI"]);
});

test("a target outside the known four still gets a group, after them", () => {
  // A mapping to a company nobody expected is exactly what somebody needs to
  // see; dropping it would hide the configuration that caused it.
  const { groups } = groupByTarget([{ brandCode: "X" }, { brandCode: "PCTH" }], { X: "WAT", PCTH: "PCTH" }, ORDER);
  assert.deepEqual(groups.map((g) => g.target), ["PCTH", "WAT"]);
});

test("the target is matched case-insensitively", () => {
  const { groups, unassigned } = groupByTarget([{ brandCode: "A" }], { A: " pcth " }, ORDER);
  assert.deepEqual(unassigned, []);
  assert.equal(groups[0].target, "PCTH");
});

test("every company gets a card, including the ones nobody maps to", () => {
  // An empty card is how a company is commissioned at all — there is nowhere
  // else to add its first brand.
  const { groups } = groupByTargetIncludingEmpty(ROWS, TARGETS, ORDER);
  assert.deepEqual(groups.map((g) => g.target), ORDER);
  assert.deepEqual(groups.find((g) => g.target === "UNO")?.members, []);
});

/* ── one field shared by a group ── */

test("all members agreeing is the value", () => {
  assert.deepEqual(
    groupValue([{ brandCode: "PCTH", value: "Q" }, { brandCode: "ROCKS", value: "Q" }]),
    { kind: "agreed", value: "Q" },
  );
});

test("all members blank is an agreed blank, not a conflict", () => {
  assert.deepEqual(
    groupValue([{ brandCode: "PCTH", value: null }, { brandCode: "ROCKS", value: "  " }]),
    { kind: "agreed", value: "" },
  );
});

test("one set and one blank offers to fill the blank, and names it", () => {
  // The measured case, 2026-09-14: PCTH and ROCKS are one group and PCTH's
  // VAT-input account was never filled in, so AP-3's payload throws for a PCTH
  // clearing that carries VAT. Saving from this screen repairs it — which the
  // screen says out loud rather than doing quietly.
  assert.deepEqual(
    groupValue([
      { brandCode: "PCTH", value: "" },
      { brandCode: "ROCKS", value: "110741001" },
    ]),
    { kind: "fill", value: "110741001", blankMembers: ["PCTH"] },
  );
});

test("two DIFFERENT real values is a conflict, never a pick", () => {
  // Picking would overwrite one real decision with another, on configuration
  // that decides where money posts. The screen asks.
  const r = groupValue([
    { brandCode: "PCTH", value: "110741001" },
    { brandCode: "ROCKS", value: "110741009" },
  ]);
  assert.equal(r.kind, "conflict");
  assert.deepEqual(
    r.kind === "conflict" ? r.values.map((v) => v.brandCode) : [],
    ["PCTH", "ROCKS"],
  );
});

test("surrounding space is not a difference", () => {
  assert.deepEqual(
    groupValue([{ brandCode: "A", value: " Q " }, { brandCode: "B", value: "Q" }]),
    { kind: "agreed", value: "Q" },
  );
});

test("a group with no members at all is an agreed blank", () => {
  // An empty card has nothing to disagree about, and its field starts empty.
  assert.deepEqual(groupValue([]), { kind: "agreed", value: "" });
});
