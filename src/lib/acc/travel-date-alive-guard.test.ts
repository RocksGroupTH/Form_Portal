import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DEAD_REQUEST_STATUSES,
  isDeadRequestStatus,
} from "@/features/accounting/constants";

/**
 * A dead request owns no travel date.
 *
 * AP-1's unique-date rule excluded `Rejected` from the day it shipped and never
 * `Cancelled`, so a claim its own requester withdrew went on holding its travel
 * date for ever: the picker greyed the day out and a resubmit was refused, with
 * nothing on screen naming the request that held it. Reported 2026-09-24
 * against TOF26-09056 — cancelled, holding 24 Sep — and measured against the
 * live UAT database before and after: that staff member's blocked list went
 * from holding those days to zero.
 *
 * The source-reading half below is the weaker layer, and it is here because the
 * two queries cannot be unit-tested at all (`request-service.ts` reaches a pool,
 * so `@/env` validates the whole environment at import). What it pins is the
 * thing that actually broke: **two queries that have to agree, each spelling
 * the rule itself.**
 */

test("dead means withdrawn or refused, and nothing else", () => {
  assert.deepEqual([...DEAD_REQUEST_STATUSES], ["Cancelled", "Rejected"]);
  assert.equal(isDeadRequestStatus("Cancelled"), true);
  assert.equal(isDeadRequestStatus("Rejected"), true);
});

test("a DRAFT is not dead — it is unfinished", () => {
  /* Its own owner is about to submit it, and letting a second draft take the
     same day would produce two claims that cannot both be filed. */
  assert.equal(isDeadRequestStatus("Draft"), false);
});

test("nothing in flight or finished is dead", () => {
  for (const s of ["Submitted", "ManagerApproved", "Approved", "Completed", "Returned"]) {
    assert.equal(isDeadRequestStatus(s), false, s);
  }
});

test("both AP-1 travel-date queries share ONE predicate, and neither spells it itself", () => {
  const src = fs
    .readFileSync(path.resolve(process.cwd(), "src/lib/acc/request-service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // The picker's list and the submit's refusal. The service's own docblock says
  // they must agree "or the picker lies"; they agree by construction only while
  // both read the same constant.
  const uses = src.match(/\$\{ALIVE_REQUEST_PREDICATE\}/g) ?? [];
  assert.equal(
    uses.length,
    2,
    `expected both travel-date queries to use ALIVE_REQUEST_PREDICATE, found ${uses.length}`,
  );

  // And the predicate is built from the shared list rather than typed out.
  assert.ok(
    /const ALIVE_REQUEST_PREDICATE = [\s\S]{0,120}DEAD_REQUEST_STATUSES/.test(src),
    "ALIVE_REQUEST_PREDICATE no longer derives from DEAD_REQUEST_STATUSES",
  );

  // The shape that was wrong: either query excluding one status by hand.
  assert.equal(
    /Status\s*<>\s*N?'(Rejected|Cancelled)'/.test(src),
    false,
    "a travel-date query excludes one dead status by hand again — that is how Cancelled came to be missed",
  );
});
