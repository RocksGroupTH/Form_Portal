import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRulesByAccount, type GroupingInput } from "./bu-gl-groups";

const base: GroupingInput = {
  buRules: [
    { buCode: "DODO-M", glAccountNo: "110721001", isActive: true },
    { buCode: "DOCO", glAccountNo: "110721001", isActive: true },
  ],
  branchRules: [{ branchCode: "RFM", glAccountNo: "110723001", isActive: true }],
  bus: [
    { buCode: "COCO", locations: 130 },
    { buCode: "DODO-M", locations: 36 },
    { buCode: "DOCO", locations: 29 },
    { buCode: "CTPS", locations: 11 },
  ],
  accounts: [
    { accountNo: "110721001", displayName: "ลูกหนี้ระหว่างกัน" },
    { accountNo: "110723001", displayName: "ลูกหนี้แฟรนไชส์" },
  ],
};

test("rules pointing at one account become one group", () => {
  const { groups } = groupRulesByAccount(base);
  const g = groups.find((x) => x.accountNo === "110721001")!;
  assert.equal(g.displayName, "ลูกหนี้ระหว่างกัน");
  assert.deepEqual(g.members.map((m) => m.code), ["DOCO", "DODO-M"]);
  assert.ok(g.members.every((m) => m.kind === "bu"));
});

test("a BU rule and a branch rule on the same account share one group", () => {
  // The two tables are separate because some branches have no BU to key on —
  // not because they are different kinds of decision. On screen they are one.
  const { groups } = groupRulesByAccount({
    ...base,
    branchRules: [{ branchCode: "RFM", glAccountNo: "110721001", isActive: true }],
  });
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].members.map((m) => `${m.kind}:${m.code}`),
    ["bu:DOCO", "bu:DODO-M", "branch:RFM"],
  );
});

test("BUs come before branches inside a group", () => {
  // A BU names a KIND of shop and a branch names one shop, so the general rule
  // reads first — and the eye needs the two kinds separated, not interleaved.
  const { groups } = groupRulesByAccount({
    ...base,
    buRules: [{ buCode: "ZZZ", glAccountNo: "110721001", isActive: true }],
    branchRules: [{ branchCode: "AAA", glAccountNo: "110721001", isActive: true }],
  });
  assert.deepEqual(groups[0].members.map((m) => m.kind), ["bu", "branch"]);
});

test("an account nobody has named keeps its number as its label", () => {
  // The account list can be stale or a rule can point at something since
  // renamed. A group with no name is still a group; a group that vanished
  // because its name did not resolve would hide a live rule.
  const { groups } = groupRulesByAccount({ ...base, accounts: [] });
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => g.displayName === null));
});

test("an inactive rule is not a rule", () => {
  const { groups } = groupRulesByAccount({
    ...base,
    buRules: [{ buCode: "DODO-M", glAccountNo: "110721001", isActive: false }],
    branchRules: [],
  });
  assert.deepEqual(groups, []);
});

test("a rule with a blank account is not a rule either", () => {
  // Blank is how a rule is deleted — `บัญชีตาม คชจ`, the absence of a rule.
  const { groups } = groupRulesByAccount({
    ...base,
    buRules: [{ buCode: "DODO-M", glAccountNo: "   ", isActive: true }],
    branchRules: [],
  });
  assert.deepEqual(groups, []);
});

test("groups are ordered by account number, not by how many members they hold", () => {
  const { groups } = groupRulesByAccount(base);
  assert.deepEqual(groups.map((g) => g.accountNo), ["110721001", "110723001"]);
});

/* ── what is left over ── */

test("BUs with no rule are listed, largest first", () => {
  // Largest first because the size of the BU is what tells an admin whether a
  // missing rule matters: COCO with 130 Locations is the one to look at.
  const { unassignedBus } = groupRulesByAccount(base);
  assert.deepEqual(unassignedBus.map((b) => b.buCode), ["COCO", "CTPS"]);
});

test("a BU that HAS a rule is not also in the leftovers", () => {
  const { unassignedBus } = groupRulesByAccount(base);
  assert.equal(unassignedBus.some((b) => b.buCode === "DODO-M"), false);
});

test("a rule on a BU no Location carries still shows as a group", () => {
  // The Locations moved and the rule did not. Dropping it would hide a live
  // rule because nothing currently matches it — the opposite of what an admin
  // needs to see in order to delete it.
  const { groups } = groupRulesByAccount({
    ...base,
    buRules: [{ buCode: "GONE", glAccountNo: "110721001", isActive: true }],
    bus: [],
  });
  assert.deepEqual(groups[0].members.map((m) => m.code), ["GONE"]);
});

test("the BU code is matched case-insensitively against the Location list", () => {
  // The rule comes from a picker and the BU list from BC.
  const { unassignedBus } = groupRulesByAccount({
    ...base,
    buRules: [{ buCode: "coco", glAccountNo: "110721001", isActive: true }],
    bus: [{ buCode: "COCO", locations: 130 }],
  });
  assert.deepEqual(unassignedBus, []);
});

/* ── what the Add picker offers ── */

test("every member carries the account it currently sits in, so a move is visible", () => {
  // Adding a BU that is already in another group is an upsert — it MOVES. The
  // picker says so rather than looking like a fresh assignment.
  const { assignedAccountByCode } = groupRulesByAccount(base);
  assert.equal(assignedAccountByCode.get("bu:DODO-M"), "110721001");
  assert.equal(assignedAccountByCode.get("branch:RFM"), "110723001");
  assert.equal(assignedAccountByCode.get("bu:COCO"), undefined);
});
