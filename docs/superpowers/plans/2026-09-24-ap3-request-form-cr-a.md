# AP-3's request form: the CR's three form changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the ภ.ง.ด. selector off AP-3's requester form, give its expense card AP-4's expand-to-viewport-width control, and let the receipt section attach a file without the AI read.

**Architecture:** One React file changes — `ClearAdvanceForm.tsx`. Nothing is stored differently, no route changes, no migration. The one piece of new logic that is not JSX (the wide-mode width arithmetic) is extracted to its own module so both AP-3 and AP-4 can use it and so it can be tested at all.

**Tech Stack:** Next.js 16, React 19, TypeScript. **This repo has no vitest** — `npm test` runs `tsx scripts/run-tests.ts` over `node --test`, and every test file uses `node:test` + `node:assert/strict`. There is no component-rendering harness, so JSX is verified by a source scan and by driving the running app.

**Spec:** `docs/superpowers/specs/2026-09-24-ap3-request-form-cr-a-design.md`

---

## Global constraints

1. **Form Portal only.** ACC Portal has no AP-3 requester form.
2. **Never run `npm run build`** — the dev server owns `.next`. Use `npx tsc --noEmit` and `npm test`.
3. `next-env.d.ts` carries an unrelated pre-existing diff. **Stage by name, never `git add -u`.**
4. Do not touch how `pndType` is produced or stored. Only the two controls go.

## File structure

| File | Change | Task |
| --- | --- | --- |
| `src/features/clear-advance/components/ClearAdvanceForm.tsx` | the two ภ.ง.ด. controls, the table header, the totals `colSpan` | 1 |
| `src/lib/clr/wide-card-width.ts` | **new** — the wide-mode width arithmetic, pure | 2 |
| `src/lib/clr/wide-card-width.test.ts` | **new** — its tests | 2 |
| `src/features/clear-advance/components/ClearAdvanceForm.tsx` | wide state, effect, wrapper, header button | 3 |
| `src/features/clear-advance/components/ClearAdvanceForm.tsx` | `uploadFiles` options arg, `FileArea` `onPickRaw`, the receipt call site | 4 |
| `src/lib/clr/ap3-form-cr-a-guard.test.ts` | **new** — source scan proving 1 and 4 landed and stayed | 5 |

---

## Task 1: The ภ.ง.ด. selector leaves the requester's form

**Files:**
- Modify: `src/features/clear-advance/components/ClearAdvanceForm.tsx:1922`, `:1974-1985`, `:2008-2013`, `:2068-2076`

**Three edits, and the third is the one that gets forgotten.** The wide table's cell, the
narrow card's field, **and** the header cell plus the totals row's `colSpan` that counts it.

- [ ] **Step 1: Delete the wide table's header cell**

At `:1922` the line is exactly:

```tsx
                  <Th w={110}>ภ.ง.ด.</Th>
```

Delete that whole line.

- [ ] **Step 2: Delete the wide table's body cell**

At `:1974-1985`, delete this entire `<Td>…</Td>` block, comment included:

```tsx
                    <Td>
                      {/* Picks the BC vendor accounting clears against. Suggested
                          from the tax id, never fixed by it: a 0-prefixed id can
                          belong to a foreign individual. */}
                      <select className={cellClass} style={{ ...cellStyle, width: "100%" }}
                        value={w.pndType} disabled={readOnly}
                        onChange={(e) => updateWht(idx, { pndType: e.target.value as WhtRow["pndType"] })}>
                        <option value="">— ยังไม่ระบุ —</option>
                        <option value="PND3">{PND_LABEL.PND3}</option>
                        <option value="PND53">{PND_LABEL.PND53}</option>
                      </select>
                    </Td>
```

- [ ] **Step 3: Fix the totals row's span**

The table is now one column narrower, so the `รวม WHT` label must span one fewer. At
`:2008-2013` replace:

```tsx
                  {/* #, วันที่, เลขที่เอกสาร, เลขผู้เสียภาษี, ชื่อผู้รับ, ที่อยู่,
                      ภ.ง.ด. and ค่าใช้จ่าย — eight, so รวม WHT lands under the
                      WHT column. It spanned seven, which left the header a cell
                      wider than this row. */}
                  <Td colSpan={8}><span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>รวม WHT</span></Td>
```

with:

```tsx
                  {/* #, วันที่, เลขที่เอกสาร, เลขผู้เสียภาษี, ชื่อผู้รับ, ที่อยู่
                      and ค่าใช้จ่าย — seven, so รวม WHT lands under the WHT
                      column. It was eight while the requester still chose the
                      ภ.ง.ด. type; that column left this form on 2026-09-24 and
                      the count follows it. Get this wrong and the header sits a
                      cell wider than the totals row, which is how it was found
                      the last time. */}
                  <Td colSpan={7}><span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>รวม WHT</span></Td>
```

- [ ] **Step 4: Delete the narrow card's field**

At `:2068-2076`, delete this whole `<MField>` block:

```tsx
                <MField label="ภ.ง.ด.">
                  <select className={fieldClass} style={fieldStyle}
                    value={w.pndType} disabled={readOnly}
                    onChange={(e) => updateWht(idx, { pndType: e.target.value as WhtRow["pndType"] })}>
                    <option value="">— ยังไม่ระบุ —</option>
                    <option value="PND3">{PND_LABEL.PND3}</option>
                    <option value="PND53">{PND_LABEL.PND53}</option>
                  </select>
                </MField>
```

- [ ] **Step 5: Drop `PND_LABEL` from the import, keep `suggestPndType`**

Those four `<option>` elements were `PND_LABEL`'s **only** uses in this file, so it is now an
unused import. Line 5 reads:

```ts
import { PND_LABEL, suggestPndType } from "@/lib/clr/wht-pnd-core";
```

Make it:

```ts
import { suggestPndType } from "@/lib/clr/wht-pnd-core";
```

`suggestPndType` stays — it is what still fills the type from the tax id.

- [ ] **Step 6: Leave everything else about `pndType` alone**

Do **not** touch `:527`, `:605` or `:1283`. The value is still filled from the tax id and
still sent on save; the ERP payload refuses a clearing whose WHT rows have no decided type,
so removing the fill would strand claims at the send. `wht-pnd-core.ts` itself does not
change — `PND_LABEL` is still used by both apps' account steps.

- [ ] **Step 7: Typecheck**

```bash
cd /r/Form_Portal && npx tsc --noEmit
```

Expected: no output. An error naming `PND_LABEL` means Step 5 was skipped.

- [ ] **Step 8: Commit**

```bash
cd /r/Form_Portal
git add src/features/clear-advance/components/ClearAdvanceForm.tsx
git commit -m "feat(clr): the requester stops choosing the ภ.ง.ด. type

Accounting decides it, and has had its own control all along — this app's
ClearAdvanceDetail and ACC Portal's ClrAccountWorkspace. The requester's copy
asked a question whose answer the next step overwrote.

Nothing about the value changes: suggestPndType still fills it from the tax
id, the save still decides it server-side, and the ERP payload still refuses
a clearing that has none.

The totals row spans seven now, not eight. That count is the table's header
and body agreeing, and it has been wrong here before.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The wide-mode width, as a function that can be tested

**Files:**
- Create: `src/lib/clr/wide-card-width.ts`
- Create: `src/lib/clr/wide-card-width.test.ts`

AP-4 inlines this arithmetic in JSX, where nothing in this repo can reach it. Extracting it
is what makes Task 3 testable at all.

- [ ] **Step 1: Write the failing test**

Create `src/lib/clr/wide-card-width.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { wideCardStyle, WIDE_INSET } from "./wide-card-width";

test("narrow mode asks for no style at all", () => {
  assert.equal(wideCardStyle(false, 1440), undefined);
});

test("a widened card is the viewport less an inset on each side", () => {
  const s = wideCardStyle(true, 1440);
  assert.equal(s?.width, 1440 - WIDE_INSET * 2);
});

/* The card sits inside a narrower page column, so widening it is not enough —
   it has to be pulled back to the viewport's left edge. Half the difference,
   expressed from the card's own centre. */
test("a widened card is centred on the viewport, not on its column", () => {
  const s = wideCardStyle(true, 1440);
  assert.equal(s?.marginLeft, `calc(50% - ${(1440 - WIDE_INSET * 2) / 2}px)`);
});

/* Null is what the measuring effect reports before its first measurement.
   Styling on it would jump the card to zero width for one frame. */
test("no measurement yet is the same as narrow", () => {
  assert.equal(wideCardStyle(true, null), undefined);
});

/* A viewport narrower than the insets would ask for a negative width, which
   renders as a collapsed card rather than an error. */
test("a viewport too narrow for the insets stays narrow", () => {
  assert.equal(wideCardStyle(true, WIDE_INSET * 2), undefined);
  assert.equal(wideCardStyle(true, 10), undefined);
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/wide-card-width.test.ts
```

Expected: FAIL — `Cannot find module './wide-card-width'`.

- [ ] **Step 3: Write the module**

Create `src/lib/clr/wide-card-width.ts`:

```ts
/**
 * The inline style that widens a card from its page column to the viewport.
 *
 * Ported out of `src/features/reimburse/components/ReimburseForm.tsx`, where
 * AP-4 solved this first and still inlines it in JSX. AP-3's expense card wants
 * the same behaviour, and a second inline copy would be a second place to get
 * the centring wrong — so the arithmetic lives here, where a test can reach it.
 *
 * `viewportWidth` is `document.documentElement.clientWidth`, NOT
 * `window.innerWidth`: the difference between them is exactly the scrollbar,
 * and including it leaves the card a scrollbar's width too wide. The overflow
 * is clipped rather than scrolled, so the symptom is a quietly cropped right
 * edge rather than a visible page scrollbar.
 */

/** The gap left at each edge of a widened card. */
export const WIDE_INSET = 12;

export type WideCardStyle = { width: number; marginLeft: string };

/**
 * `undefined` means "render with no inline style" — the ordinary layout.
 *
 * It is returned for three different situations on purpose: not widened, not
 * measured yet, and a viewport too narrow to take the insets. All three want
 * the same thing, and a caller that had to tell them apart would be a caller
 * that could get one wrong.
 */
export function wideCardStyle(
  wide: boolean,
  viewportWidth: number | null,
): WideCardStyle | undefined {
  if (!wide || viewportWidth === null) return undefined;
  const width = viewportWidth - WIDE_INSET * 2;
  if (width <= 0) return undefined;
  return { width, marginLeft: `calc(50% - ${width / 2}px)` };
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/wide-card-width.test.ts
```

Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /r/Form_Portal
git add src/lib/clr/wide-card-width.ts src/lib/clr/wide-card-width.test.ts
git commit -m "feat(clr): the wide-card width, as a function with a test

AP-4 widens its expense card by arithmetic inlined in JSX, which nothing in
this repo can reach: no vitest, no rendering harness. AP-3 wants the same
card behaviour, and the honest way to give it to two forms is one function.

Pins the three cases that all mean 'no inline style' — not widened, not
measured yet, and a viewport too narrow to take the insets — because a
caller that had to tell them apart is a caller that could get one wrong.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The expense card expands to the viewport's width

**Files:**
- Modify: `src/features/clear-advance/components/ClearAdvanceForm.tsx` — imports, state near `:256`-equivalent, the card at `:1573`, its header at `:1574-1576`

Reference, read it before starting: `src/features/reimburse/components/ReimburseForm.tsx:254-275` (state and effect) and `:1374-1416` (wrapper and button).

- [ ] **Step 1: Add the imports**

`Maximize2` and `Minimize2` come from `lucide-react`, which this file already imports from.
Add them to that existing import list. Add beside the file's other `@/lib/clr` imports:

```ts
import { wideCardStyle } from "@/lib/clr/wide-card-width";
```

- [ ] **Step 2: Add the state and the measuring effect**

Put these beside the component's other `useState` calls:

```tsx
  const [linesWide, setLinesWide] = useState(false);
  /**
   * The viewport's width without its scrollbar, measured only while widened.
   *
   * Null until then, so the ordinary layout costs no listener and no reflow;
   * `clientWidth` rather than `innerWidth` because the difference between them
   * is exactly the scrollbar this must not include.
   */
  const [viewportWidth, setViewportWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!linesWide) {
      setViewportWidth(null);
      return;
    }
    const measure = () => setViewportWidth(document.documentElement.clientWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [linesWide]);
```

- [ ] **Step 3: Widen the card**

The card opens at `:1573` as:

```tsx
      <div className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3" style={box} data-err="lines">
```

Replace that opening tag with:

```tsx
      <div
        className="rounded-2xl p-4 sm:p-5 flex flex-col gap-3 min-w-0 transition-[width,margin] duration-200"
        style={{ ...box, ...wideCardStyle(linesWide, viewportWidth) }}
        data-err="lines"
      >
```

`box` stays first so the widening overrides nothing it does not mean to.

- [ ] **Step 4: Add the button to the header that already exists**

The header at `:1574` is already a flex row holding the label and a `<div className="flex items-center gap-2">` of controls (the ตรวจสรรพากร button lives there). Add this as the **last** child of that inner `<div>`:

```tsx
            {lines.length > 0 && (
              <button
                type="button"
                onClick={() => setLinesWide((v) => !v)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12px] font-semibold cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  color: "var(--nav-active-text)",
                  border: "1px solid var(--border-card)",
                }}
              >
                {linesWide ? (
                  <>
                    <Minimize2 size={13} /> ย่อกลับ
                  </>
                ) : (
                  <>
                    <Maximize2 size={13} /> ขยายเต็มความกว้าง
                  </>
                )}
              </button>
            )}
```

The `lines.length > 0` guard is AP-4's, and its reason is AP-4's: an empty table at full
width is a blank page.

- [ ] **Step 5: Verify**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

Expected: no tsc output; the suite passes with the same count as before plus Task 2's five.

- [ ] **Step 6: Commit**

```bash
cd /r/Form_Portal
git add src/features/clear-advance/components/ClearAdvanceForm.tsx
git commit -m "feat(clr): the expense card expands to the viewport's width

Fifteen columns in a page column, which is what the CR is about. AP-4 already
solved this for a card of the same name, so this is its behaviour and its two
judgements: the control belongs in the card's own header because it is that
card which expands, and it stays hidden until there is a row, because an
empty table at full width is a blank page.

The arithmetic is the shared wideCardStyle rather than a second inline copy.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Attaching a receipt without the AI read

**Files:**
- Modify: `src/features/clear-advance/components/ClearAdvanceForm.tsx:854-856` (signature), `:913` (the read), `:1556` (receipt call site), `:2291-2296` (`FileArea` props), `:2312-2325` (its buttons)

- [ ] **Step 1: Give `uploadFiles` the option**

At `:854-856` the signature is:

```tsx
  async function uploadFiles(
    list: FileList | null,
    refType: "clear_doc" | "refund_proof",
  ) {
```

Replace with:

```tsx
  async function uploadFiles(
    list: FileList | null,
    refType: "clear_doc" | "refund_proof",
    /* `read: false` uploads and stores the file exactly as always and skips the
       AI read at the end of this function — the ปกติ buttons the CR asked for.
       One function with one argument rather than a second upload path, so the
       two cannot drift apart. */
    opts: { read?: boolean } = {},
  ) {
    const read = opts.read !== false;
```

- [ ] **Step 2: Gate the read on it**

At `:913` the line is:

```tsx
      if (ocrDocs.length) void verifyReceipts(ocrDocs);
```

Replace with:

```tsx
      if (read && ocrDocs.length) void verifyReceipts(ocrDocs);
```

Change nothing else in the function. The upload, the 4MB check, the toast and the file list
are the same on both paths — that is the point.

- [ ] **Step 3: Give `FileArea` the second handler**

At `:2291-2296` the component's props are:

```tsx
function FileArea({
  files, readOnly, uploading, onPick, onRemove, onView, locked, lockedHint,
}: {
```

Add `onPickRaw` to both the destructuring and the type:

```tsx
function FileArea({
  files, readOnly, uploading, onPick, onPickRaw, onRemove, onView, locked, lockedHint,
}: {
```

and in the type block, beside `onPick`:

```ts
  /** When given, the section also offers buttons that upload WITHOUT the AI
   *  read. The refund-slip section deliberately passes nothing, which is how
   *  it keeps the two buttons it has today. */
  onPickRaw?: (list: FileList | null) => void;
```

- [ ] **Step 4: Rename the two existing buttons and add two more**

At `:2312-2325`, the existing labels `แนบไฟล์` and `ถ่ายรูป` become the AI ones, and two
plain buttons follow them inside the same `flex flex-wrap items-center gap-2` row. Replace
the two `<label>` elements with these four:

```tsx
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold" style={btnStyle}>
            <Paperclip size={14} /> {onPickRaw ? "แนบไฟล์อ่านด้วย AI" : "แนบไฟล์"}
            <input type="file" hidden multiple accept="image/*,application/pdf" disabled={disabled}
              onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
          </label>
          <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold" style={btnStyle}>
            <Camera size={14} /> {onPickRaw ? "ถ่ายรูปอ่านด้วย AI" : "ถ่ายรูป"}
            <input type="file" hidden accept="image/*" capture="environment" disabled={disabled}
              onChange={(e) => { onPick(e.target.files); e.target.value = ""; }} />
          </label>
          {onPickRaw && (
            <>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold" style={btnStyle}>
                <Paperclip size={14} /> แนบไฟล์
                <input type="file" hidden multiple accept="image/*,application/pdf" disabled={disabled}
                  onChange={(e) => { onPickRaw(e.target.files); e.target.value = ""; }} />
              </label>
              <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold" style={btnStyle}>
                <Camera size={14} /> ถ่ายรูป
                <input type="file" hidden accept="image/*" capture="environment" disabled={disabled}
                  onChange={(e) => { onPickRaw(e.target.files); e.target.value = ""; }} />
              </label>
            </>
          )}
```

The AI labels are conditional so the refund-slip section, which passes no `onPickRaw`, keeps
reading `แนบไฟล์` / `ถ่ายรูป` rather than advertising an AI the user there never chose.

- [ ] **Step 5: Wire the receipt call site, and only that one**

At `:1556` the receipt section renders `onPick={(list) => uploadFiles(list, "clear_doc")}`.
Add beneath it, inside the same element:

```tsx
              onPickRaw={(list) => uploadFiles(list, "clear_doc", { read: false })}
```

**Do not touch `:2116`**, the refund-slip call site. Its section keeps two buttons and its
AI read.

- [ ] **Step 6: Verify**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

Expected: no tsc output; suite green.

- [ ] **Step 7: Commit**

```bash
cd /r/Form_Portal
git add src/features/clear-advance/components/ClearAdvanceForm.tsx
git commit -m "feat(clr): a receipt can be attached without the AI read

The CR's ปกติ buttons: same upload, same storage, same 4MB check, same file
list — one argument skips the read at the end of uploadFiles. A second upload
function would have been two paths to keep in step.

Scoped by what the call site passes rather than by a flag inside the
component: the refund-slip section passes no onPickRaw and therefore keeps
its two buttons and its own AI read, with no condition of its own to get
wrong.

Worth knowing: a file attached this way produces no row, and the AI read is
also what asks for the G/L suggestion, so a hand-added row reaches accounting
with no account on it. CR item 8 is the button that fixes that, and it should
ship with this.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: A guard so none of this quietly comes back

**Files:**
- Create: `src/lib/clr/ap3-form-cr-a-guard.test.ts`

JSX cannot be rendered in this repo's runner, so the three facts that would fail silently are
pinned by reading the source — the same technique as `src/lib/acc/*-guard.test.ts`.

- [ ] **Step 1: Write the test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * AP-3's requester form, after the 2026-09-24 CR (group A).
 *
 * Three facts here fail silently rather than loudly, which is why they are read
 * out of the source instead of trusted to review:
 *
 * - a ภ.ง.ด. control creeping back onto the requester's form would look
 *   harmless and would re-ask a question accounting overrides;
 * - the WHT totals row's colSpan is the header and the body agreeing on how
 *   many columns there are, and it has been wrong in this file before;
 * - the refund-slip section must NOT gain the no-AI buttons, and the only thing
 *   keeping them off it is that its call site passes no onPickRaw.
 */

const FORM = path.join(
  process.cwd(),
  "src/features/clear-advance/components/ClearAdvanceForm.tsx",
);

function form(): string {
  return fs.readFileSync(FORM, "utf8");
}

test("the requester has no ภ.ง.ด. control", () => {
  const src = form();
  assert.doesNotMatch(src, /updateWht\(idx, \{ pndType:/);
  assert.doesNotMatch(src, /<Th w=\{110\}>ภ\.ง\.ด\.<\/Th>/);
});

test("the ภ.ง.ด. value is still produced and still sent", () => {
  const src = form();
  assert.match(src, /suggestPndType\(/, "the tax id no longer fills the type");
  assert.match(src, /pndType: w\.pndType \|\| null/, "the save no longer carries the type");
});

test("the WHT totals row spans the seven columns that are left", () => {
  assert.match(form(), /<Td colSpan=\{7\}><span[^>]*>รวม WHT<\/span><\/Td>/);
});

test("the receipt section offers the no-AI buttons", () => {
  assert.match(form(), /onPickRaw=\{\(list\) => uploadFiles\(list, "clear_doc", \{ read: false \}\)\}/);
});

test("the refund-slip section does not", () => {
  const src = form();
  const at = src.indexOf('uploadFiles(list, "refund_proof")');
  assert.notEqual(at, -1, "the refund-slip upload call moved — rewrite this guard, do not delete it");
  const around = src.slice(at - 600, at + 600);
  assert.doesNotMatch(around, /onPickRaw/);
});

test("skipping the read is one argument on the one upload function", () => {
  const src = form();
  assert.match(src, /if \(read && ocrDocs\.length\) void verifyReceipts\(ocrDocs\);/);
  assert.doesNotMatch(src, /async function uploadFilesRaw/, "a second upload path appeared");
});
```

- [ ] **Step 2: Run it**

```bash
cd /r/Form_Portal && npx tsx --test src/lib/clr/ap3-form-cr-a-guard.test.ts
```

Expected: `# pass 6`, `# fail 0`. If any fail, the earlier task it names was not finished —
fix that task, not this test.

- [ ] **Step 3: Prove the guard is not vacuous**

Mutate, run, restore — each must turn the guard red:

```bash
cd /r/Form_Portal && F=src/features/clear-advance/components/ClearAdvanceForm.tsx && cp $F /tmp/f.bak
sed -i 's/<Td colSpan={7}>/<Td colSpan={8}>/' $F
npx tsx --test src/lib/clr/ap3-form-cr-a-guard.test.ts | grep -E "^# (pass|fail)"
cp /tmp/f.bak $F
sed -i 's/if (read \&\& ocrDocs.length)/if (ocrDocs.length)/' $F
npx tsx --test src/lib/clr/ap3-form-cr-a-guard.test.ts | grep -E "^# (pass|fail)"
cp /tmp/f.bak $F
```

Expected: `# fail 1` on each mutation, and the file restored between them.

**Restore with `cp` from the backup, never `git checkout --`.** Every earlier task committed,
so a checkout would happen to be safe here — but it is safe only by luck, and the habit is
what matters: `git checkout --` on a file you are mutating for a test discards whatever is
unstaged in it, which on 2026-09-23 silently threw away a finished task in this very repo.

- [ ] **Step 4: Full verification**

```bash
cd /r/Form_Portal && npx tsc --noEmit && npm test
```

- [ ] **Step 5: Commit**

```bash
cd /r/Form_Portal
git add src/lib/clr/ap3-form-cr-a-guard.test.ts
git commit -m "test(clr): pin the CR group A changes that would fail silently

No vitest and no rendering harness here, so the facts that a review would
have to catch by eye are read out of the source instead: no ภ.ง.ด. control on
the requester's form while the value is still produced and sent, the totals
row spanning the columns that are actually left, and the refund-slip section
still passing no onPickRaw.

Each one is proved by mutation, not assumed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Drive it in the browser

**Files:** none. This task changes nothing.

The dev server may not be running, and it was stopped once already for memory — **ask before
starting one.** Form Portal runs on `:3081`.

- [ ] **Step 1: The ภ.ง.ด. control is gone, and the table still lines up**

Open an AP-3 draft with at least one WHT row at
`http://localhost:3081/request/clear-advance?brand=ROCKS`. Confirm the WHT table has no
ภ.ง.ด. column, that the `รวม WHT` label sits directly under the WHT column, and that the
same is true of the narrow-screen cards at a phone width.

- [ ] **Step 2: The card widens**

With at least one expense row, press **ขยายเต็มความกว้าง**. The card should reach the
viewport's edges less 12px each side and stay centred; **ย่อกลับ** restores it. With no rows
the button must not be there at all.

- [ ] **Step 3: A raw attach uploads and reads nothing**

In the receipt section, confirm four buttons. Attach with plain **แนบไฟล์**: the file appears
in the attachment list, the "แนบไฟล์แล้ว" toast shows, and **no** reading dialog appears and
**no** row is added. Then attach with **แนบไฟล์อ่านด้วย AI** and confirm the read runs as
before.

- [ ] **Step 4: The slip section is untouched**

On a clearing in the refund direction, confirm the หลักฐานการโอนเงินคืน section still shows
exactly two buttons, still labelled **แนบไฟล์** / **ถ่ายรูป**, and still reads the slip.

- [ ] **Step 5: Report what could not be checked**

If any step could not be run — no draft with a WHT row, no refund-direction clearing — say
so plainly rather than implying it passed.
