import assert from "node:assert/strict";
import { test } from "node:test";
import { pickKnownSellers } from "./known-seller-core";

const row = (tin: string, name: string, uses = 1) => ({ tin, payeeName: name, uses });

/* Sellers this form has cleared before and an accountant approved. It is the
   third place a name can come from, after the Revenue Department's register and
   our own vendor cards — and the only one that knows the shop on the corner. */

test("a seller cleared before is remembered by its number", () => {
  const m = pickKnownSellers([row("0105560171921", "บริษัท เจเนซิส ซัพพลาย เชน จำกัด", 5)]);
  assert.equal(m.get("0105560171921"), "บริษัท เจเนซิส ซัพพลาย เชน จำกัด");
});

/* The guard that makes history usable at all. This is not a registry — it is
   whatever got past an approver, and a number misread once and approved would
   otherwise be taught back to every future read. A tax id carries its own
   proof, so one that fails it was never real and is not remembered. Four of the
   eleven sellers in UAT fail exactly here, including both halves of an
   "อินฟินิตี้ / อินฟินิตี้ อินฟินิตี้" pair that is plainly one misread
   company (measured 2026-09-12). */
test("a number that fails its own check digit is not remembered", () => {
  const m = pickKnownSellers([
    row("0105655008978", "บริษัท อินฟินิตี้ อินฟินิตี้ จำกัด", 9),
    row("0105564122649", "บริษัท พีพี แสตมป์ จำกัด"),
  ]);
  assert.equal(m.has("0105655008978"), false);
  assert.equal(m.get("0105564122649"), "บริษัท พีพี แสตมป์ จำกัด");
});

test("the spelling used most often is the one remembered", () => {
  const m = pickKnownSellers([
    row("0105564122649", "บริษัท พีพี แสตมป์ จำกัด", 4),
    row("0105564122649", "บริษัท พีพี สแตมป จำกัด", 1),
  ]);
  assert.equal(m.get("0105564122649"), "บริษัท พีพี แสตมป์ จำกัด");
});

/* Two spellings used equally often is the form admitting it does not know. A
   coin toss here writes a name onto a tax filing. */
test("a tie is not an answer", () => {
  const m = pickKnownSellers([
    row("0105564122649", "บริษัท พีพี แสตมป์ จำกัด", 2),
    row("0105564122649", "บริษัท พีพี สแตมป จำกัด", 2),
  ]);
  assert.equal(m.has("0105564122649"), false);
});

test("spacing is not two spellings", () => {
  const m = pickKnownSellers([
    row("0105564122649", "บริษัท พีพี แสตมป์ จำกัด", 2),
    row("0105564122649", "บริษัท  พีพี  แสตมป์  จำกัด ", 2),
  ]);
  assert.equal(m.get("0105564122649"), "บริษัท พีพี แสตมป์ จำกัด");
});

test("an empty name is not a spelling, and a short number is not a tax id", () => {
  const m = pickKnownSellers([
    row("0105564122649", "   ", 9),
    row("010556412264", "บริษัท สั้นไป จำกัด"),
  ]);
  assert.equal(m.size, 0);
});
