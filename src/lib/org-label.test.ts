import { test } from "node:test";
import assert from "node:assert/strict";
import { orgLabelFromEmail } from "./org-label";

test("the company's own addresses give Rocksgroup", () => {
  assert.equal(orgLabelFromEmail("sattawat.c@rocksgroup.com"), "Rocksgroup");
  assert.equal(orgLabelFromEmail("itsupport@rocksgroup.com"), "Rocksgroup");
  // The local part is never read, so a dot or a plus tag in it changes nothing.
  assert.equal(orgLabelFromEmail("a.b+tag@rocksgroup.com"), "Rocksgroup");
});

test("a subdomain does not become the label", () => {
  // The naive rule — first label of the domain — answers "Mail" here, which is
  // the failure this one exists to avoid.
  assert.equal(orgLabelFromEmail("x@mail.rocksgroup.com"), "Rocksgroup");
  assert.equal(orgLabelFromEmail("x@a.b.rocksgroup.com"), "Rocksgroup");
});

test("a two-part suffix is dropped whole", () => {
  assert.equal(orgLabelFromEmail("x@rocksgroup.co.th"), "Rocksgroup");
  assert.equal(orgLabelFromEmail("x@example.com.au"), "Example");
  assert.equal(orgLabelFromEmail("x@mail.example.co.uk"), "Example");
});

test("only the first letter is capitalised", () => {
  // The reference design shows "Rocksgroup", not "RocksGroup" or "ROCKSGROUP".
  // There is no way to recover the intended casing of a run-together domain,
  // so it is not attempted.
  assert.equal(orgLabelFromEmail("x@ROCKSGROUP.COM"), "Rocksgroup");
  assert.equal(orgLabelFromEmail("x@rocksGroup.com"), "Rocksgroup");
});

test("a hyphenated domain keeps its hyphen and capitalises each part", () => {
  assert.equal(orgLabelFromEmail("x@rocks-group.com"), "Rocks-Group");
});

test("surrounding whitespace is tolerated", () => {
  assert.equal(orgLabelFromEmail("  x@rocksgroup.com  "), "Rocksgroup");
});

test("anything unreadable answers null rather than guessing", () => {
  // The caller renders the second line only when there is one, so null is what
  // hides it — never a placeholder, and never a raw domain fragment.
  assert.equal(orgLabelFromEmail(null), null);
  assert.equal(orgLabelFromEmail(undefined), null);
  assert.equal(orgLabelFromEmail(""), null);
  assert.equal(orgLabelFromEmail("   "), null);
  assert.equal(orgLabelFromEmail("not-an-email"), null);
  assert.equal(orgLabelFromEmail("no-domain@"), null);
  assert.equal(orgLabelFromEmail("@no-local.com"), "No-Local");
  assert.equal(orgLabelFromEmail("x@localhost"), "Localhost");
  // A bare suffix has nothing left once the suffix is dropped.
  assert.equal(orgLabelFromEmail("x@co.th"), null);
  assert.equal(orgLabelFromEmail("x@.com"), null);
});

test("an address with several @ takes the last domain", () => {
  // Not a valid address, but the split must not silently read "b" as the host.
  assert.equal(orgLabelFromEmail("a@b@rocksgroup.com"), "Rocksgroup");
});
