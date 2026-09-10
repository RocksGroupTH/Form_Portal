import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildRdVatRequest,
  tinsNeedingRdCheck,
  parseRdVatResponse,
  registrantFullName,
  sameRegisteredName,
} from "./rd-vat-core";

/* Trimmed from a real answer, 2026-09-08, for Genesis Supply Chain — the seller
 * on the invoice whose tax id the OCR could not place. Values arrive wrapped in
 * <anyType>, an absent field is self-closing, and the RD writes "-" where it
 * holds nothing. */
const REAL = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope><soap:Body><ServiceResponse><ServiceResult>
<vNID><anyType xsi:type="xsd:string">0105560171921</anyType></vNID>
<vtin />
<vtitleName><anyType xsi:type="xsd:string">บริษัท</anyType></vtitleName>
<vName><anyType xsi:type="xsd:string">เจเนซิส ซัพพลาย เชน จำกัด</anyType></vName>
<vSurname><anyType xsi:type="xsd:string">-</anyType></vSurname>
<vBranchTitleName><anyType xsi:type="xsd:string">บริษัท</anyType></vBranchTitleName>
<vBranchName><anyType xsi:type="xsd:string">เจเนซิส ซัพพลาย เชน จำกัด</anyType></vBranchName>
<vBranchNumber><anyType xsi:type="xsd:int">0</anyType></vBranchNumber>
<vBuildingName><anyType xsi:type="xsd:string">Hong Tower</anyType></vBuildingName>
<vRoomNumber><anyType xsi:type="xsd:string">A702-A703</anyType></vRoomNumber>
<vVillageName><anyType xsi:type="xsd:string">-</anyType></vVillageName>
<vHouseNumber><anyType xsi:type="xsd:string">145/18-19</anyType></vHouseNumber>
<vMooNumber><anyType xsi:type="xsd:string">-</anyType></vMooNumber>
<vSoiName><anyType xsi:type="xsd:string">-</anyType></vSoiName>
<vStreetName><anyType xsi:type="xsd:string">บางขุนเทียน-ชายทะเล</anyType></vStreetName>
<vThambol><anyType xsi:type="xsd:string">แสมดำ</anyType></vThambol>
<vAmphur><anyType xsi:type="xsd:string">บางขุนเทียน</anyType></vAmphur>
<vProvince><anyType xsi:type="xsd:string">กรุงเทพมหานคร</anyType></vProvince>
<vPostCode><anyType xsi:type="xsd:string">10150</anyType></vPostCode>
<vBusinessFirstDate><anyType xsi:type="xsd:string">2017-12-08</anyType></vBusinessFirstDate>
</ServiceResult></ServiceResponse></soap:Body></soap:Envelope>`;

test("the registrant is read out of a real answer", () => {
  const r = parseRdVatResponse(REAL)!;
  assert.equal(r.nid, "0105560171921");
  assert.equal(r.titleName, "บริษัท");
  assert.equal(r.name, "เจเนซิส ซัพพลาย เชน จำกัด");
  assert.equal(r.vatRegisteredOn, "2017-12-08");
});

/* The RD counts branches from 0; BC keeps five digits, and 0 is the head office
 * — the same "00000" the invoice prints as สำนักงานใหญ่. */
test("branch 0 becomes the head-office code", () => {
  const r = parseRdVatResponse(REAL)!;
  assert.equal(r.branchNumber, 0);
  assert.equal(r.branchCode, "00000");
});

test("a numbered branch is padded", () => {
  const xml = REAL.replace(">0</anyType></vBranchNumber>", ">7</anyType></vBranchNumber>");
  assert.equal(parseRdVatResponse(xml)!.branchCode, "00007");
});

/* "-" is how the RD writes an empty field, so it must not reach an address. */
test("dashes are not address lines", () => {
  const r = parseRdVatResponse(REAL)!;
  assert.equal(r.address, "145/18-19 Hong Tower A702-A703 บางขุนเทียน-ชายทะเล แสมดำ บางขุนเทียน กรุงเทพมหานคร 10150");
  assert.ok(!r.address!.includes(" - "));
});

/* Not being registered is an answer, not a failure: small sellers are not on the
 * VAT register, and the caller shows that rather than an error. */
test("no registration reads as null", () => {
  assert.equal(parseRdVatResponse("<ServiceResult><vNID /></ServiceResult>"), null);
  assert.equal(parseRdVatResponse("<ServiceResult></ServiceResult>"), null);
  assert.equal(parseRdVatResponse(""), null);
});

test("the full name reads as it would be written", () => {
  assert.equal(registrantFullName(parseRdVatResponse(REAL)!), "บริษัท เจเนซิส ซัพพลาย เชน จำกัด");
});

test("the request carries only the digits of a tax id", () => {
  const body = buildRdVatRequest(" 0-1055-60171-92-1 ");
  assert.ok(body.includes("<TIN>0105560171921</TIN>"));
  assert.ok(body.includes("<username>anonymous</username>"));
});

/* The register writes the name closed up and the invoice spaces it. Calling that
 * a mismatch would flag nearly every line. */
test("spacing is not a difference in a registered name", () => {
  assert.equal(
    sameRegisteredName("บริษัท เซ็นทรัล พัฒนา จำกัด (มหาชน)", "บริษัท เซ็นทรัลพัฒนา จำกัด (มหาชน)"),
    true,
  );
});

test("a different company is still a difference", () => {
  assert.equal(
    sameRegisteredName("บริษัท เซ็นทรัลพัฒนา จำกัด (มหาชน)", "บริษัท เซ็นทรัลพัฒนา ดีเวลล็อปเม้นท์ จำกัด"),
    false,
  );
});

/* Nothing on the invoice is not a match with anything — it is a blank to fill. */
test("an empty name matches nothing", () => {
  assert.equal(sameRegisteredName("", "บริษัท ก จำกัด"), false);
  assert.equal(sameRegisteredName(null, null), false);
});

/* ── which tax ids the "ตรวจสรรพากร" button still has to ask about ── */

test("six rows sharing a tax id are one thing to ask about", () => {
  const items = [{ taxId: "0105556000001" }, { taxId: "0105556000001" }, { taxId: "0105556000001" }];
  assert.deepEqual(tinsNeedingRdCheck(items, {}), ["0105556000001"]);
});

test("an id already answered is not asked again", () => {
  const items = [{ taxId: "0105556000001" }, { taxId: "0994000000002" }];
  assert.deepEqual(
    tinsNeedingRdCheck(items, { "0105556000001": { state: "found" } }),
    ["0994000000002"],
  );
});

test("an unregistered answer is an answer", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }], { "0105556000001": { state: "unregistered" } }),
    [],
  );
});

test("a failed check is asked again", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }], { "0105556000001": { state: "unknown" } }),
    ["0105556000001"],
  );
});

test("one already in flight is not queued twice", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }], { "0105556000001": { state: "checking" } }),
    [],
  );
});

test("an id that is not thirteen digits is not a question for the registry", () => {
  assert.deepEqual(tinsNeedingRdCheck([{ taxId: "123" }, { taxId: null }, { taxId: "" }], {}), []);
});

test("punctuation in a typed tax id does not make a second id", () => {
  assert.deepEqual(
    tinsNeedingRdCheck([{ taxId: "0105556000001" }, { taxId: "0-1055-56000-00-1" }], {}),
    ["0105556000001"],
  );
});

test("no lines is nothing to ask", () => {
  assert.deepEqual(tinsNeedingRdCheck(null, {}), []);
  assert.deepEqual(tinsNeedingRdCheck([], {}), []);
});
