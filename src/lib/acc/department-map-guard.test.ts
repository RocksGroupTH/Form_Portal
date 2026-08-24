import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundLegacyClaimCodes,
  claimCodesForInterfaceTarget,
  legacyClaimPurgeError,
} from "./department-map-guard";

/**
 * `AccBrandErpInterface` in the shape `listBrandErpInterfaceMaps()` returns it:
 * every claim brand and the interface brand whose books it posts to. KSI is the
 * target under test, and only ROCKS and KSI itself point at it.
 */
const INTERFACE_MAPS = [
  { brandCode: "ROCKS", interfaceBrandCode: "KSI" },
  { brandCode: "KSI", interfaceBrandCode: "KSI" },
  { brandCode: "PCTH", interfaceBrandCode: "PCTH" },
  { brandCode: "PCMY", interfaceBrandCode: "PCMY" },
  { brandCode: "UNO", interfaceBrandCode: "UNO" },
];

/** What the dialog's KSI group is built from, and all a KSI save may clear. */
const ksiClaims = claimCodesForInterfaceTarget(INTERFACE_MAPS, "KSI");

/* ── claimCodesForInterfaceTarget ────────────────────────────────────────── */

test("only the claim brands pointing at this target come back", () => {
  assert.deepEqual(ksiClaims, ["ROCKS", "KSI"]);
  assert.deepEqual(claimCodesForInterfaceTarget(INTERFACE_MAPS, "PCTH"), ["PCTH"]);
});

test("a target nothing points at owns no claim brands", () => {
  assert.deepEqual(claimCodesForInterfaceTarget(INTERFACE_MAPS, "ACME"), []);
});

test("a blank target never resolves to everything", () => {
  // The bound is passed straight to `boundLegacyClaimCodes`; returning the whole
  // table for an empty string would hand a malformed save the old behaviour.
  assert.deepEqual(claimCodesForInterfaceTarget(INTERFACE_MAPS, ""), []);
  assert.deepEqual(claimCodesForInterfaceTarget(INTERFACE_MAPS, "   "), []);
});

test("both sides are trimmed, uppercased and de-duplicated", () => {
  assert.deepEqual(
    claimCodesForInterfaceTarget(
      [
        { brandCode: " rocks ", interfaceBrandCode: " ksi " },
        { brandCode: "ROCKS", interfaceBrandCode: "KSI" },
        { brandCode: "", interfaceBrandCode: "KSI" },
      ],
      "ksi",
    ),
    ["ROCKS"],
  );
});

/* ── boundLegacyClaimCodes ───────────────────────────────────────────────── */

test("the codes the mapping dialog actually sends survive", () => {
  // The dialog posts `group.claimBrands`, which is this list verbatim.
  const { codes, rejected } = boundLegacyClaimCodes(ksiClaims, "KSI", ksiClaims);
  assert.deepEqual(codes, ["ROCKS"]); // KSI is the target — see below
  assert.deepEqual(rejected, []);
});

test("a brand that does not point at this target is refused, not silently skipped", () => {
  // The finding: every entry went straight into
  // `DELETE FROM DepartmentErpMap WHERE BrandCode = @brand`.
  const { codes, rejected } = boundLegacyClaimCodes(["ROCKS", "ACME"], "KSI", ksiClaims);
  assert.deepEqual(rejected, ["ACME"]);
  // The recognised half is still reported, but the service refuses the whole
  // request on a non-empty `rejected` — a partial purge is not a safe fallback.
  assert.deepEqual(codes, ["ROCKS"]);
});

test("naming every brand no longer empties the table for every brand", () => {
  // This is the case the AP-1 allowlist did not bound: it contains every claim
  // brand, so PCTH, PCMY and UNO all passed and a single KSI save purged them.
  // Bounding on the target's own claims is what makes the guard's promise true.
  const everything = ["PCTH", "KSI", "PCMY", "UNO", "ROCKS", "FAST", "ACC", "HR"];
  const { codes, rejected } = boundLegacyClaimCodes(everything, "KSI", ksiClaims);
  assert.deepEqual(codes, ["ROCKS"]);
  assert.deepEqual(rejected, ["PCTH", "PCMY", "UNO", "FAST", "ACC", "HR"]);
});

test("a sibling target's own claim brands are not this target's to clear", () => {
  const { codes, rejected } = boundLegacyClaimCodes(
    ["PCTH"],
    "KSI",
    claimCodesForInterfaceTarget(INTERFACE_MAPS, "KSI"),
  );
  assert.deepEqual(codes, []);
  assert.deepEqual(rejected, ["PCTH"]);
});

test("an unassigned claim brand — one with no interface row — is refused", () => {
  const maps = INTERFACE_MAPS.concat();
  const { rejected } = boundLegacyClaimCodes(
    ["NEWCO"],
    "KSI",
    claimCodesForInterfaceTarget(maps, "KSI"),
  );
  assert.deepEqual(rejected, ["NEWCO"]);
});

test("the target brand is never purged — the save just wrote those rows", () => {
  // KSI maps to itself, so it *is* in the purgeable list; the target test still
  // drops it, which is why that check does not depend on the row's absence.
  const { codes, rejected } = boundLegacyClaimCodes(["KSI", " ksi "], "KSI", ksiClaims);
  assert.deepEqual(codes, []);
  assert.deepEqual(rejected, []);
});

test("codes are uppercased, trimmed and de-duplicated", () => {
  const { codes } = boundLegacyClaimCodes([" rocks ", "ROCKS", "rocks"], "KSI", ksiClaims);
  assert.deepEqual(codes, ["ROCKS"]);
});

test("blank entries are dropped rather than refused", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["", "   ", "ROCKS"], "KSI", ksiClaims);
  assert.deepEqual(codes, ["ROCKS"]);
  assert.deepEqual(rejected, []);
});

test("a non-array purges nothing at all", () => {
  // `for (const c of "PCTH")` walks four characters, so a bare string used to
  // become four deletes. It is not a list; it clears nothing.
  for (const bogus of ["ROCKS", null, undefined, 7, { ROCKS: true }]) {
    assert.deepEqual(boundLegacyClaimCodes(bogus, "KSI", ksiClaims), {
      codes: [],
      rejected: [],
    });
  }
});

test("a non-string entry inside the array is refused", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["ROCKS", 1, null], "KSI", ksiClaims);
  assert.deepEqual(codes, ["ROCKS"]);
  assert.deepEqual(rejected, ["1", "null"]);
});

test("an empty purgeable list refuses everything", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["ROCKS"], "KSI", []);
  assert.deepEqual(codes, []);
  assert.deepEqual(rejected, ["ROCKS"]);
});

test("the purgeable list is matched case-insensitively", () => {
  const { codes, rejected } = boundLegacyClaimCodes(["rocks"], "KSI", [" rocks "]);
  assert.deepEqual(codes, ["ROCKS"]);
  assert.deepEqual(rejected, []);
});

/* ── the refusal ─────────────────────────────────────────────────────────── */

test("the error names what was refused, the remedy, and caps a long list", () => {
  const one = legacyClaimPurgeError(["ACME"]);
  assert.ok(one.indexOf("ACME") !== -1);
  // A stale claim → target mapping is the honest cause, so say to reload.
  assert.ok(one.indexOf("โหลดหน้านี้ใหม่") !== -1);

  const many: string[] = [];
  for (let i = 0; i < 13; i++) many.push(`B${i}`);
  const message = legacyClaimPurgeError(many);
  assert.ok(message.indexOf("B9") !== -1);
  assert.ok(message.indexOf("B10") === -1);
  assert.ok(message.indexOf("(+3)") !== -1);
});
