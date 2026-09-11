import { test } from "node:test";
import assert from "node:assert/strict";
import { clrTimelineSteps } from "./clear-advance-timeline";
import { CLR_NEXT_STEP, CLR_STEP_CODES } from "@/features/clear-advance/constants";

/* The head-accounting step was removed on 2026-09-11 (CR item 1). Two things
   have to stay true afterwards: the chain ends at the account step, and a
   request approved under the old chain still shows all three on its timeline
   rather than having its own history quietly rewritten. */

test("the chain is manager then account, and account is the end of it", () => {
  assert.deepEqual([...CLR_STEP_CODES], ["MANAGER", "ACCOUNT"]);
  assert.equal(CLR_NEXT_STEP.MANAGER, "ACCOUNT");
  assert.equal(CLR_NEXT_STEP.ACCOUNT, null);
});

test("a request with only the current chain's rows draws the chain", () => {
  assert.deepEqual(clrTimelineSteps(["MANAGER", "ACCOUNT"]), ["MANAGER", "ACCOUNT"]);
});

test("a request still at the manager step draws both, the second one pending", () => {
  assert.deepEqual(clrTimelineSteps(["MANAGER"]), ["MANAGER", "ACCOUNT"]);
});

test("a request approved under the old chain keeps its head step", () => {
  assert.deepEqual(clrTimelineSteps(["MANAGER", "ACCOUNT", "HEAD"]), ["MANAGER", "ACCOUNT", "HEAD"]);
});

test("the order is the order it happened in, whatever order the rows arrive in", () => {
  assert.deepEqual(clrTimelineSteps(["HEAD", "ACCOUNT", "MANAGER"]), ["MANAGER", "ACCOUNT", "HEAD"]);
});

test("a step code nobody recognises is not drawn", () => {
  assert.deepEqual(clrTimelineSteps(["MANAGER", "DIRECTOR"]), ["MANAGER", "ACCOUNT"]);
});

test("no rows at all — a draft — still draws the chain to come", () => {
  assert.deepEqual(clrTimelineSteps([]), ["MANAGER", "ACCOUNT"]);
});
