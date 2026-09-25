import { test } from "node:test";
import assert from "node:assert/strict";
import { membersToWrite } from "./interface-group-members";

type Row = { brandCode: string; active: boolean; bank: string };
const bankOf = (m: Row) => m.bank;

const ON_SET: Row = { brandCode: "ROCKS", active: true, bank: "BBL-SA8194" };
const ON_BLANK: Row = { brandCode: "PCTH", active: true, bank: "" };
const OFF_SET: Row = { brandCode: "PCMY", active: false, bank: "K-CA6999" };
const OFF_BLANK: Row = { brandCode: "KSI", active: false, bank: "" };

const codes = (rows: Row[]) => rows.map((r) => r.brandCode);

test("an active brand is written whether or not it has a bank yet", () => {
  // The blank one is still written so the save can refuse it by name — that
  // refusal is the point for an active brand, and dropping it here would make
  // the group save silently skip the brand that actually needs attention.
  assert.deepEqual(codes(membersToWrite([ON_SET, ON_BLANK], bankOf)), ["ROCKS", "PCTH"]);
});

test("a disabled brand with no bank is skipped — it cannot block the group", () => {
  assert.deepEqual(codes(membersToWrite([ON_SET, OFF_BLANK], bankOf)), ["ROCKS"]);
});

test("a disabled brand that already has a bank is still written", () => {
  // So the group's shared Journal Batch reaches it, and so an edit made to it
  // in the dialog is not thrown away.
  assert.deepEqual(codes(membersToWrite([ON_SET, OFF_SET], bankOf)), ["ROCKS", "PCMY"]);
});

test("a group of nothing but disabled, blank brands writes nothing", () => {
  assert.deepEqual(membersToWrite([OFF_BLANK], bankOf), []);
  assert.deepEqual(membersToWrite([], bankOf), []);
});

test("bankOf reads the draft, so an unsaved edit brings a disabled brand back in", () => {
  // The dialog holds unsaved edits separately from the loaded row. Keying on
  // the loaded value would drop the edit the admin just made.
  const draft: Record<string, string> = { KSI: "CHQ-PAY" };
  const fromDraft = (m: Row) => draft[m.brandCode] ?? m.bank;
  assert.deepEqual(codes(membersToWrite([OFF_BLANK], fromDraft)), ["KSI"]);
});

test("whitespace is not a bank account", () => {
  assert.deepEqual(membersToWrite([{ ...OFF_BLANK, bank: "   " }], bankOf), []);
});

test("the original order and rows are preserved, and the input is not mutated", () => {
  const input = [OFF_BLANK, ON_SET, OFF_SET];
  const out = membersToWrite(input, bankOf);
  assert.deepEqual(codes(out), ["ROCKS", "PCMY"]);
  assert.equal(out[0], ON_SET);
  assert.equal(input.length, 3);
});
