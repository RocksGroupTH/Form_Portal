import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeVendorRow, normalizeVendorSnapshot } from "./vendor-normalization";

const ID = "1f922f67-bde8-4d7f-bec1-1fc2bcc08228";

test("normalizes a Standard API v2.0 vendor including Thai Unicode", () => {
  const vendor = normalizeVendorRow({
    id: ID,
    number: " V0001 ",
    displayName: "บริษัท ทดสอบ จำกัด",
    country: "TH",
    taxLiable: true,
    blocked: "Payment",
    lastModifiedDateTime: "2026-08-26T03:04:05Z",
  });
  assert.equal(vendor.vendorNo, "V0001");
  assert.equal(vendor.displayName, "บริษัท ทดสอบ จำกัด");
  assert.equal(vendor.countryCode, "TH");
  assert.equal(vendor.taxLiable, true);
  assert.equal(vendor.isBlocked, true);
  assert.equal(vendor.bcLastModified?.toISOString(), "2026-08-26T03:04:05.000Z");
});

test("blank blocked and zero reference GUIDs become active null values", () => {
  const vendor = normalizeVendorRow({
    id: ID,
    number: "V0002",
    blocked: " ",
    currencyId: "00000000-0000-0000-0000-000000000000",
  });
  assert.equal(vendor.isBlocked, false);
  assert.equal(vendor.blockedStatus, null);
  assert.equal(vendor.currencyId, null);
});

test("OData blank enum encoding is not treated as a blocked vendor", () => {
  const vendor = normalizeVendorRow({ id: ID, number: "V0006", blocked: "_x0020_" });
  assert.equal(vendor.blockedStatus, null);
  assert.equal(vendor.isBlocked, false);
});

test("accepts BC SQL uniqueidentifiers without RFC version bits", () => {
  const vendor = normalizeVendorRow({
    id: "e0b95673-e94b-ef11-ac21-6045bdc8f240",
    number: "V0005",
  });
  assert.equal(vendor.bcVendorId, "e0b95673-e94b-ef11-ac21-6045bdc8f240");
});

test("rejects incomplete rows so a partial contract cannot deactivate good data", () => {
  assert.throws(() => normalizeVendorRow({ id: ID }), /missing number/);
  assert.throws(() => normalizeVendorRow({ number: "V0003" }), /missing id/);
});

test("deduplicates identical ids and rejects conflicting duplicates", () => {
  assert.equal(normalizeVendorSnapshot([
    { id: ID, number: "V0004" },
    { id: ID, number: "V0004" },
  ]).length, 1);
  assert.throws(() => normalizeVendorSnapshot([
    { id: ID, number: "V0004" },
    { id: ID, number: "V9999" },
  ]), /conflicting duplicate id/);
});
