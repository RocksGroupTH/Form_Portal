import { test } from "node:test";
import assert from "node:assert/strict";
import { glOptionsForLine } from "./useGlOptionsByBranch";
import type { GlAccountOption } from "@/features/clear-advance/types";

/* Only the pure half of the module is covered here. The fetch-and-cache hook
   needs a React renderer, which this repo does not carry — the failure it hid
   (a branch's list fetched, returned 200, and dropped, so the picker offered
   nothing) was caught in the browser instead and is recorded in the commit. */

function opt(glAccountNo: string, nameTh: string, dimensionType = "Employee"): GlAccountOption {
  return { glAccountNo, nameTh, nameEn: null, dimensionType } as GlAccountOption;
}

const HQ = [opt("610311002", "ค่าใช้จ่ายวัสดุเเละอุปกรณ์ IT"), opt("610322005", "ค่าจอดรถ")];

test("a line offers its own branch's accounts", () => {
  const out = glOptionsForLine({ HQ01: HQ }, { branchCode: "HQ01", glAccountNo: null });
  assert.deepEqual(out.map((o) => o.glAccountNo), ["610311002", "610322005"]);
});

test("a line with no branch is offered nothing to pick from", () => {
  assert.deepEqual(glOptionsForLine({ HQ01: HQ }, { branchCode: null, glAccountNo: null }), []);
});

test("a branch whose list has not arrived offers nothing rather than throwing", () => {
  assert.deepEqual(glOptionsForLine({}, { branchCode: "HQ01", glAccountNo: null }), []);
});

test("an account already on the line is not duplicated", () => {
  const out = glOptionsForLine({ HQ01: HQ }, { branchCode: "HQ01", glAccountNo: "610311002" });
  assert.equal(out.length, 2);
  assert.equal(out.filter((o) => o.glAccountNo === "610311002").length, 1);
});

test("a stored account the branch no longer offers still renders, first, with its name", () => {
  // Deactivated in the master, or the line predates a rule change. Dropping it
  // would make an accounted line read as "not chosen".
  const out = glOptionsForLine(
    { HQ01: HQ },
    { branchCode: "HQ01", glAccountNo: "610999999", glAccountName: "บัญชีเก่า" },
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].glAccountNo, "610999999");
  assert.equal(out[0].nameTh, "บัญชีเก่า");
});

test("a stored account with no remembered name still renders", () => {
  const out = glOptionsForLine({ HQ01: HQ }, { branchCode: "HQ01", glAccountNo: "610999999" });
  assert.equal(out[0].glAccountNo, "610999999");
  assert.equal(out[0].nameTh, null);
});
