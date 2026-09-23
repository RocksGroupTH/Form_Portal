const fs = require("fs");
const f = "src/lib/clr/clear-advance-bank-account.test.ts";
let s = fs.readFileSync(f, "utf8").split("\r\n").join("\n");

const edits = [
  [`test("saveClrBankAccount merges AP-3's own bank row", async () => {
  const { merge, calls } = fakeMerge();

  await saveClrBankAccount("PCMY", "UOB-2726", 42, merge);

  assert.deepEqual(calls[0], ["bank", "PCMY", AP3_FORM_CODE, "UOB-2726", null, 42]);
});`,
   `test("saveClrBankAccount merges AP-3's own bank row", async () => {
  const { merge, calls } = fakeMerge();

  await saveClrBankAccount("PCMY", "UOB-2726", 42, merge);

  // The trailing undefined is the environment, and it is not noise: it means
  // "resolve the request's own", which is what every caller but the settings
  // screen's PRO/UAT toggle passes. A value here would pin the write to one
  // BC half.
  assert.deepEqual(calls[0], ["bank", "PCMY", AP3_FORM_CODE, "UOB-2726", null, 42, undefined]);
});

test("an explicit environment reaches the merge, in the last position", async () => {
  /* Migration 161 split AccBrandBankAccount by BC environment. Without this
     argument arriving, the settings screen's UAT half would write over
     Production's bank account — a real row, no error, and a claim posted
     against a bank card that belongs to the wrong company. */
  const { merge, calls } = fakeMerge();

  await saveClrBankAccount("PCMY", "UOB-2726", 42, merge, "Sandbox");

  assert.equal(calls[0][6], "Sandbox");
});`],

  [`test("fetchRealBrandAccounts forwards to listBrandAccounts in the right order", () => {
  assert.match(SOURCE, /return listBrandAccounts\(kind, brandCode, formCode\);/);
});

test("mergeRealFormBrandAccount forwards to mergeFormBrandAccount in the right order", () => {
  assert.match(
    SOURCE,
    /return mergeFormBrandAccount\(kind, brandCode, formCode, accountNo, erpDescription, userId\);/,
  );
});`,
   `/**
 * Matched against a whitespace-collapsed copy, because these calls are now
 * long enough to be wrapped one-argument-per-line. Pinning the source's line
 * breaks would make the guard fail on a reformat while still missing the
 * swap it exists to catch.
 */
const FLAT = SOURCE.replace(/\s+/g, " ");

test("fetchRealBrandAccounts forwards to listBrandAccounts in the right order", () => {
  assert.match(FLAT, /return listBrandAccounts\( ?kind, brandCode, formCode,? ?\);/);
});

test("mergeRealFormBrandAccount forwards to mergeFormBrandAccount in the right order", () => {
  assert.match(
    FLAT,
    /mergeFormBrandAccount\( ?kind, brandCode, formCode, accountNo, erpDescription, userId,/,
  );
});

test("the environment is the seventh argument, and it is PARSED rather than cast", () => {
  /* The seam's type is a plain string so the fakes above need no import, which
     means a value that is neither 'Production' nor 'Sandbox' could otherwise
     reach the column verbatim — and into the unique key with it. */
  assert.match(FLAT, /userId, parseErpBcEnvironment\(environment\) \?\? undefined,? ?\)/);
});`],

  [`  const mergeSwapped = SOURCE.replace(
    "mergeFormBrandAccount(kind, brandCode, formCode, accountNo, erpDescription, userId)",
    "mergeFormBrandAccount(kind, brandCode, accountNo, formCode, erpDescription, userId)",
  );
  assert.notEqual(mergeSwapped, SOURCE, "the replace must actually find something to swap");
  assert.doesNotMatch(
    mergeSwapped,
    /return mergeFormBrandAccount\(kind, brandCode, formCode, accountNo, erpDescription, userId\);/,
  );
});`,
   `  const mergeSwapped = FLAT.replace(
    "kind, brandCode, formCode, accountNo, erpDescription, userId,",
    "kind, brandCode, accountNo, formCode, erpDescription, userId,",
  );
  assert.notEqual(mergeSwapped, FLAT, "the replace must actually find something to swap");
  assert.doesNotMatch(
    mergeSwapped,
    /mergeFormBrandAccount\( ?kind, brandCode, formCode, accountNo, erpDescription, userId,/,
  );

  // And the environment arm is not vacuous either: dropping the parse leaves
  // a cast-shaped forward that this must refuse.
  const parseDropped = FLAT.replace(
    "parseErpBcEnvironment(environment) ?? undefined",
    "environment as never",
  );
  assert.notEqual(parseDropped, FLAT, "the replace must actually find something to drop");
  assert.doesNotMatch(parseDropped, /parseErpBcEnvironment\(environment\) \?\? undefined/);
});`],

  [`  const fetchSwapped = SOURCE.replace(
    "listBrandAccounts(kind, brandCode, formCode)",
    "listBrandAccounts(kind, formCode, brandCode)",
  );
  assert.notEqual(fetchSwapped, SOURCE, "the replace must actually find something to swap");
  assert.doesNotMatch(fetchSwapped, /return listBrandAccounts\(kind, brandCode, formCode\);/);`,
   `  const fetchSwapped = FLAT.replace(
    "listBrandAccounts(kind, brandCode, formCode)",
    "listBrandAccounts(kind, formCode, brandCode)",
  );
  assert.notEqual(fetchSwapped, FLAT, "the replace must actually find something to swap");
  assert.doesNotMatch(fetchSwapped, /return listBrandAccounts\( ?kind, brandCode, formCode,? ?\);/);`],
];

for (let i = 0; i < edits.length; i++) {
  const [from, to] = edits[i];
  const n = s.split(from).length - 1;
  if (n !== 1) { console.log(`MISS/AMBIG step ${i + 1} (${n})`); process.exit(1); }
  s = s.replace(from, to);
}
fs.writeFileSync(f, s.split("\n").join("\r\n"));
console.log("ok");
