import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHasAddressRowLacks } from "./rd-vat-core";

const RD = "1000/162 ลิเบอร์ตี้พลาซ่า สุขุมวิท 55 คลองตันเหนือ วัฒนา กรุงเทพมหานคร";

test("the register offers an address the row does not have", () => {
  assert.equal(registerHasAddressRowLacks(null, RD), true);
  assert.equal(registerHasAddressRowLacks("", RD), true);
  assert.equal(registerHasAddressRowLacks("   ", RD), true);
});

test("a row that already has an address is left alone", () => {
  // Read, applied or typed by hand — all the same here. This is what stops the
  // register overwriting somebody's correction.
  assert.equal(registerHasAddressRowLacks("99/1 ถนนสุขุมวิท", RD), false);
});

test("a register with no address offers nothing", () => {
  assert.equal(registerHasAddressRowLacks(null, null), false);
  assert.equal(registerHasAddressRowLacks("", ""), false);
  assert.equal(registerHasAddressRowLacks("", "   "), false);
});

test("it never compares one address against another", () => {
  // Two different real addresses is NOT a gap. The reader takes the address off
  // the invoice as printed and the RD writes its own registry form, so a textual
  // comparison would fire on nearly every row and mean nothing.
  assert.equal(registerHasAddressRowLacks("somewhere else entirely", RD), false);
  assert.equal(registerHasAddressRowLacks(RD, "somewhere else entirely"), false);
});
