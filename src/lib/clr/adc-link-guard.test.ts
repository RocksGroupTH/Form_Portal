import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * **An ADC number is only useful as a link because nothing renders here to
 * notice when it stops being one.**
 *
 * `9c658727` (feat(clr): make an ADC number a way into the claim it names) gave
 * four screens a way from an ADC request number straight to the claim it names:
 * `ClrApprovalsQueue`, `ClrErpInterfaceQueue` (via a new `AdcLink`),
 * `ClrDetailReport`, and `ClrControlReport` (which already had it — its row
 * already pushed to the detail route before this commit).
 *
 * There is no component-rendering harness in this repo — nothing mounts these
 * tables, so nothing would fail if a later edit turned a `<Link>` back into
 * plain text. The screen would simply stop being a way in, quietly, and every
 * other test would stay green. This is a source-scan guard for that, the same
 * trade `src/lib/acc/*-guard.test.ts` and `src/lib/clr/ap3-form-cr-a-guard.test.ts`
 * already make.
 *
 * Two things are pinned, deliberately narrowly:
 *
 * 1. Each of the four files still routes its ADC number to `clearAdvanceDetailHref`
 *    somewhere — specific enough to fail if the link is deleted, loose enough
 *    to survive a re-style (a renamed local, a new wrapper element, a changed
 *    class name).
 * 2. `ClrErpInterfaceQueue.tsx`'s four table sites still go through the single
 *    `AdcLink` component rather than four hand-rolled copies. `AdcLink` derives
 *    both the href and the label from the same `row` prop it is handed, so a
 *    cell cannot be copy-pasted into a neighbouring table and silently keep
 *    pointing at the row it came from — four independent `<Link>`s could.
 *
 * Four other sites were **deliberately** left as plain text by that same
 * commit: the BC preview card header, the cancel dialog, the pull-back dialog,
 * and the BC-response modal title. Those are decisions, not omissions — this
 * guard does not pin them, so the next person with a good reason to link one
 * of them isn't fighting a test to do it.
 */

const SRC = path.join(process.cwd(), "src");

const FILES = {
  approvalsQueue: "features/clear-advance/components/admin/ClrApprovalsQueue.tsx",
  erpQueue: "features/clear-advance/components/admin/ClrErpInterfaceQueue.tsx",
  detailReport: "features/clear-advance/components/report/ClrDetailReport.tsx",
  controlReport: "features/clear-advance/components/report/ClrControlReport.tsx",
} as const;

/** Comments naming a rule must not satisfy the check for it — this file's own header included. */
function code(relative: string): string {
  return fs
    .readFileSync(path.join(SRC, relative), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every `<Link ... href={...}>children</Link>` in `src`, as [hrefExpr, children].
 * Lazy `[\s\S]*?` throughout so a re-styled attribute list or multi-line body
 * still matches — this only cares that *some* Link wraps *some* href and *some*
 * children, not their exact shape.
 */
function links(src: string): [string, string][] {
  const re = /<Link\s+href=\{([^}]*)\}[\s\S]*?>([\s\S]*?)<\/Link>/g;
  const out: [string, string][] = [];
  // exec/while, not matchAll: see payday-form-scope-guard.test.ts — this repo's
  // tsconfig target predates the iterator protocol on RegExpStringIterator.
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.push([m[1], m[2]]);
  return out;
}

test("ClrApprovalsQueue.tsx still links each row's ADC number to its detail route", () => {
  const src = code(FILES.approvalsQueue);
  const all = links(src);
  assert.ok(all.length > 0, `no <Link href={...}>…</Link> found in ${FILES.approvalsQueue} — the guard is scanning nothing`);

  const found = all.some(([href, children]) => /\br\.id\b/.test(href) && /r\.requestNo/.test(children));
  assert.ok(
    found,
    `${FILES.approvalsQueue}: no <Link> keyed on r.id wraps r.requestNo any more — the request number ` +
      "column stopped being a way into the claim it names. If this cell was intentionally reverted to " +
      "plain text, that is a decision this guard is meant to catch — reconsider, or narrow this guard " +
      "with a comment explaining why",
  );
});

test("ClrErpInterfaceQueue.tsx's AdcLink still links the row's ADC number", () => {
  const src = code(FILES.erpQueue);
  const start = src.indexOf("function AdcLink");
  assert.notEqual(start, -1, `${FILES.erpQueue}: no AdcLink function found — it was renamed, removed, or never restored`);
  const end = src.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `could not find the end of AdcLink's body in ${FILES.erpQueue} — rewrite this guard's slicing, do not delete it`);
  const body = src.slice(start, end);

  assert.match(
    body,
    /href=\{[^}]*clearAdvanceDetailHref\([^)]*row\.id[^)]*\)[^}]*\}/,
    "AdcLink no longer builds its href from clearAdvanceDetailHref(row.id)",
  );
  assert.match(
    body,
    /row\.requestNo/,
    "AdcLink no longer shows the row's own requestNo as its label",
  );
});

test("ClrErpInterfaceQueue.tsx's four table sites go through the one AdcLink, not hand-rolled copies", () => {
  const src = code(FILES.erpQueue);
  const start = src.indexOf("function AdcLink");
  const end = src.indexOf("\n}\n", start);
  const withoutAdcLinkDef = src.slice(0, start) + src.slice(end);

  const usages = (withoutAdcLinkDef.match(/<AdcLink\b/g) || []).length;
  assert.ok(
    usages > 1,
    `<AdcLink is used ${usages} time(s) in ${FILES.erpQueue} — expected more than one table site to share it. ` +
      "If only one table remains, either AdcLink is doing nothing worth pinning, or the others lost their link",
  );

  // A hand-rolled <Link> that reaches clearAdvanceDetailHref(row.id) outside
  // AdcLink's own body is exactly what a copy-pasted, silently-stale cell looks
  // like: it compiles, it looks identical, and it can point at the wrong row.
  const handRolled = (withoutAdcLinkDef.match(/<Link\b[^>]*href=\{[^}]*clearAdvanceDetailHref\([^)]*row\.id[^)]*\)[^}]*\}/g) || [])
    .length;
  assert.equal(
    handRolled,
    0,
    `found ${handRolled} hand-rolled <Link> element(s) in ${FILES.erpQueue} linking row.id outside AdcLink — ` +
      "a table site stopped using AdcLink and grew its own copy instead, which is precisely the " +
      "copy-paste-points-at-the-wrong-row hazard AdcLink exists to prevent. Use <AdcLink row={row} /> instead",
  );
});

test("ClrDetailReport.tsx still links each line's own request, not a shared one", () => {
  const src = code(FILES.detailReport);
  const all = links(src);
  assert.ok(all.length > 0, `no <Link href={...}>…</Link> found in ${FILES.detailReport} — the guard is scanning nothing`);

  // This report is line-level: several rows can share one ADC number, so the
  // href must key on the line's own requestId, not a generic id shared by the
  // rows above it — see the comment on SCREEN_COLS in the file itself.
  const found = all.some(
    ([href, children]) =>
      /clearAdvanceDetailHref\([^)]*\br\.requestId\b[^)]*\)/.test(href) && /r\.requestNo/.test(children),
  );
  assert.ok(
    found,
    `${FILES.detailReport}: no <Link href={clearAdvanceDetailHref(r.requestId)}> wraps r.requestNo any more. ` +
      "Note it must key on r.requestId (this line's own claim), not a row/shared id — several lines here " +
      "share one requestNo",
  );
});

test("ClrControlReport.tsx still routes each row to its detail route", () => {
  const src = code(FILES.controlReport);
  const found = /<tr[\s\S]{0,400}?onClick=\{[^}]*router\.push\([^)]*clearAdvanceDetailHref\([^)]*row\.id[^)]*\)[^)]*\)[^}]*\}/.test(
    src,
  );
  assert.ok(
    found,
    `${FILES.controlReport}: no <tr> with an onClick routing via router.push(clearAdvanceDetailHref(row.id)) ` +
      "found any more — this report's whole row was the way in (it had no per-cell Link), and that appears " +
      "to have been dropped rather than re-styled",
  );
});
