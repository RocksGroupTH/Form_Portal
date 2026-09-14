import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cardsByName,
  cardsByTaxId,
  pickMatchedVendor,
  planVendorMatch,
  vendorRequired,
  type VendorCard,
} from "./vendor-match-core";

const CARDS: VendorCard[] = [
  { vendorNo: "V0001", displayName: "บริษัท ข้าว โซ อิ กรุ๊ป จำกัด", taxRegistrationNumber: "0105566077543" },
  { vendorNo: "V0002", displayName: "บริษัท ข้าว โซ อิ กรุ๊ป จำกัด (สาขาลาดพร้าว)", taxRegistrationNumber: "0105566077543" },
  { vendorNo: "V0003", displayName: "บริษัท เดอะ วัน ซัพพลาย จำกัด", taxRegistrationNumber: "0107537002443" },
  { vendorNo: "V0004", displayName: "ร้านลุงหมี", taxRegistrationNumber: null },
];

/* ── step 1: the tax id ── */

test("one card carrying the tax id is the match, and no model is asked", () => {
  const plan = planVendorMatch({ vendorTaxId: "0107537002443", vendorName: "อะไรก็ตาม" }, CARDS);
  assert.deepEqual(plan, { kind: "matched", vendorNo: "V0003", via: "taxId" });
});

test("punctuation in the typed tax id is not part of the number", () => {
  // A receipt prints it grouped; the card holds it bare, or the other way round.
  const plan = planVendorMatch({ vendorTaxId: "0-1075-37002-44-3", vendorName: null }, CARDS);
  assert.deepEqual(plan, { kind: "matched", vendorNo: "V0003", via: "taxId" });
});

test("a tax id on TWO cards is not a match — it falls through to the name", () => {
  // One tax id genuinely maps to many cards: a head office and its branches.
  // Picking the first is a guess that lands in a subledger.
  const plan = planVendorMatch(
    { vendorTaxId: "0105566077543", vendorName: "บริษัท ข้าว โซ อิ กรุ๊ป จำกัด (สาขาลาดพร้าว)" },
    CARDS,
  );
  assert.equal(plan.kind, "ask");
  assert.deepEqual(
    plan.kind === "ask" ? plan.candidates.map((c) => c.vendorNo) : [],
    ["V0001", "V0002"],
  );
});

test("cardsByTaxId ignores a blank or unreadable tax id rather than matching the cards with none", () => {
  // `taxRegistrationNumber: null` must never equal "no tax id typed".
  assert.deepEqual(cardsByTaxId(CARDS, ""), []);
  assert.deepEqual(cardsByTaxId(CARDS, null), []);
  assert.deepEqual(cardsByTaxId(CARDS, "abc"), []);
});

/* ── step 2: the name ── */

test("the distinctive words narrow the list; the boilerplate does not", () => {
  // "บริษัท ... จำกัด" is true of three of these four cards.
  const hits = cardsByName(CARDS, "บริษัท เดอะ วัน ซัพพลาย จำกัด");
  assert.deepEqual(hits.map((c) => c.vendorNo), ["V0003"]);
});

test("a name matching nothing asks nobody", () => {
  const plan = planVendorMatch({ vendorTaxId: null, vendorName: "ร้านที่ไม่มีอยู่จริง" }, CARDS);
  assert.deepEqual(plan, { kind: "none" });
});

test("a seller with no name and no tax id is 'none', not every card", () => {
  // `vendorMatches` answers true for a termless query, so an unfiltered
  // fallthrough would hand the model all 1,604 cards and bill for it.
  assert.deepEqual(planVendorMatch({ vendorTaxId: null, vendorName: null }, CARDS), { kind: "none" });
  assert.deepEqual(planVendorMatch({ vendorTaxId: "", vendorName: "  " }, CARDS), { kind: "none" });
});

test("boilerplate alone is not a search", () => {
  // "บริษัท" carries no distinctive word, so it names every limited company.
  assert.deepEqual(planVendorMatch({ vendorTaxId: null, vendorName: "บริษัท จำกัด" }, CARDS), {
    kind: "none",
  });
});

test("exactly one card surviving the name filter is matched without the model", () => {
  const plan = planVendorMatch({ vendorTaxId: null, vendorName: "ลุงหมี" }, CARDS);
  assert.deepEqual(plan, { kind: "matched", vendorNo: "V0004", via: "name" });
});

/* ── step 3: what the model answered ── */

test("the model's answer counts only if it is one of the candidates", () => {
  const candidates = [CARDS[0], CARDS[1]];
  assert.equal(pickMatchedVendor("V0002", candidates), "V0002");
  // Invented, plausible, and not on the list it was given.
  assert.equal(pickMatchedVendor("V9999", candidates), null);
  // A real card that was NOT among the candidates is refused too — the filter
  // is the constraint, not the ledger.
  assert.equal(pickMatchedVendor("V0003", candidates), null);
});

test("an explanation around the answer is still an answer", () => {
  assert.equal(pickMatchedVendor("The best match is V0001 (head office).", [CARDS[0]]), "V0001");
});

test("a refusal is a refusal", () => {
  assert.equal(pickMatchedVendor("none of these", [CARDS[0]]), null);
  assert.equal(pickMatchedVendor("", [CARDS[0]]), null);
});

/* ── the rule the queue's checkbox reads ── */

test("a line with no VAT never needs a vendor", () => {
  // Tax Vendor No. travels on the VAT line and nowhere else, so a line with no
  // VAT produces no VAT line at all. AP-3 has had this rule since it shipped.
  assert.equal(vendorRequired({ vatAmount: 0, vendorNo: null, vendorMatchStatus: null }), false);
  assert.equal(vendorRequired({ vatAmount: null, vendorNo: null, vendorMatchStatus: null }), false);
});

test("a VAT line nobody has looked at still needs one", () => {
  // NULL means "not asked". Reading it as "no card exists" would unlock the
  // checkbox before anyone had checked anything.
  assert.equal(vendorRequired({ vatAmount: 7, vendorNo: null, vendorMatchStatus: null }), true);
});

test("a VAT line whose seller has no card does not", () => {
  assert.equal(vendorRequired({ vatAmount: 7, vendorNo: null, vendorMatchStatus: "none" }), false);
});

test("a VAT line that already carries a vendor does not", () => {
  assert.equal(vendorRequired({ vatAmount: 7, vendorNo: "V0001", vendorMatchStatus: "auto" }), false);
  // Trimmed-empty is absent: a value can reach this column as "  ".
  assert.equal(vendorRequired({ vatAmount: 7, vendorNo: "   ", vendorMatchStatus: null }), true);
});

/* ── 'none' is a claim about the SELLER, so it must never be said about us ── */

test("a tax id on several cards whose name narrows to nothing is asked, never called 'none'", () => {
  // Two cards carry the id and the receipt names neither recognisably. We have
  // just PROVED the seller has cards, so recording "no card in this company"
  // would be false — and it is the value that exempts the line from needing a
  // vendor at all. It goes to the model with the tax id's own cards.
  const plan = planVendorMatch({ vendorTaxId: "0105566077543", vendorName: "ใบเสร็จเขียนอ่านไม่ออก" }, CARDS);
  assert.equal(plan.kind, "ask");
  assert.deepEqual(
    plan.kind === "ask" ? plan.candidates.map((c) => c.vendorNo) : [],
    ["V0001", "V0002"],
  );
});

test("a tax id on several cards and no name at all is asked too", () => {
  const plan = planVendorMatch({ vendorTaxId: "0105566077543", vendorName: null }, CARDS);
  assert.equal(plan.kind, "ask");
});

test("an empty ledger answers 'unknown', which is not 'none'", () => {
  // No vendor cards for this company — never synced, or the wrong Company
  // resolved. Reading that as "this seller has no card" would mark EVERY line
  // of EVERY claim exempt, silently, and the queue would go green.
  assert.deepEqual(planVendorMatch({ vendorTaxId: "0107537002443", vendorName: "x" }, []), {
    kind: "unknown",
  });
});
