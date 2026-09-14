import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Two properties of AP-4's ERP context that decide where money posts, that no
 * type enforces, and that a reasonable-looking edit removes silently.
 *
 * Source-reading because `reimburse-erp-context.ts` imports `getAccPool`
 * transitively and therefore `@/env`, which validates the whole environment at
 * import — so nothing on that chain can be exercised from a unit test at all.
 * The payload it feeds is tested for real in `reimburse-erp-payload.test.ts`;
 * what cannot be tested there is which table a value was read from.
 *
 * ## 1. The Journal Batch comes from the per-form table, never from the context
 *
 * `resolveJournalBatchName` (`erp-journal-context.ts`) looks a claim brand's
 * batch up by its **interface** brand first, so a target-keyed row beats every
 * claim-brand row — including AP-4's own `FormCode='AP-4'` override. This
 * repository has already shipped that failure once on AP-2: the settings screen
 * displayed `TRAVELING` while the payload correctly sent `BEE`. Reading
 * `ctx.brandAccounts[...].journalBatchName` here is one line, compiles, and
 * looks like a simplification.
 *
 * ## 2. Every master is keyed on the interface COMPANY, not the claim brand
 *
 * `ROCKS` posts into `PCTH`. A Location or a BU→G/L map read under `ROCKS`
 * answers **empty** rather than wrong, which is the quiet failure: every line
 * silently loses its BU and its account redirect, and nothing on screen says so.
 */

const FILE = path.resolve(process.cwd(), "src/lib/acc/reimburse/reimburse-erp-context.ts");
const raw = fs.readFileSync(FILE, "utf8");

/**
 * Comments stripped, because the file **names** the hazards it avoids — the
 * docblock says "never through `ctx.brandAccounts`", and a guard that searched
 * the raw text would fail on the sentence explaining why it must not happen.
 * Every assertion below is about what the code does, so it reads only code.
 */
const src = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the journal batch is read from the per-form table", () => {
  assert.ok(
    /listBrandJournalBatches\(\s*code,\s*AP4_FORM_CODE\s*\)/.test(src),
    "AP-4's journal batch is no longer read from listBrandJournalBatches(claimBrand, 'AP-4')",
  );
  assert.ok(
    /batchRows\.find\(\(r\) => r\.formCode === AP4_FORM_CODE\)/.test(src),
    "the AP-4 batch row is no longer preferred over the inherited default",
  );
});

test("the journal batch never comes from the shared journal context", () => {
  assert.ok(
    !/brandAccounts/.test(src),
    "reimburse-erp-context reads ctx.brandAccounts — a target-keyed row will beat AP-4's own batch",
  );
});

test("the Locations and both G/L maps are loaded for the interface target", () => {
  for (const fn of ["loadBuGlAccounts", "loadBranchGlAccounts", "loadBranchLookup"]) {
    assert.ok(
      new RegExp(`${fn}\\(interfaceTarget\\)`).test(src),
      `${fn} is no longer keyed on the interface target — a ROCKS claim will silently resolve nothing`,
    );
  }
});

test("the BC target profile is resolved for AP-4, not for whichever form asked last", () => {
  assert.ok(
    /resolveErpTargetProfile\(interfaceTarget, AP4_FORM_CODE\)/.test(src),
    "the BC profile is no longer resolved with AP-4's form code",
  );
});
