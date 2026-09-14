import { test } from "node:test";
import assert from "node:assert/strict";
import { nameOverrideFor } from "./gl-name";

const BC = "เงินสดย่อย";

test("typing Business Central's own wording back is not an override", () => {
  // The box is FILLED with this, so tabbing through a row must store nothing.
  // Otherwise the first pass down the column freezes today's BC wording into
  // the register on every row it touches, and a later rename in BC stops
  // reaching the screen.
  assert.equal(nameOverrideFor(BC, BC), null);
});

test("surrounding space is not a difference", () => {
  assert.equal(nameOverrideFor(`  ${BC} `, BC), null);
});

test("a different name IS an override", () => {
  assert.equal(nameOverrideFor("เงินสดย่อย (สำนักงานใหญ่)", BC), "เงินสดย่อย (สำนักงานใหญ่)");
});

test("an emptied box means follow Business Central — the same as matching it", () => {
  // Which is how an override is removed: there is one way to say "follow BC"
  // and both gestures reach it.
  assert.equal(nameOverrideFor("", BC), null);
  assert.equal(nameOverrideFor("   ", BC), null);
});

test("with no Business Central wording, anything typed is an override", () => {
  // A rule on an account the sync no longer returns: there is nothing for the
  // typed name to be the same as, so it can only be a name somebody chose.
  assert.equal(nameOverrideFor("ชื่อที่ตั้งเอง", null), "ชื่อที่ตั้งเอง");
  assert.equal(nameOverrideFor("", null), null);
});

test("the stored value is trimmed, so two spellings of one name cannot both exist", () => {
  assert.equal(nameOverrideFor("  ชื่อใหม่  ", BC), "ชื่อใหม่");
});
