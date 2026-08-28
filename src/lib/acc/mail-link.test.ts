import { test } from "node:test";
import assert from "node:assert/strict";
import { documentUrl, documentButton } from "./mail-link";

test("an absolute base and a path make one absolute URL", () => {
  assert.equal(
    documentUrl("https://form.portal.rocksgroup.com", "/request/clear-advance", 42),
    "https://form.portal.rocksgroup.com/request/clear-advance/42",
  );
});

test("a trailing slash on the base does not double up", () => {
  assert.equal(
    documentUrl("https://form.portal.rocksgroup.com/", "/request/advance", 7),
    "https://form.portal.rocksgroup.com/request/advance/7",
  );
});

/**
 * The failure this module exists for. A relative href in an email resolves
 * against the mail client, which is nowhere — the button is dead in every
 * client. AP-3 shipped exactly this, and a base that is merely missing must
 * not quietly produce it.
 */
test("a missing base is refused, never turned into a relative link", () => {
  assert.equal(documentUrl("", "/request/advance", 7), null);
  assert.equal(documentUrl(undefined, "/request/advance", 7), null);
  assert.equal(documentUrl("   ", "/request/advance", 7), null);
});

test("a base that is not absolute is refused too", () => {
  assert.equal(documentUrl("form.portal.rocksgroup.com", "/request/advance", 7), null);
  assert.equal(documentUrl("/", "/request/advance", 7), null);
});

/** localhost is a real absolute URL — wrong for production, but that is an operator's call. */
test("localhost is allowed, because a developer's mail must work too", () => {
  assert.equal(
    documentUrl("http://localhost:3081", "/request/travel-expense", 3),
    "http://localhost:3081/request/travel-expense/3",
  );
});

test("the button carries the URL and the Thai label", () => {
  const html = documentButton("https://x.test/request/advance/9");
  assert.ok(html.includes('href="https://x.test/request/advance/9"'));
  assert.ok(html.includes("เปิดเอกสาร"));
});

/** No URL, no button — better a mail with no button than one with a dead button. */
test("no URL yields no button rather than an empty href", () => {
  assert.equal(documentButton(null), "");
});

test("the href is escaped, so a crafted id cannot break out of the attribute", () => {
  const html = documentButton('https://x.test/a"onmouseover="alert(1)');
  assert.ok(!html.includes('"onmouseover="'));
  assert.ok(html.includes("&quot;"));
});
