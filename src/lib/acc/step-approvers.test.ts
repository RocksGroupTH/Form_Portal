import { test } from "node:test";
import assert from "node:assert/strict";
import { approverNamesFor, postsIntoFor, type StepApproverPayload } from "./step-approvers";

/**
 * Who the `รออนุมัติโดย` tooltip names.
 *
 * The column says `บัญชี` for a pool step and that is all a requester ever
 * learned, because `AccApproval` records no assignee on a pool row — measured
 * 2026-09-24: 0 of 12 on AP-1's `ACCOUNT`, against 7 of 7 on its `MANAGER`.
 */

const PAYLOAD: StepApproverPayload = {
  Production: {
    "AP-1": {
      steps: {
        ACCOUNT: [
          { name: "Plume Pasapong", brands: null }, // unrestricted
          /* As the LOADER emits it: a tick on the PCTH target is expanded
             into every claim brand that posts into PCTH, which is why PCMY and
             ROCKS are here beside it. The expansion is done server-side so
             this module only ever compares claim brands. */
          { name: "Kan Kanjanaporn", brands: ["PCTH", "PCMY", "ROCKS"] },
          { name: "Sa Nipaporn", brands: ["KSI"] },
        ],
      },
      // PCMY's claims post into PCTH's books — measured on the live map.
      postsInto: { PCMY: "PCTH", ROCKS: "PCTH" },
    },
    "AP-4": { steps: { ACCOUNT: [{ name: "Gail Salin", brands: [] }] }, postsInto: {} },
  },
  UAT: {
    "AP-1": { steps: { ACCOUNT: [{ name: "Only In UAT", brands: null }] }, postsInto: {} },
  },
};

test("a pool step lists the people who may act on THAT claim's brand", () => {
  assert.deepEqual(
    approverNamesFor(PAYLOAD, {
      environment: "Production",
      formCode: "AP-1",
      stepCode: "ACCOUNT",
      brandCode: "PCTH",
    }),
    ["Plume Pasapong", "Kan Kanjanaporn"],
  );
});

test("somebody scoped to another brand is left out", () => {
  const names = approverNamesFor(PAYLOAD, {
    environment: "Production",
    formCode: "AP-1",
    stepCode: "ACCOUNT",
    brandCode: "KSI",
  });
  assert.deepEqual(names, ["Plume Pasapong", "Sa Nipaporn"]);
});

test("MANAGER answers null — the row already names that person", () => {
  /* Not an empty list: `null` tells the caller to fall back to what the row
     itself carries, which for a manager step is an actual assignee. */
  assert.equal(
    approverNamesFor(PAYLOAD, {
      environment: "Production",
      formCode: "AP-1",
      stepCode: "MANAGER",
      brandCode: "PCTH",
    }),
    null,
  );
});

test("a step nothing is known about answers null, not an empty list", () => {
  for (const q of [
    { formCode: "AP-1", stepCode: "SOMETHING_NEW" },
    { formCode: "AP-99", stepCode: "ACCOUNT" },
    { environment: "Nowhere", formCode: "AP-1", stepCode: "ACCOUNT" },
  ]) {
    assert.equal(approverNamesFor(PAYLOAD, { environment: "Production", ...q }), null);
  }
  assert.equal(approverNamesFor(null, { formCode: "AP-1", stepCode: "ACCOUNT" }), null);
});

test("EMPTY is a real answer and must not collapse into null", () => {
  /* AP-4's seeded ROCKS brand maps to no interface target, so its claims are
     actionable by nobody until an admin maps it. That is the single most
     worth-saying thing this tooltip can say. */
  assert.deepEqual(
    approverNamesFor(PAYLOAD, {
      environment: "Production",
      formCode: "AP-4",
      stepCode: "ACCOUNT",
      brandCode: "ROCKS",
    }),
    [],
  );
});

test("the two environments are kept apart — two rosters are not dual-written", () => {
  assert.deepEqual(
    approverNamesFor(PAYLOAD, { environment: "UAT", formCode: "AP-1", stepCode: "ACCOUNT", brandCode: "PCTH" }),
    ["Only In UAT"],
  );
  // An absent environment falls back to Production rather than answering null:
  // the older rows in these lists predate the tag.
  assert.deepEqual(
    approverNamesFor(PAYLOAD, { formCode: "AP-1", stepCode: "ACCOUNT", brandCode: "PCTH" }),
    ["Plume Pasapong", "Kan Kanjanaporn"],
  );
});

test("no brand on the row over-lists rather than claiming nobody can act", () => {
  const names = approverNamesFor(PAYLOAD, {
    environment: "Production",
    formCode: "AP-1",
    stepCode: "ACCOUNT",
    brandCode: null,
  });
  assert.deepEqual(names, ["Plume Pasapong", "Kan Kanjanaporn", "Sa Nipaporn"]);
  // …but somebody who may act on nothing is still nobody.
  assert.deepEqual(
    approverNamesFor(PAYLOAD, { environment: "Production", formCode: "AP-4", stepCode: "ACCOUNT" }),
    [],
  );
});

test("what comes back is names, never an address — the user chose names only", () => {
  /* The route selects no email at all, so this pins the shape rather than a
     filter: anything that starts returning one would show up here first. */
  const names = approverNamesFor(PAYLOAD, {
    environment: "Production",
    formCode: "AP-1",
    stepCode: "ACCOUNT",
    brandCode: "PCTH",
  });
  for (const n of names ?? []) assert.doesNotMatch(n, /@/);
});

test("a claim posting into another company's books says so", () => {
  /* The report that prompted this: a PCMY claim listed seven people scoped to
     PCTH and read as "nobody ticked PCMY, why are they here?". They genuinely
     can act — `canActOnClaimBrand` maps the claim to its ERP target before
     comparing — so the card explains instead of hiding them. */
  const q = { environment: "Production", formCode: "AP-1", brandCode: "PCMY" };
  assert.equal(postsIntoFor(PAYLOAD, q), "PCTH");
  assert.deepEqual(approverNamesFor(PAYLOAD, { ...q, stepCode: "ACCOUNT" }), [
    "Plume Pasapong",
    "Kan Kanjanaporn",
  ]);
});

test("a brand posting into its own books says nothing — that is every ordinary row", () => {
  for (const brandCode of ["PCTH", "KSI", "UNO", "", null, undefined]) {
    assert.equal(
      postsIntoFor(PAYLOAD, { environment: "Production", formCode: "AP-1", brandCode }),
      null,
      `${brandCode} should not claim to post elsewhere`,
    );
  }
});

test("forms that do not scope on targets carry no posting note at all", () => {
  /* AP-17 scopes on claim brands and AP-2/AP-3 do not scope by brand, so a
     "posts into" line there would explain a rule those forms never apply. */
  assert.equal(postsIntoFor(PAYLOAD, { environment: "Production", formCode: "AP-4", brandCode: "PCMY" }), null);
  assert.equal(postsIntoFor(PAYLOAD, { environment: "Production", formCode: "AP-17", brandCode: "PCMY" }), null);
  assert.equal(postsIntoFor(undefined, { formCode: "AP-1", brandCode: "PCMY" }), null);
});
