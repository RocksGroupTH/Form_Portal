import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **Every AP-2 notification goes through `onBehalfNotifyList`.**
 *
 * AP-2 lets one person file a request for another, and until 2026-09-25 not one
 * of its five notifications ever reached the person who filed it — one account
 * officer had raised eleven requests on colleagues' behalf and received nothing
 * about any of them, including the returns they were the ones who had to act on.
 *
 * The reason it went unnoticed for so long is the shape, not the omission: the
 * recipient is decided separately at each `queueEmail` call, so "who is told"
 * was five independent decisions and adding a sixth trigger means making it
 * again. That is the same shape as the running-number bug found the same day,
 * where three of five services carried a rule and two silently did not.
 *
 * So this guard reads both files that send AP-2 mail and pins the funnel rather
 * than the individual triggers: a new trigger either routes through
 * `onBehalfNotifyList` or fails here. It deliberately does NOT check which
 * addresses each trigger starts from — that is the caller's business, and
 * `advance-notify-recipients.test.ts` covers what the funnel does with them.
 */

const SRC = path.join(process.cwd(), "src");

const SENDERS = [
  "lib/adv/advance-request-service.ts",
  "lib/adv/advance-approval-engine.ts",
];

/** Line endings are the machine's, not the repo's -- see adc-link-guard.test.ts. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

for (const file of SENDERS) {
  test(`${file} routes every AP-2 notification through onBehalfNotifyList`, () => {
    const src = code(file);

    const sends = count(src, "queueEmail(");
    if (sends === 0) return; // this file stopped sending mail; nothing to pin

    const funnels = count(src, "onBehalfNotifyList(");
    assert.ok(
      funnels > 0,
      `${file} calls queueEmail ${sends} time(s) but never onBehalfNotifyList — ` +
        "a notification addressed directly cannot reach the person who filed the " +
        "request on somebody else's behalf, which is the bug this replaced",
    );
  });

  test(`${file} addresses no notification straight at the requester`, () => {
    const src = code(file);

    // The exact shape every trigger used before: one address, taken from the
    // request, with the filer nowhere in it.
    const direct = /toEmail:\s*(req\??\.)?requesterEmail/.exec(src);
    assert.equal(
      direct,
      null,
      `${file} still addresses a notification at the requester alone ` +
        `("${direct?.[0] ?? ""}"). On an on-behalf request that is the person it ` +
        "was filed FOR, and it leaves out the person who filed it. Pass the " +
        "address through onBehalfNotifyList with resolveOnBehalfPair instead",
    );
  });

  test(`${file} pairs every funnel with a resolved on-behalf pair`, () => {
    const src = code(file);
    const funnels = count(src, "onBehalfNotifyList(");
    if (funnels === 0) return;

    // An onBehalfNotifyList given no pair is a no-op that reads as a fix.
    assert.equal(
      count(src, "resolveOnBehalfPair("),
      funnels,
      `${file} calls onBehalfNotifyList ${funnels} time(s) but resolveOnBehalfPair ` +
        `${count(src, "resolveOnBehalfPair(")} time(s). A funnel handed no pair adds ` +
        "nobody, so it looks like the fix and behaves like the bug",
    );
  });
}
