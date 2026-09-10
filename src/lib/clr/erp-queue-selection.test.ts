import { test } from "node:test";
import assert from "node:assert/strict";
import { effectiveSelection } from "./erp-queue-selection";

/* The rows behind these ids are the real ones: on 2026-09-10 the รอส่ง tab held
   ADC26-09023, ADC26-09030, ADC26-09003 and ADC26-09006, and the last two were
   cancelled a minute apart while ticked. */
const ADC_09023 = 901133;
const ADC_09030 = 901131;
const ADC_09003 = 900035;
const ADC_09006 = 900063;

test("a tick on a row that has since been cancelled stops counting", () => {
  // All four were ticked, then two were cancelled and the list revalidated.
  const ticked = new Set([ADC_09023, ADC_09030, ADC_09003, ADC_09006]);
  const stillSendable = [ADC_09023, ADC_09030];

  assert.deepEqual(effectiveSelection(ticked, stillSendable), [ADC_09023, ADC_09030]);
});

test("reading the Set directly is what put a cancelled clearing in the preview", () => {
  const ticked = new Set([ADC_09023, ADC_09003]);
  const stillSendable = [ADC_09023];

  // What the queue used to hand the preview.
  assert.deepEqual(Array.from(ticked), [ADC_09023, ADC_09003]);
  // What it hands the preview now.
  assert.deepEqual(effectiveSelection(ticked, stillSendable), [ADC_09023]);
});

test("cancelling the only ticked row leaves nothing to preview or send", () => {
  assert.deepEqual(effectiveSelection(new Set([ADC_09003]), [ADC_09023, ADC_09030]), []);
});

test("a row that left the queue any other way stops counting too", () => {
  // Sent by another admin between the list load and the click — the send has
  // always refused this; the counter and the preview did not.
  assert.deepEqual(effectiveSelection(new Set([ADC_09023, ADC_09030]), [ADC_09030]), [ADC_09030]);
});

test("the order is the table's, not the order the boxes were clicked", () => {
  const ticked = new Set([ADC_09030, ADC_09023]); // clicked bottom row first
  assert.deepEqual(effectiveSelection(ticked, [ADC_09023, ADC_09030]), [ADC_09023, ADC_09030]);
});

test("nothing ticked selects nothing, and ticks with no rows select nothing", () => {
  assert.deepEqual(effectiveSelection(new Set(), [ADC_09023]), []);
  assert.deepEqual(effectiveSelection(new Set([ADC_09023]), []), []);
});
