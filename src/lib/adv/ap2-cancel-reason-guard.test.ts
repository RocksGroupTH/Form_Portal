import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **A cancelled AP-2 advance has to say why, at all three layers.**
 *
 * Until 2026-09-25 it said nothing. `cancelByRequester` took no reason, the
 * route sent no body, the dialog asked no question, and the activity log row
 * was written with an `Action` and no `Note`. The report could show that a
 * request had been withdrawn and never why — four cancelled advances on UAT,
 * four blanks, none of which can be filled in now.
 *
 * The fix spans a component, a route and an engine, and each of the three is
 * independently reversible by a later edit that looks harmless on its own:
 * a dialog that stops sending the field still compiles, a route that stops
 * reading it still returns 200, and an engine that stops writing `Note` still
 * cancels the request. Nothing renders in a test here and no pool harness
 * exists in this repo (the service-level tests for the report column live in
 * Acc_Portal, which has one), so this is a source-scan guard — the same trade
 * `src/lib/clr/*-guard.test.ts` makes.
 *
 * What is pinned is the *chain*, not the wording: the reason is demanded, sent,
 * received and stored. The Thai strings are deliberately not pinned.
 */

const ROOT = process.cwd();
const ENGINE = path.join(ROOT, "src/lib/adv/advance-approval-engine.ts");
const ROUTE = path.join(ROOT, "src/app/api/request/advance/requests/[id]/cancel/route.ts");
const PAGE = path.join(ROOT, "src/app/(dashboard)/request/advance/[id]/page.tsx");

/** CRLF on a Windows checkout, LF in the blob — see clr/adc-link-guard.test.ts. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("the engine takes a reason and refuses an empty one", () => {
  const src = code(ENGINE);
  const sig = /export async function cancelByRequester\(([^)]*)\)/.exec(src)?.[1] ?? "";
  assert.ok(sig.length > 0, "cancelByRequester not found — the guard is scanning nothing");
  assert.match(sig, /comment\s*:\s*string/, "cancelByRequester no longer takes a reason");

  const body = src.slice(src.indexOf("export async function cancelByRequester"));
  assert.match(
    body.slice(0, 400),
    /if \(!comment\?\.trim\(\)\)\s*throw/,
    "cancelByRequester accepts a blank reason — the same as having none",
  );
});

test("the engine stores the reason where the report reads it", () => {
  // AccActivityLog, not the approval row: a resubmit deletes approval rows.
  // A cancellation is terminal so it is not resubmitted — but the report reads
  // one column for all three actions, and a cancel that writes only to the
  // approval row would be the one that is inconsistent.
  const src = code(ENGINE);
  const insert = /INSERT INTO \[dbo\]\.\[AccActivityLog\][^`]*'cancelled'[^`]*/.exec(src)?.[0] ?? "";
  assert.ok(insert.length > 0, "the cancelled activity-log insert is gone");
  assert.match(insert, /Note/, "the cancelled log row is written without its Note again");
});

test("the route reads the reason off the body and passes it on", () => {
  const src = code(ROUTE);
  assert.match(src, /await req\.json\(\)/, "the route stopped reading a body");
  assert.match(
    src,
    /cancelByRequester\(\s*id\s*,\s*actor\s*,\s*comment\s*\)/,
    "the route calls cancelByRequester without the reason",
  );
  // `_req` is the giveaway that the body is being ignored again.
  assert.doesNotMatch(src, /\(\s*_req\s*:/, "the route's request parameter is unused again");
});

test("the dialog asks for the reason, blocks on an empty one, and sends it", () => {
  const src = code(PAGE);
  assert.match(src, /setCancelReason/, "the cancel dialog no longer has a reason field");
  assert.match(
    src,
    /disabled=\{!cancelReason\.trim\(\)\}/,
    "the confirm button no longer blocks on an empty reason",
  );
  assert.match(
    src,
    /act\("cancel",\s*\{\s*comment:\s*cancelReason\.trim\(\)\s*\}\)/,
    "the dialog confirms a cancel without sending the reason",
  );
});

test("the reason is not borrowed from the approver panel's box", () => {
  // `rejectReason` belongs to the approve/reject/return panel. Sharing it
  // would carry a half-typed rejection into a cancel dialog, and the two are
  // never the same person on the same screen.
  const src = code(PAGE);
  const confirm = /act\("cancel",\s*\{[^}]*\}\)/.exec(src)?.[0] ?? "";
  assert.ok(confirm.length > 0, "the cancel confirm call is gone");
  assert.doesNotMatch(confirm, /rejectReason/, "the cancel dialog is sending the approver's box");
});
