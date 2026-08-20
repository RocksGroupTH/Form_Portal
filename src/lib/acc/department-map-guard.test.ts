import { test } from "node:test";
import assert from "node:assert/strict";
import { boundLegacyClaimCodes, legacyClaimPurgeError } from "./department-map-guard";

/** What `getAllowedBrands(AP1_FORM_CODE)` returns on the live configuration. */
const allowed = ["ROCKS", "PCTH", "KSI", "PCMY", "UNO"];

test("the codes the mapping dialog actually sends survive", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["PCTH", "ROCKS"], "KSI", allowed);
  assert.deepEqual(codes, ["PCTH", "ROCKS"]);
  assert.deepEqual(rejected, []);
});

test("a brand that is not enabled in AP-1 is refused, not silently skipped", () => {
  // The finding: every entry went straight into
  // `DELETE FROM DepartmentErpMap WHERE BrandCode = @brand`.
  const { codes, rejected } = boundLegacyClaimCodes(["PCTH", "ACME"], "KSI", allowed);
  assert.deepEqual(rejected, ["ACME"]);
  // The recognised half is still reported, but the service refuses the whole
  // request on a non-empty `rejected` — a partial purge is not a safe fallback.
  assert.deepEqual(codes, ["PCTH"]);
});

test("naming every brand no longer empties the table for every brand", () => {
  const everything = ["PCTH", "KSI", "PCMY", "UNO", "ROCKS", "FAST", "ACC", "HR"];
  const { rejected } = boundLegacyClaimCodes(everything, "KSI", allowed);
  assert.deepEqual(rejected, ["FAST", "ACC", "HR"]);
});

test("the target brand is never purged — the save just wrote those rows", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["KSI", " ksi "], "KSI", allowed);
  assert.deepEqual(codes, []);
  assert.deepEqual(rejected, []);
});

test("codes are uppercased, trimmed and de-duplicated", () => {
  const { codes } = boundLegacyClaimCodes([" pcth ", "PCTH", "pcth"], "KSI", allowed);
  assert.deepEqual(codes, ["PCTH"]);
});

test("blank entries are dropped rather than refused", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["", "   ", "PCTH"], "KSI", allowed);
  assert.deepEqual(codes, ["PCTH"]);
  assert.deepEqual(rejected, []);
});

test("a non-array purges nothing at all", () => {
  // `for (const c of "PCTH")` walks four characters, so a bare string used to
  // become four deletes. It is not a list; it clears nothing.
  for (const bogus of ["PCTH", null, undefined, 7, { PCTH: true }]) {
    assert.deepEqual(boundLegacyClaimCodes(bogus, "KSI", allowed), {
      codes: [],
      rejected: [],
    });
  }
});

test("a non-string entry inside the array is refused", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["PCTH", 1, null], "KSI", allowed);
  assert.deepEqual(codes, ["PCTH"]);
  assert.deepEqual(rejected, ["1", "null"]);
});

test("an empty allowlist refuses everything", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["PCTH"], "KSI", []);
  assert.deepEqual(codes, []);
  assert.deepEqual(rejected, ["PCTH"]);
});

test("the allowlist is matched case-insensitively", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["pcth"], "KSI", [" pcth "]);
  assert.deepEqual(codes, ["PCTH"]);
  assert.deepEqual(rejected, []);
});

test("the error names what was refused and caps a long list", () => {
  assert.equal(
    legacyClaimPurgeError(["ACME"]),
    "ล้าง mapping ของแบรนด์ที่ไม่ได้เปิดใช้ใน AP-1 ไม่ได้: ACME",
  );
  const many: string[] = [];
  for (let i = 0; i < 13; i++) many.push(`B${i}`);
  const message = legacyClaimPurgeError(many);
  assert.ok(message.indexOf("B9") !== -1);
  assert.ok(message.indexOf("B10") === -1);
  assert.ok(message.indexOf("(+3)") !== -1);
});
