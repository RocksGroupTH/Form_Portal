import test from "node:test";
import assert from "node:assert/strict";
import { glHistoryKey, decideRemembered, type GlHistoryRow } from "./gl-history";

/**
 * The key, and what a set of past decisions adds up to.
 *
 * The corpus decided the key's shape rather than a guess: one description
 * appears nine times with two accounts, and the split is head office against
 * branches, exactly. Keyed on the description alone that is a conflict and
 * nothing is remembered; keyed on the description AND the HQ/branch
 * classification, both halves are unanimous. The cases below are that corpus.
 */

const row = (over: Partial<GlHistoryRow> = {}): GlHistoryRow => ({
  description: "Type-c to HDMI สีดำ", branchCode: "HQ01", company: "PCTH",
  glAccountNo: "610311002", ...over,
});

test("head office and a branch are different keys", () => {
  assert.notEqual(
    glHistoryKey("Type-c to HDMI สีดำ", "PCTH", "HQ01"),
    glHistoryKey("Type-c to HDMI สีดำ", "PCTH", "PC1073"),
  );
});

test("every branch shares one key — the classification, not the code", () => {
  const a = glHistoryKey("x", "PCTH", "PC1001");
  assert.equal(a, glHistoryKey("x", "PCTH", "PC1073"));
  assert.equal(a, glHistoryKey("x", "PCTH", "PCCT01"));
});

test("a blank branch is head office, the way isHqBranch reads it", () => {
  assert.equal(glHistoryKey("x", "PCTH", ""), glHistoryKey("x", "PCTH", "HQ01"));
  assert.equal(glHistoryKey("x", "PCTH", null), glHistoryKey("x", "PCTH", "HQ01"));
});

test("whitespace and Latin case do not make a new key", () => {
  const a = glHistoryKey("Type-C  to   HDMI", "PCTH", "HQ01");
  assert.equal(a, glHistoryKey("  type-c to HDMI  ", "PCTH", "HQ01"));
});

test("a different company is a different key", () => {
  assert.notEqual(glHistoryKey("x", "PCTH", "HQ01"), glHistoryKey("x", "KSI", "HQ01"));
});

test("unanimous history answers", () => {
  const rows = [row(), row(), row()];
  assert.equal(decideRemembered(rows, glHistoryKey("Type-c to HDMI สีดำ", "PCTH", "HQ01")), "610311002");
});

test("the real corpus: HQ and branches each answer, and differently", () => {
  const rows = [
    row({ branchCode: "HQ01", glAccountNo: "610311002" }),
    row({ branchCode: "HQ01", glAccountNo: "610311002" }),
    row({ branchCode: "PC1001", glAccountNo: "610113001" }),
    row({ branchCode: "PC1073", glAccountNo: "610113001" }),
    row({ branchCode: "PCCT01", glAccountNo: "610113001" }),
  ];
  assert.equal(decideRemembered(rows, glHistoryKey("Type-c to HDMI สีดำ", "PCTH", "HQ01")), "610311002");
  assert.equal(decideRemembered(rows, glHistoryKey("Type-c to HDMI สีดำ", "PCTH", "PC1001")), "610113001");
});

test("a key that has meant two things remembers nothing", () => {
  const rows = [row({ glAccountNo: "610322005" }), row({ glAccountNo: "610321003" })];
  assert.equal(decideRemembered(rows, glHistoryKey("Type-c to HDMI สีดำ", "PCTH", "HQ01")), null);
});

test("no history remembers nothing", () => {
  assert.equal(decideRemembered([], glHistoryKey("x", "PCTH", "HQ01")), null);
  assert.equal(decideRemembered([row()], glHistoryKey("other", "PCTH", "HQ01")), null);
});
