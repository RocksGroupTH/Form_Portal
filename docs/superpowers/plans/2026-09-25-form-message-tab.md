# Form Message Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every form's notice copy becomes editable from a **Message** settings tab on that form's own settings page, and AP-1's two notice blocks collapse into one box of four bullets.

**Architecture:** One row per form in `Fast_Core.dbo.FormMessage` (migration 164), no identity column. The read rides on `GET /api/form-environment`, which every form page already fetches — so the text and the owners that `{เจ้าของฟอร์ม}` expands to arrive in one payload. Five thin routes (one per form, form code pinned by the route file) call one service. All parsing, token expansion and bounds live in one pure, import-free module.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `mssql`, SWR, `tsx --test` (node:test + node:assert), Tailwind 4.

**Spec:** [`docs/superpowers/specs/2026-09-25-form-message-tab-design.md`](../specs/2026-09-25-form-message-tab-design.md)

## Global Constraints

- **Blocks are separated by a BLANK line** (two or more newlines). A single newline stays inside a block. AP-4's six compliance paragraphs each contain single newlines; measured 2026-09-25, none contains a blank line.
- **The token is exactly `{เจ้าของฟอร์ม}`.** No other token exists. No fuzzy matching.
- **Bounds:** body ≤ 5,000 chars; ≤ 20 blocks; each block ≤ 1,000 chars. Over any bound is a **400**, never a truncation.
- **`formCode` is a literal in each route file and is NEVER read from the request body.**
- **The Message tab is ADMIN-ONLY on all five forms** — `requireRole(["IT Admin", "System Admin"])`, and `messages` / `advanceMessages` / `clearMessages` appear in **no** grantable list. The four settings-tab tables are shared with ACC Portal, which deletes an approver's rows and re-inserts only the keys its own list knows, so the grant cannot be stored. See spec §8 and ledger ruling R1.
- **Migration 164 targets `Fast_Core` and only `Fast_Core`.** Not dual-written, not in `MASTER_TABLES`. `npm run check:alignment` must still report **30**.
- **The body renders as text, never HTML/Markdown.** React's default escaping is the control.
- **The existing constants are not deleted** — they are the fallback when the table is missing.
- **Response envelope:** `{ ok: true, data }` / `{ ok: false, error }`.
- **SQL:** parameterised only, via `pool.request().input(...)`.
- **ES5 target:** use `Array.from()`, never `[...set]` or `[...map.values()]`.
- **Commit after every task.** Branch is `feat/form-message-tab`, already created, spec already committed.

---

### Task 1: The pure text module

Parsing, token expansion and bounds. Imports nothing except `formatFormOwner`, so it is unit-testable with no database — `@/env` validates the whole environment at import and would throw in the test runner.

**Files:**
- Create: `src/lib/form-environment/form-message-text.ts`
- Create: `src/lib/form-environment/form-message-text.test.ts`

**Interfaces:**
- Consumes: `formatFormOwner`, `FormOwnerRef` from `@/lib/form-environment/form-owner-text`
- Produces:
  - `FORM_OWNER_TOKEN: "{เจ้าของฟอร์ม}"`
  - `MAX_MESSAGE_CHARS: 5000`, `MAX_MESSAGE_BLOCKS: 20`, `MAX_BLOCK_CHARS: 1000`
  - `parseFormMessage(body: string | null | undefined): string[]`
  - `expandFormMessage(body: string | null | undefined, owners: readonly FormOwnerRef[] | null | undefined): string[]`
  - `messageBodyProblem(body: string): string | null` — a Thai message, or `null` when acceptable

- [ ] **Step 1: Write the failing tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  FORM_OWNER_TOKEN,
  parseFormMessage,
  expandFormMessage,
  messageBodyProblem,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_BLOCKS,
  MAX_BLOCK_CHARS,
} from "./form-message-text";

/* ── parseFormMessage ────────────────────────────────────────────────── */

test("a blank line separates two blocks", () => {
  assert.deepEqual(parseFormMessage("one\n\ntwo"), ["one", "two"]);
});

test("a SINGLE newline stays inside one block — the rule AP-4 depends on", () => {
  assert.deepEqual(parseFormMessage("line one\nline two"), ["line one\nline two"]);
});

test("three or more newlines still separate exactly one boundary", () => {
  assert.deepEqual(parseFormMessage("a\n\n\n\nb"), ["a", "b"]);
});

test("CRLF is normalised before splitting", () => {
  assert.deepEqual(parseFormMessage("a\r\n\r\nb"), ["a", "b"]);
});

test("leading and trailing blank lines produce no empty blocks", () => {
  assert.deepEqual(parseFormMessage("\n\n  a  \n\n"), ["a"]);
});

test("a body of only whitespace is no blocks at all", () => {
  assert.deepEqual(parseFormMessage("   \n\n  \n "), []);
});

test("null and undefined are no blocks, not a crash", () => {
  assert.deepEqual(parseFormMessage(null), []);
  assert.deepEqual(parseFormMessage(undefined), []);
});

test("inner whitespace of a block is preserved — only the outer is trimmed", () => {
  assert.deepEqual(parseFormMessage("a\n  indented\n\nb"), ["a\n  indented", "b"]);
});

/* ── expandFormMessage ───────────────────────────────────────────────── */

const ONE = [{ email: "kanjanaporn.n@rocksgroup.com", displayName: "Kan Kanjanaporn Nabklang" }];
const TWO = [
  { email: "a@rocksgroup.com", displayName: "Ay One" },
  { email: "b@rocksgroup.com", displayName: "Bee Two" },
];

test("the token expands to name and address", () => {
  assert.deepEqual(
    expandFormMessage(`ติดต่อ: ${FORM_OWNER_TOKEN}`, ONE),
    ["ติดต่อ: Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)"],
  );
});

test("several owners are comma-joined", () => {
  assert.deepEqual(
    expandFormMessage(FORM_OWNER_TOKEN, TWO),
    ["Ay One (a@rocksgroup.com), Bee Two (b@rocksgroup.com)"],
  );
});

test("an owner with no display name renders as the bare address", () => {
  assert.deepEqual(
    expandFormMessage(FORM_OWNER_TOKEN, [{ email: "c@rocksgroup.com", displayName: null }]),
    ["c@rocksgroup.com"],
  );
});

test("with NO owners the token empties AND the trailing colon is trimmed", () => {
  assert.deepEqual(
    expandFormMessage(`กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ${FORM_OWNER_TOKEN}`, []),
    ["กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม"],
  );
});

test("a trailing · is trimmed too", () => {
  assert.deepEqual(expandFormMessage(`ถาม · ${FORM_OWNER_TOKEN}`, null), ["ถาม"]);
});

test("a block that is ONLY the token, with no owners, is dropped", () => {
  assert.deepEqual(expandFormMessage(`keep\n\n${FORM_OWNER_TOKEN}`, []), ["keep"]);
});

test("the token expands at every occurrence", () => {
  assert.deepEqual(
    expandFormMessage(`${FORM_OWNER_TOKEN} / ${FORM_OWNER_TOKEN}`, ONE),
    [
      "Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com) / "
        + "Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)",
    ],
  );
});

test("a mistyped token is left completely alone", () => {
  assert.deepEqual(expandFormMessage("ติดต่อ {เจ้าของform}", ONE), ["ติดต่อ {เจ้าของform}"]);
});

test("an owner row with a blank address is dropped, not rendered as empty brackets", () => {
  assert.deepEqual(
    expandFormMessage(FORM_OWNER_TOKEN, [{ email: "   ", displayName: "Ghost" }, ...ONE]),
    ["Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)"],
  );
});

/* ── messageBodyProblem ──────────────────────────────────────────────── */

test("an empty body is acceptable — it means no notice", () => {
  assert.equal(messageBodyProblem(""), null);
});

test("a body at exactly the character bound passes", () => {
  // Five blocks, each inside the per-block bound, summing to exactly 5,000
  // WITH the four blank-line separators counted. A single 5,000-char block
  // would trip MAX_BLOCK_CHARS first and test the wrong bound — which is what
  // this test did until the Task 1 implementer caught it.
  const body = [
    "x".repeat(1000),
    "x".repeat(998),
    "x".repeat(998),
    "x".repeat(998),
    "x".repeat(998),
  ].join("\n\n");
  assert.equal(body.length, MAX_MESSAGE_CHARS);
  assert.equal(messageBodyProblem(body), null);
});

test("one character over the body bound is refused", () => {
  const over = [
    "x".repeat(1000),
    "x".repeat(999),
    "x".repeat(998),
    "x".repeat(998),
    "x".repeat(998),
  ].join("\n\n");
  assert.equal(over.length, MAX_MESSAGE_CHARS + 1);
  assert.ok(messageBodyProblem(over));
});

test("exactly the block limit passes and one more is refused", () => {
  const at = Array.from({ length: MAX_MESSAGE_BLOCKS }, (_, i) => `b${i}`).join("\n\n");
  assert.equal(messageBodyProblem(at), null);
  const over = Array.from({ length: MAX_MESSAGE_BLOCKS + 1 }, (_, i) => `b${i}`).join("\n\n");
  assert.ok(messageBodyProblem(over));
});

test("a single over-long block is refused even when the whole body fits", () => {
  assert.ok(messageBodyProblem("y".repeat(MAX_BLOCK_CHARS + 1)));
});

test("every refusal is Thai, so it can be shown to the admin as-is", () => {
  const msg = messageBodyProblem("x".repeat(MAX_MESSAGE_CHARS + 1));
  assert.ok(msg && /[\u0E00-\u0E7F]/.test(msg));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- src/lib/form-environment/form-message-text.test.ts`
Expected: FAIL — `Cannot find module './form-message-text'`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * What a form's notice copy IS, as text: how it splits into bullets, how
 * `{เจ้าของฟอร์ม}` expands, and how long it may be.
 *
 * Pure and import-free but for `form-owner-text`, so every rule here is
 * unit-testable — anything reachable from a database pool drags `@/env` in,
 * which validates the whole environment at import and throws in the runner.
 *
 * It is the ONLY definition of what a bullet is. The five form renderers and
 * the settings editor's live preview all call it, so the preview cannot
 * disagree with the form.
 */
import { formatFormOwner, type FormOwnerRef } from "./form-owner-text";

/** The one token. There is deliberately no second, and no fuzzy matching. */
export const FORM_OWNER_TOKEN = "{เจ้าของฟอร์ม}";

export const MAX_MESSAGE_CHARS = 5000;
export const MAX_MESSAGE_BLOCKS = 20;
export const MAX_BLOCK_CHARS = 1000;

/**
 * Split a stored body into bullets.
 *
 * **A blank line separates two bullets; a single newline does not.** That rule
 * is not a matter of taste — `REIMBURSE_NOTICE`'s six compliance paragraphs
 * each contain single newlines, and a one-line-per-bullet rule would silently
 * re-render them as about fifteen bullets. Measured 2026-09-25, none of the
 * six contains a blank line, so this rule round-trips that notice exactly.
 *
 * Only each block's OUTER whitespace is trimmed: the leading space on the
 * fourth `REIMBURSE_NOTICE` block's second line is part of the owner's source
 * text and has to survive.
 */
export function parseFormMessage(body: string | null | undefined): string[] {
  if (!body) return [];
  const normalised = String(body).replace(/\r\n?/g, "\n");
  const out: string[] = [];
  for (const raw of normalised.split(/\n{2,}/)) {
    const block = raw.trim();
    if (block) out.push(block);
  }
  return out;
}

/**
 * Trailing punctuation left behind when the token expanded to nothing.
 *
 * `กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ` with the names removed has to read as
 * the bare sentence it read before anybody was named, not as a dangling colon
 * — which is what every form would show on the day migration 164 lands, since
 * 163 seeds no owners.
 */
function trimDanglingSeparator(block: string): string {
  return block.replace(/[\s:：·—–-]+$/u, "");
}

/**
 * The bullets a reader actually sees: parsed, with every `{เจ้าของฟอร์ม}`
 * replaced by this form's owners.
 *
 * With no owners the token becomes empty, the dangling separator is trimmed,
 * and a block that was nothing but the token disappears entirely rather than
 * rendering as a blank bullet.
 */
export function expandFormMessage(
  body: string | null | undefined,
  owners: readonly FormOwnerRef[] | null | undefined,
): string[] {
  const names = (owners ?? [])
    .filter((o) => o.email?.trim())
    .map(formatFormOwner)
    .join(", ");

  const out: string[] = [];
  for (const block of parseFormMessage(body)) {
    if (block.indexOf(FORM_OWNER_TOKEN) === -1) {
      out.push(block);
      continue;
    }
    const replaced = block.split(FORM_OWNER_TOKEN).join(names);
    const cleaned = names ? replaced : trimDanglingSeparator(replaced);
    if (cleaned.trim()) out.push(cleaned);
  }
  return out;
}

/**
 * Why this body may not be saved, in Thai, or `null` when it may.
 *
 * **An empty body is legal** and means "this form shows no notice" — AP-2's and
 * AP-3's state on day one, and how an admin turns a box off.
 *
 * Every failure is a refusal rather than a truncation: silently cutting a
 * compliance paragraph in half is worse than making somebody shorten it.
 */
export function messageBodyProblem(body: string): string | null {
  const text = String(body ?? "");
  if (text.length > MAX_MESSAGE_CHARS) {
    return `ข้อความยาวเกินกำหนด (${text.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} ตัวอักษร)`;
  }
  const blocks = parseFormMessage(text);
  if (blocks.length > MAX_MESSAGE_BLOCKS) {
    return `มีข้อความย่อยเกิน ${MAX_MESSAGE_BLOCKS} ข้อ (ตอนนี้ ${blocks.length} ข้อ) — คั่นแต่ละข้อด้วยบรรทัดว่าง 1 บรรทัด`;
  }
  for (const b of blocks) {
    if (b.length > MAX_BLOCK_CHARS) {
      return `มีข้อความย่อยที่ยาวเกิน ${MAX_BLOCK_CHARS} ตัวอักษร`;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- src/lib/form-environment/form-message-text.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/form-environment/form-message-text.ts src/lib/form-environment/form-message-text.test.ts
git commit -m "feat(form-message): the pure text rules — blank-line blocks, the owner token, bounds"
```

---

### Task 2: Migration 164 and the seed round-trip test

The table, plus seeds for AP-1, AP-17 and AP-4. **The AP-4 seed is compliance copy under a byte-identical test — it must be generated from the constant, never retyped.**

**Files:**
- Create: `migrations/164_core_form_message.sql`
- Modify: `src/features/reimburse/constants.test.ts` (add the round-trip test)

**Interfaces:**
- Consumes: `parseFormMessage` (Task 1), `REIMBURSE_NOTICE`, `AP1_HEADER_MESSAGE_LINES`, `AP17_HEADER_MESSAGE_LINES`
- Produces: `Fast_Core.dbo.FormMessage` with `FormCode` (PK), `BodyText`, `UpdatedBy`, `UpdatedAt`

- [ ] **Step 1: Generate the seed text — do NOT type it by hand**

Write this script **inside the repo** and run it. Its output is what goes into
the migration.

> It lives in `scripts/checks/` rather than a scratch directory because `tsx`
> resolves the `@/` alias from the tsconfig nearest the file — outside the repo
> the alias does not resolve at all. **Keep the file**: regenerating is the only
> safe way to touch AP-4's compliance copy if it ever changes.

Create `scripts/checks/print-form-message-seed.ts`:

```ts
/**
 * Print migration 164's seed bodies, so AP-4's compliance copy is never
 * retyped by hand. `src/features/reimburse/constants.test.ts` asserts the
 * migration still contains exactly this output.
 */
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";
import { REIMBURSE_NOTICE } from "@/features/reimburse/constants";

const AP1 = [
  "รอบการเบิกจ่ายค่าเดินทาง — ตัดรอบวันจันทร์ (อนุมัติแล้ว) และจ่ายตามปฏิทินการชำระของบริษัท (ทุกศุกร์ที่ 2 และศุกร์ที่ 4 ของเดือน)",
  "ถ้า ผจก. อนุมัติก่อนเที่ยง เข้ารอบจ่ายถัดไป · ตั้งแต่เที่ยงเป็นต้นไป ข้ามไปอีกหนึ่งรอบ",
  "พนักงานออฟฟิศที่กลับบ้านเกิน 21.00 น. หรือมีชั่วโมงทำงานเกิน 8 ชั่วโมง เบิกค่าเดินทางกลับบ้านได้",
  "กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: {เจ้าของฟอร์ม}",
];

for (const [code, lines] of [
  ["AP-1", AP1],
  ["AP-17", Array.from(AP17_HEADER_MESSAGE_LINES)],
  ["AP-4", Array.from(REIMBURSE_NOTICE)],
] as const) {
  const body = lines.join("\n\n");
  if (body.indexOf("'") !== -1) throw new Error(`${code}: apostrophe — escape it as '' by hand`);
  console.log(`\n----- ${code} -----\nN'${body}'`);
}
```

Run from the repo root: `npx tsx scripts/checks/print-form-message-seed.ts`

Expected: three `N'…'` literals. No `--env-file` is needed and none should be
passed — the three constants modules import nothing at runtime, which is the
whole reason this script can exist. If it throws on an apostrophe, double it
(`''`) in the migration by hand and note that Step 4's `includes` test will then
need the same treatment.

- [ ] **Step 2: Write the migration, pasting those three literals in**

`migrations/164_core_form_message.sql`. A SQL Server `N'…'` literal spans lines and preserves the newlines, so the blank lines between bullets are the literal's own blank lines — paste the generated output verbatim, do not reflow it.

```sql
-- 164 — Each form's notice copy, so it can be changed without a deploy.
--
-- Apply with:
--   npm run apply-sql -- --db Fast_Core --file migrations/164_core_form_message.sql
--
-- TARGET: Fast_Core, and only Fast_Core.
--
-- ## Why here
--
-- Beside `FormOwner` (163), and for reasons stronger than that one's. There is
-- no identity column at all — `FormCode` is the key — so none of the
-- dual-write lockstep hazards can apply. **One physical copy. Not
-- dual-written, not in MASTER_TABLES:** `npm run check:alignment` must still
-- report **30** afterwards, and 31 means this was wrongly added to that list.
--
-- One copy is the correct answer rather than a convenience. The notice is
-- process copy — "จ่ายทุกศุกร์ที่ 2 และ 4" is the same sentence whether a
-- request lands in Rocks_Portal_Form or Rocks_Portal_Form_UAT. A
-- per-environment copy would be a way for the two to disagree silently.
--
-- The read rides on /api/form-environment, which already opens this pool and
-- already carries `owners` — so the text and the names the {เจ้าของฟอร์ม}
-- token expands to arrive in one payload.
--
-- ## The body format
--
-- **A BLANK line separates two bullets; a single newline does not.** AP-4's
-- six compliance paragraphs each contain single newlines, and measured
-- 2026-09-25 none contains a blank line — so this rule round-trips that
-- notice exactly, where one-line-per-bullet would split it into about fifteen.
-- `src/features/reimburse/constants.test.ts` asserts that round trip against
-- this file, so corrupting the seed here fails the suite.
--
-- FormCode is NOT foreign-keyed to AccFormMaster: that table lives in
-- Rocks_Portal_Form and this database cannot reference it.
--
-- AP-2 and AP-3 are deliberately NOT seeded. Neither form has a notice today,
-- and an absent row means "fall back to the constant" while an empty body
-- means "show nothing" — seeding them empty would assert a decision nobody
-- has taken.
--
-- Idempotent. Safe to re-run: the seed is guarded by NOT EXISTS, so a re-run
-- never overwrites an edit made from the settings page.

SET XACT_ABORT ON;
GO

-- `DB_NAME()` has to go through a variable: RAISERROR's substitution arguments
-- are constants or variables and never expressions, so calling it inline is a
-- parse error — the mistake migration 163's first apply found. The `[_]`
-- escapes LIKE's single-character wildcard.
IF DB_NAME() NOT LIKE 'Fast[_]Core%'
BEGIN
  DECLARE @wrongDb NVARCHAR(128) = DB_NAME();
  RAISERROR('164 targets Fast_Core. Current database is %s — refusing.', 16, 1, @wrongDb);
END
GO

IF OBJECT_ID('dbo.FormMessage', 'U') IS NULL
BEGIN
  CREATE TABLE [dbo].[FormMessage] (
    [FormCode]  NVARCHAR(20)  NOT NULL CONSTRAINT [PK_FormMessage] PRIMARY KEY,
    [BodyText]  NVARCHAR(MAX) NOT NULL,
    [UpdatedBy] NVARCHAR(200) NULL,
    [UpdatedAt] DATETIME2(7)  NOT NULL CONSTRAINT [DF_FormMessage_UpdatedAt] DEFAULT (SYSDATETIME())
  );
  PRINT '164: created dbo.FormMessage';
END
ELSE
  PRINT '164: dbo.FormMessage already exists — nothing to do';
GO

-- AP-1 — the four bullets the user specified on 2026-09-25. The first three
-- are AP1_HEADER_MESSAGE_LINES verbatim; the fourth is the contact line that
-- used to sit in a second box at the foot of the form.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormMessage] WHERE FormCode = N'AP-1')
  INSERT INTO [dbo].[FormMessage] (FormCode, BodyText, UpdatedBy)
  VALUES (N'AP-1', <<<PASTE THE AP-1 LITERAL FROM STEP 1>>>, NULL);
GO

-- AP-17 — AP17_HEADER_MESSAGE_LINES verbatim.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormMessage] WHERE FormCode = N'AP-17')
  INSERT INTO [dbo].[FormMessage] (FormCode, BodyText, UpdatedBy)
  VALUES (N'AP-17', <<<PASTE THE AP-17 LITERAL FROM STEP 1>>>, NULL);
GO

-- AP-4 — REIMBURSE_NOTICE verbatim. This is the owner's own compliance copy:
-- the ** markers, the double space inside the first parenthetical and the
-- leading space on the fourth block's second line are all part of the source
-- text. Do not tidy, translate, re-order or reflow any of it.
IF NOT EXISTS (SELECT 1 FROM [dbo].[FormMessage] WHERE FormCode = N'AP-4')
  INSERT INTO [dbo].[FormMessage] (FormCode, BodyText, UpdatedBy)
  VALUES (N'AP-4', <<<PASTE THE AP-4 LITERAL FROM STEP 1>>>, NULL);
GO

SELECT FormCode, LEN(BodyText) AS BodyChars, UpdatedAt FROM [dbo].[FormMessage] ORDER BY FormCode;
GO
```

Replace each `<<<PASTE …>>>` with the matching literal. **Nothing may remain in angle brackets.**

- [ ] **Step 3: Write the failing round-trip test**

Append to `src/features/reimburse/constants.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { parseFormMessage } from "@/lib/form-environment/form-message-text";

/**
 * Migration 164 seeds AP-4's notice into `Fast_Core.dbo.FormMessage`, and from
 * then on that seed — not the constant — is what a requester reads.
 *
 * The byte-identical test above never reads the migration, so without this one
 * the compliance copy could be corrupted by the seed while that test stayed
 * green. Asserting the joined constant appears in the file is the whole check:
 * the seed IS `REIMBURSE_NOTICE.join("\n\n")` inside an N'…' literal.
 *
 * Line endings are normalised because git checks this repo out with CRLF, and
 * `parseFormMessage` normalises the stored value the same way on read.
 */
test("migration 164 seeds AP-4's notice byte-identically", () => {
  const sql = readFileSync("migrations/164_core_form_message.sql", "utf8").replace(/\r\n?/g, "\n");
  assert.ok(
    sql.includes(Array.from(REIMBURSE_NOTICE).join("\n\n")),
    "migration 164's AP-4 seed is not REIMBURSE_NOTICE joined by blank lines",
  );
});

test("migration 164's AP-4 seed parses back to exactly the six blocks", () => {
  const sql = readFileSync("migrations/164_core_form_message.sql", "utf8").replace(/\r\n?/g, "\n");
  const seed = Array.from(REIMBURSE_NOTICE).join("\n\n");
  assert.deepEqual(parseFormMessage(seed), Array.from(REIMBURSE_NOTICE));
  assert.ok(sql.includes(seed));
});
```

Also add the same shape for AP-1 and AP-17 in a new file `src/lib/form-environment/form-message-seed.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseFormMessage, FORM_OWNER_TOKEN } from "./form-message-text";
import { AP1_HEADER_MESSAGE_LINES } from "@/features/accounting/constants";
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";

const SQL = readFileSync("migrations/164_core_form_message.sql", "utf8").replace(/\r\n?/g, "\n");

test("164 seeds AP-17 as its constant, blank-line joined", () => {
  assert.ok(SQL.includes(Array.from(AP17_HEADER_MESSAGE_LINES).join("\n\n")));
});

test("164's AP-1 seed opens with the three existing header lines", () => {
  assert.ok(SQL.includes(Array.from(AP1_HEADER_MESSAGE_LINES).join("\n\n")));
});

test("164's AP-1 seed carries the owner token as its last bullet", () => {
  assert.ok(SQL.includes(`กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: ${FORM_OWNER_TOKEN}`));
});

test("no paste placeholder was left in the migration", () => {
  assert.ok(!/<<<|>>>/.test(SQL), "migration 164 still contains a <<<PASTE …>>> marker");
});

test("164 does not seed AP-2 or AP-3 — an absent row means 'use the constant'", () => {
  assert.ok(!SQL.includes("N'AP-2'"));
  assert.ok(!SQL.includes("N'AP-3'"));
});
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/features/reimburse/constants.test.ts src/lib/form-environment/form-message-seed.test.ts`
Expected: PASS. A failure here means the seed was retyped rather than generated — regenerate it with Step 1's script rather than editing the test.

- [ ] **Step 5: Commit**

```bash
git add migrations/164_core_form_message.sql src/features/reimburse/constants.test.ts src/lib/form-environment/form-message-seed.test.ts
git commit -m "feat(form-message): migration 164 — Fast_Core.FormMessage, seeded from the constants"
```

> **Do not apply the migration yet.** It is safe to apply at any point (a missing table degrades to the constants), and §15 of the spec covers it. Applying is the user's call — see Task 11.

---

### Task 3: The service

Read and write, modelled on `form-owner.ts` line for line, including which error it is allowed to swallow.

**Files:**
- Create: `src/lib/form-environment/form-message-fallback.ts` (pure)
- Create: `src/lib/form-environment/form-message.ts` (pools)
- Create: `src/lib/form-environment/form-message-resolve.test.ts`

> **The split is mandatory, not a preference.** `npm test` is `tsx --test` with
> **no `--env-file`** (`scripts/run-tests.ts`), so `@/env` throws at import and
> a test that imports `form-message.ts` — which reaches `@/lib/db/mssql` — dies
> before a single assertion runs. The fallback map and the resolver are the
> half worth testing, so they live in a module that imports no pool. This is
> the same policy/pool split `request-acl-policy` and `current-manager-sql`
> use. The three notice constants import nothing at runtime (checked: only one
> `import type`), so the pure module may import all three.

**Interfaces:**
- Consumes: `getCorePool`, `sql` from `@/lib/db/mssql`; `parseFormMessage`, `expandFormMessage` (Task 1); the three notice constants
- Produces from `form-message-fallback.ts`:
  - `FORM_MESSAGE_FALLBACK: Readonly<Record<string, readonly string[]>>`
  - `resolveFormMessageBlocks(formCode, stored, owners): string[]`
- Produces from `form-message.ts` (which **re-exports both of the above**, so every caller has one import path):
  - `FormMessageRow { body: string; updatedBy: string | null; updatedAt: string | null }`
  - `listFormMessageBodies(): Promise<Readonly<Record<string, string>> | null>` — `null` means "the table is not there"
  - `getFormMessage(formCode: string): Promise<FormMessageRow | null>`
  - `setFormMessage(formCode: string, body: string, actorEmail: string | null): Promise<void>`

- [ ] **Step 1a: Write the pure module**

`src/lib/form-environment/form-message-fallback.ts`:

```ts
/**
 * What each form shows when the database cannot answer, and the rule that
 * decides when that applies.
 *
 * Separate from `form-message.ts` because that module opens a pool, which
 * drags `@/env` in — and `npm test` runs with no env file, so a test importing
 * it never reaches its first assertion. This is the half worth testing.
 *
 * The three notice constants it imports have no runtime imports of their own,
 * which is what makes this module safe to load in a test.
 */
import { expandFormMessage } from "./form-message-text";
import type { FormOwnerRef } from "./form-owner-text";
import { AP1_HEADER_MESSAGE_LINES } from "@/features/accounting/constants";
import { AP17_HEADER_MESSAGE_LINES } from "@/features/travel-booking/constants";
import { REIMBURSE_NOTICE } from "@/features/reimburse/constants";

/**
 * What each form printed before this table existed.
 *
 * Used ONLY when the table itself is missing or a form has no row — never when
 * a row exists with an empty body, which means "this form shows no notice" and
 * is a decision an admin took. AP-2 and AP-3 have no entry because they have
 * no notice to fall back to.
 */
export const FORM_MESSAGE_FALLBACK: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "AP-1": AP1_HEADER_MESSAGE_LINES,
  "AP-17": AP17_HEADER_MESSAGE_LINES,
  "AP-4": REIMBURSE_NOTICE,
});

/**
 * The bullets a reader sees, given what the table answered.
 *
 * Three cases, and the middle one is the one worth stating: a **missing table**
 * or a **missing row** falls back to the constant, while a **row with an empty
 * body** is `[]` — an admin who clears the message means it.
 */
export function resolveFormMessageBlocks(
  formCode: string,
  stored: Readonly<Record<string, string>> | null,
  owners: readonly FormOwnerRef[] | null | undefined,
): string[] {
  if (stored === null || !(formCode in stored)) {
    return expandFormMessage(
      Array.from(FORM_MESSAGE_FALLBACK[formCode] ?? []).join("\n\n"),
      owners,
    );
  }
  return expandFormMessage(stored[formCode], owners);
}
```

- [ ] **Step 1b: Write the pool module**

Write `src/lib/form-environment/form-message.ts` exactly as below, but **omit
`FORM_MESSAGE_FALLBACK` and `resolveFormMessageBlocks`** — they are in Step 1a.
Instead add this re-export at the end, so every caller has one import path:

```ts
export { FORM_MESSAGE_FALLBACK, resolveFormMessageBlocks } from "./form-message-fallback";
```

```ts
/**
 * Each form's notice copy — the box at the top of the form.
 *
 * Storage is `Fast_Core.dbo.FormMessage` (migration 164); see that file's
 * header for why it lives there and why there is no identity column.
 *
 * **It grants nothing and decides nothing.** It is text on a page, and every
 * gate in this application is unaware of it — the property to preserve if a
 * later change is tempted to read this table to decide something.
 */
import { getCorePool, sql } from "@/lib/db/mssql";

export interface FormMessageRow {
  body: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

/**
 * True for the one error this is allowed to swallow: the table is not there.
 *
 * Anything else — a dead pool, a permission problem — is a real fault and is
 * rethrown, because silently printing "no notice" over a Fast_Core outage
 * would hide the outage without helping anybody. `form-owner.ts` draws the
 * same line for the same reason.
 */
function isMissingTable(e: unknown): boolean {
  const message = e instanceof Error ? e.message : String(e);
  return /Invalid object name/i.test(message) && /FormMessage/i.test(message);
}

/**
 * Every form's stored body, keyed by form code.
 *
 * **`null` means the table is missing, `{}` means it is empty** — the caller
 * has to tell those apart, because the first falls back to the constants for
 * every form and the second does not.
 */
export async function listFormMessageBodies(): Promise<Readonly<Record<string, string>> | null> {
  try {
    const pool = await getCorePool();
    const res = await pool.request().query<{ FormCode: string; BodyText: string }>(
      `SELECT FormCode, BodyText FROM [dbo].[FormMessage]`,
    );
    const out: Record<string, string> = {};
    for (const r of res.recordset) out[r.FormCode] = r.BodyText ?? "";
    return out;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/** One form's row for the settings editor, or `null` when it has none. */
export async function getFormMessage(formCode: string): Promise<FormMessageRow | null> {
  const code = formCode.trim();
  if (!code) throw new Error("formCode is required");
  try {
    const pool = await getCorePool();
    const res = await pool
      .request()
      .input("code", sql.NVarChar, code)
      .query<{ BodyText: string; UpdatedBy: string | null; UpdatedAt: Date | null }>(
        `SELECT BodyText, UpdatedBy, UpdatedAt FROM [dbo].[FormMessage] WHERE FormCode = @code`,
      );
    const row = res.recordset[0];
    if (!row) return null;
    return {
      body: row.BodyText ?? "",
      updatedBy: row.UpdatedBy ?? null,
      updatedAt: row.UpdatedAt ? row.UpdatedAt.toISOString() : null,
    };
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/**
 * Replace one form's message.
 *
 * A MERGE rather than delete-then-insert: there is exactly one row per form and
 * `FormCode` is the primary key, so there is nothing to diff. Bounded to the
 * one form — **the caller passes a literal, never a value off the wire**, which
 * is what stops a grant on one form's tab from rewriting another form's copy.
 */
export async function setFormMessage(
  formCode: string,
  body: string,
  actorEmail: string | null,
): Promise<void> {
  const code = formCode.trim();
  if (!code) throw new Error("formCode is required");
  const pool = await getCorePool();
  await pool
    .request()
    .input("code", sql.NVarChar, code)
    .input("body", sql.NVarChar(sql.MAX), String(body ?? ""))
    .input("by", sql.NVarChar, actorEmail || null)
    .query(
      `MERGE [dbo].[FormMessage] AS t
       USING (SELECT @code AS FormCode) AS s ON t.FormCode = s.FormCode
       WHEN MATCHED THEN
         UPDATE SET BodyText = @body, UpdatedBy = @by, UpdatedAt = SYSDATETIME()
       WHEN NOT MATCHED THEN
         INSERT (FormCode, BodyText, UpdatedBy) VALUES (@code, @body, @by);`,
    );
}

/* One import path for every caller, even though the rule lives next door. */
export { FORM_MESSAGE_FALLBACK, resolveFormMessageBlocks } from "./form-message-fallback";
```

- [ ] **Step 2: Write tests for the pure half**

Create `src/lib/form-environment/form-message-resolve.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
// The PURE module, never "./form-message" — that one opens a pool, and the
// test runner has no env file, so importing it throws before any assertion.
import { resolveFormMessageBlocks, FORM_MESSAGE_FALLBACK } from "./form-message-fallback";

test("a missing TABLE falls back to the form's constant", () => {
  const out = resolveFormMessageBlocks("AP-1", null, []);
  assert.deepEqual(out.slice(0, 3), Array.from(FORM_MESSAGE_FALLBACK["AP-1"]));
});

test("a missing ROW falls back to the form's constant", () => {
  const out = resolveFormMessageBlocks("AP-1", {}, []);
  assert.deepEqual(out.slice(0, 3), Array.from(FORM_MESSAGE_FALLBACK["AP-1"]));
});

test("a row with an EMPTY body is no notice — not the constant", () => {
  assert.deepEqual(resolveFormMessageBlocks("AP-1", { "AP-1": "" }, []), []);
});

test("a form with no constant and no row shows nothing", () => {
  assert.deepEqual(resolveFormMessageBlocks("AP-2", null, []), []);
  assert.deepEqual(resolveFormMessageBlocks("AP-2", {}, []), []);
});

test("a stored body wins over the constant and expands its token", () => {
  assert.deepEqual(
    resolveFormMessageBlocks("AP-1", { "AP-1": "ถาม {เจ้าของฟอร์ม}" }, [
      { email: "a@rocksgroup.com", displayName: "Ay One" },
    ]),
    ["ถาม Ay One (a@rocksgroup.com)"],
  );
});
```

> If this test throws at import, the import path is wrong — it must name
> `./form-message-fallback`, never `./form-message`. Do **not** delete the test
> and do **not** work around it by adding an env file to the runner.

- [ ] **Step 3: Run the tests**

Run: `npm test -- src/lib/form-environment/form-message-resolve.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/form-environment/form-message.ts src/lib/form-environment/form-message-resolve.test.ts
git commit -m "feat(form-message): the service — read, write, and the three fallback cases"
```

---

### Task 4: `/api/form-environment` carries the message

**Files:**
- Modify: `src/lib/form-environment/payload-types.ts`
- Modify: `src/app/api/form-environment/route.ts`

**Interfaces:**
- Consumes: `listFormMessageBodies`, `resolveFormMessageBlocks` (Task 3)
- Produces: `FormAccess.message: string[]` on the payload every form page already fetches

- [ ] **Step 1: Add the field to the payload type**

In `payload-types.ts`, inside `interface FormAccess`, after `owners`:

```ts
  /**
   * The form's notice copy, already split into blocks and with
   * `{เจ้าของฟอร์ม}` expanded against this form's own `owners`.
   *
   * Expanded server-side, so the five renderers receive a plain `string[]` and
   * share no logic beyond it — a client-side expansion would put the token
   * rule in the bundle five times.
   *
   * `[]` means "no notice", which is a fact; a client can tell it from a
   * payload that never arrived, exactly as `owners` can.
   */
  message: string[];
```

- [ ] **Step 2: Fill it in the route**

In `src/app/api/form-environment/route.ts`, add the import:

```ts
import { listFormMessageBodies, resolveFormMessageBlocks } from "@/lib/form-environment/form-message";
```

Add `listFormMessageBodies()` to the existing `Promise.all`, so it is a fifth read on the same Fast_Core pool rather than a second round trip:

```ts
    const [switches, tester, cookieStore, owners, messages] = await Promise.all([
      getFormSwitchMap(),
      getActiveUatTester(email),
      cookies(),
      listFormOwners(),
      listFormMessageBodies(),
    ]);
```

Then inside the `codes.forEach` block, after `owners:`:

```ts
        // Resolved here, not on the client: the owners the token expands to
        // are already in hand, so the renderers get a plain string[].
        message: resolveFormMessageBlocks(code, messages, owners[code] ?? []),
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors. If `FormAccess` is constructed anywhere else, `tsc` names it — add `message` there too rather than making the field optional.

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/form-environment/payload-types.ts src/app/api/form-environment/route.ts
git commit -m "feat(form-message): the notice rides on /api/form-environment beside the owners"
```

---

### Task 5: The Message tab is ADMIN-ONLY on all five forms

> **⚠ This task was rewritten on 2026-09-25, before any code was written.** It
> originally made `messages` a *grantable* key on every form. It is
> **ungrantable** — see spec §8's amendment. The short version, because it is
> the thing most likely to be "helpfully" undone:
>
> **All four settings-tab tables are shared with the ACC Portal sibling, which
> rewrites them through its own key filter.** `ACC_Portal/src/lib/acc/approver-settings-tabs.ts:47-56`
> does `DELETE FROM AccApproverSettingsTab WHERE ApproverId = @aid` then
> re-INSERTs only `filterGrantableTabKeys(keys)` — a five-key list with no
> `messages`. So a Message grant stored here is **silently deleted** the next
> time an admin saves that person's tabs in ACC Portal. That is the exact
> defect commit 8a3ab358 fixed for AP-17's menu ticks.
>
> **Do not add `messages` to any grantable list.** If a reviewer flags the
> inconsistency with the other tabs, this note is the answer.

Pure vocabulary changes. No routes yet — this task makes the tab exist as an
admin-only one and gives each grid the text to explain why.

**Files:**
- Modify: `src/lib/acc/settings-tabs.ts` (AP-1)
- Modify: `src/lib/acc/reimburse/settings-tabs.ts` (AP-4)
- Modify: `src/lib/adv/settings-tabs.ts` (AP-2 and AP-3)

> **AP-17 needs no change to `settings-tabs.ts` at all.** Its strip is
> `GRANTABLE_BOOKING_TABS.map(...).concat([per-diem, access])` in the page, so
> an ungrantable tab is added to that `.concat` in Task 8 — exactly how
> `per-diem` is already handled. Adding it to `GrantableBookingTabKey` would
> make it grantable, which is what this task exists to avoid.

**Interfaces:**
- Produces: admin-only tab keys `"messages"` (AP-1, AP-17, AP-4), `"advanceMessages"` (AP-2), `"clearMessages"` (AP-3). **None is in any grantable list.**

- [ ] **Step 1: AP-1**

In `src/lib/acc/settings-tabs.ts`, **leave `GrantableSettingsTabKey` and
`GRANTABLE_SETTINGS_TABS` untouched.** Add only the route rule, in
`SETTINGS_ROUTE_TABS`, after the two `vehicles` entries:

```ts
  {
    route: "messages",
    tab: null,
    // Admin-only, and NOT because a message is dangerous — it grants nothing,
    // decides no approval, no posting target and no read. It is because the
    // grant could not be stored: `AccApproverSettingsTab` is shared with ACC
    // Portal, whose own save deletes every row for an approver and re-inserts
    // only the keys ITS list knows (`approver-settings-tabs.ts:47-56`). A
    // `messages` grant would vanish the next time somebody edited that
    // person's tabs over there, with no error on either side — the defect
    // 8a3ab358 fixed for AP-17's menu ticks. Making it grantable means adding
    // the key to BOTH applications in one change, not to this list alone.
    note: "grant unstorable — ACC Portal rewrites AccApproverSettingsTab through its own key filter",
  },
```

- [ ] **Step 2: AP-17 — nothing to do here**

Deliberately empty. `GrantableBookingTabKey`, `BOOKING_TAB_LABELS` and
`BOOKING_TAB_ORDER` are all **unchanged** — every key in them is grantable by
construction, and this tab must not be. AP-17's Message tab is appended to the
page's own `TABS` array in Task 8, beside `per-diem` and `access`, which are
ungrantable for their own reasons and handled the same way.

Confirm you changed nothing:

```bash
git diff --stat src/lib/acc/travel-booking/settings-tabs.ts
```
Expected: no output.

- [ ] **Step 3: AP-4**

In `src/lib/acc/reimburse/settings-tabs.ts`, in `REIMBURSE_SETTINGS_TAB_ORDER` between `"rules"` and `"glAccounts"`:

```ts
  "rules",
  "messages",
  "glAccounts",
```

and add to `REIMBURSE_ALL_TAB_META` (a `Record` over the union, so omitting this is a compile error). **`adminOnly` is what keeps it ungrantable and what the grid prints in its cell:**

```ts
  messages: {
    label: "Message",
    adminOnly: "แก้ได้เฉพาะแอดมิน — สิทธิ์นี้เก็บไม่ได้ เพราะ ACC Portal เขียนทับตารางสิทธิ์แท็บ",
  },
```

**And widen the grantable exclusion**, or the key becomes grantable by default —
`GrantableReimburseTabKey` is written as an `Exclude`, and its own docblock says
that a tab added to the strip is grantable **unless excluded here**:

```ts
export type GrantableReimburseTabKey = Exclude<ReimburseSettingsTabKey, "access" | "messages">;
```

> This is the fail-open default that module warns about, meeting a tab that
> must not be granted. Skipping it does not fail the typecheck — it silently
> ships a tick that ACC Portal will delete.

- [ ] **Step 4: AP-2 and AP-3**

In `src/lib/adv/settings-tabs.ts`:

```ts
export const ADVANCE_SETTINGS_TAB_ORDER = [
  "brands",
  "matrix",
  "banks",
  "advanceMessages",
  "advanceErpInterface",
  "access",
] as const;
```

```ts
export const CLEAR_SETTINGS_TAB_ORDER = [
  "glAccounts",
  "buGlMap",
  "locations",
  "clearMessages",
  "clearErpInterface",
  "access",
] as const;
```

**Do NOT add either key to `GRANTABLE_ADV_CLR_TABS`.** Add them to
`ALL_ADV_CLR_TABS` only, each carrying `adminOnly` — that field is what makes
the grid render a disabled box with the reason instead of a tick, and
`storableAdvClrKeysForForm` skips anything `isGrantableAdvClrTabKey` refuses:

```ts
  {
    key: "advanceMessages",
    label: "Message",
    adminOnly: "แก้ได้เฉพาะแอดมิน — สิทธิ์นี้เก็บไม่ได้ เพราะ ACC Portal เขียนทับตารางสิทธิ์แท็บ",
  },
  {
    key: "clearMessages",
    label: "Message",
    adminOnly: "แก้ได้เฉพาะแอดมิน — สิทธิ์นี้เก็บไม่ได้ เพราะ ACC Portal เขียนทับตารางสิทธิ์แท็บ",
  },
```

> **Still two keys, not one shared `messages`, even though neither is
> grantable.** `advClrTabsForForm` derives each page's strip by matching strip
> entries against `ALL_ADV_CLR_TABS`, so one shared key would put the same row
> on both pages and make "which form does this tab configure?" unanswerable —
> and the two routes write different `FormCode`s. Keeping them split also means
> nothing has to change here if they are ever made grantable in both
> applications at once.
>
> Being ungrantable, they stay out of `storableAdvClrKeysForForm` entirely, so
> the **disjointness and coverage** assertions in `settings-tabs.test.ts` are
> untouched — exactly as `access` is today.

- [ ] **Step 5: Run the vocabulary tests**

Run: `npm test -- src/lib/adv/settings-tabs.test.ts src/lib/acc/travel-booking/settings-tabs.test.ts src/lib/acc/reimburse/settings-tabs.test.ts`
Expected: PASS. The AP-2/AP-3 disjointness and coverage assertions must still pass **unchanged** — if either now fails, a key was wrongly added to `GRANTABLE_ADV_CLR_TABS`.

`npm test -- src/lib/acc/settings-tabs.test.ts` is **expected to FAIL** at this point: `SETTINGS_ROUTE_TABS` now names a `messages` route that does not exist on disk. Task 6 creates it. Do not "fix" it by removing the entry.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/lib/acc/settings-tabs.ts src/lib/acc/reimburse/settings-tabs.ts src/lib/adv/settings-tabs.ts
git commit -m "feat(form-message): an admin-only Message tab on all five forms"
```

---

### Task 6: The five routes

Each route pins its own form code and its own tab key.

**Files:**
- Create: `src/app/api/request/accounting/settings/messages/route.ts`
- Create: `src/app/api/request/travel-booking/settings/messages/route.ts`
- Create: `src/app/api/request/reimburse/settings/messages/route.ts`
- Create: `src/app/api/request/advance/settings/messages/route.ts`
- Create: `src/app/api/request/clear-advance/settings/messages/route.ts`
- Create: `src/lib/form-environment/form-message-route-guard.test.ts`
- Modify: `src/lib/acc/settings-tabs.test.ts` (handler count 31 → 33)
- Modify: `src/lib/acc/reimburse/settings-route-gates.test.ts` (add `messages`)
- Modify: `src/lib/adv/settings-route-gates.test.ts` (add both keys)

**Interfaces:**
- Consumes: `getFormMessage`, `setFormMessage` (Task 3); `messageBodyProblem` (Task 1); the four tab guards
- Produces: `GET`/`POST` on each of the five paths

- [ ] **Step 1: Write AP-1's route**

`src/app/api/request/accounting/settings/messages/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { getFormMessage, setFormMessage } from "@/lib/form-environment/form-message";
import { messageBodyProblem } from "@/lib/form-environment/form-message-text";

/**
 * AP-1's notice copy — the box at the top of the travel-expense form.
 *
 * **`FORM_CODE` is a literal and is never read from the body.** Which form a
 * route governs is a property of the route, the same rule `requireSettingsTab`
 * states for its tab key; a posted form code would let this route rewrite
 * another form's notice.
 *
 * **Admin-only rather than tab-granted, and the reason is storage rather than
 * risk.** A message grants nothing — no approval, no posting target, no read.
 * But `AccApproverSettingsTab` is shared with the ACC Portal sibling, whose own
 * save deletes every row for an approver and re-inserts only the keys its list
 * knows (`approver-settings-tabs.ts:47-56`), so a `messages` grant would vanish
 * on that app's next save with no error either side. Making it grantable means
 * adding the key to both applications in one change. See spec §8.
 *
 * The rows live in `Fast_Core`, reached through `getCorePool()`, so this route
 * needs no `ROUTE_RULES` entry and is unaffected by the settings prefix being
 * pinned to Production.
 */
const FORM_CODE = "AP-1";

export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const row = await getFormMessage(FORM_CODE);
    return NextResponse.json({ ok: true, data: row ?? { body: "", updatedBy: null, updatedAt: null } });
  } catch (err) {
    console.error("[api/request/accounting/settings/messages] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const body = await req.json();
    const text = typeof body?.body === "string" ? body.body : "";
    const problem = messageBodyProblem(text);
    if (problem) return NextResponse.json({ ok: false, error: problem }, { status: 400 });
    await setFormMessage(FORM_CODE, text, session.user?.email ?? null);
    return NextResponse.json({ ok: true, data: await getFormMessage(FORM_CODE) });
  } catch (err) {
    console.error("[api/request/accounting/settings/messages] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write the other four**

Identical but for **`FORM_CODE` and the `console.error` prefix**. The gate is
`requireRole(["IT Admin", "System Admin"])` on all five, so the import line is
the same everywhere too. Repeat the whole file each time; do not factor it into
a shared handler, because the literal per file is the control.

| file | `FORM_CODE` | `console.error` prefix |
|---|---|---|
| `travel-booking/settings/messages` | `"AP-17"` | `[api/request/travel-booking/settings/messages]` |
| `reimburse/settings/messages` | `"AP-4"` | `[api/request/reimburse/settings/messages]` |
| `advance/settings/messages` | `"AP-2"` | `[api/request/advance/settings/messages]` |
| `clear-advance/settings/messages` | `"AP-3"` | `[api/request/clear-advance/settings/messages]` |

Adjust the docblock's first line and its shared-table reference per form —
AP-17's is `AccBookingApproverTab`, AP-4's `AccReimburseAccessTab`, AP-2's and
AP-3's `AccAdvClrAccessTab`. The rest of the reasoning is the same on all five.

- [ ] **Step 3: Write the source-shape guard test**

`src/lib/form-environment/form-message-route-guard.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * These five routes reach a pool, and `@/env` validates the whole environment
 * at import — so none of them can be called from a test at all. This reads
 * their sources instead, and pins the two things a typechecker cannot see.
 *
 * Both failures are silent: every `FORM_CODE` is a string, so giving AP-4's
 * route `"AP-1"` compiles and edits the wrong form's copy; and every tab key
 * is a string on three of the five guards, so passing AP-2's key on AP-3's
 * route compiles and gates the wrong grant.
 */
const GATE = 'requireRole(["IT Admin", "System Admin"])';

const ROUTES = [
  { path: "src/app/api/request/accounting/settings/messages/route.ts", code: "AP-1" },
  { path: "src/app/api/request/travel-booking/settings/messages/route.ts", code: "AP-17" },
  { path: "src/app/api/request/reimburse/settings/messages/route.ts", code: "AP-4" },
  { path: "src/app/api/request/advance/settings/messages/route.ts", code: "AP-2" },
  { path: "src/app/api/request/clear-advance/settings/messages/route.ts", code: "AP-3" },
];

for (const r of ROUTES) {
  const src = readFileSync(r.path, "utf8");

  test(`${r.code}: FORM_CODE is its own literal`, () => {
    assert.ok(
      new RegExp(`const FORM_CODE = "${r.code}"`).test(src),
      `${r.path} does not pin FORM_CODE to ${r.code}`,
    );
  });

  test(`${r.code}: exactly one form code appears in the file`, () => {
    const found = Array.from(new Set(src.match(/"AP-\d+"/g) ?? []));
    assert.deepEqual(found, [`"${r.code}"`], `${r.path} names more than its own form`);
  });

  test(`${r.code}: the form code is never read from the request body`, () => {
    assert.ok(!/body\??\.\s*formCode/.test(src), `${r.path} reads formCode off the wire`);
  });

  test(`${r.code}: both handlers open with the admin gate`, () => {
    const calls = src.match(/await require[A-Za-z]+\([^)]*\)/g) ?? [];
    assert.equal(calls.length, 2, `${r.path} should gate exactly GET and POST`);
    for (const c of calls) {
      assert.ok(c.includes(GATE), `${r.path} uses the wrong gate: ${c}`);
    }
  });

  /**
   * The grant is unstorable: all four settings-tab tables are shared with ACC
   * Portal, whose save deletes an approver's rows and re-inserts only the keys
   * its own list knows — so a `messages` tick made here disappears on that
   * app's next save, with no error either side (spec §8). Swapping this gate
   * for a tab guard compiles and passes every other test in the repo, so this
   * is the only thing standing between that and shipping.
   */
  test(`${r.code}: is NOT tab-gated — the grant cannot be stored`, () => {
    assert.ok(
      !/require(Settings|Booking|Reimburse|AdvClr)[A-Za-z]*Tab\s*\(/.test(src),
      `${r.path} is tab-gated; the grant would be deleted by ACC Portal — see spec §8`,
    );
  });

  test(`${r.code}: the refusal is returned, not computed and dropped`, () => {
    const returns = src.match(/if \(session instanceof Response\) return session;/g) ?? [];
    assert.equal(returns.length, 2, `${r.path} does not return both refusals`);
  });

  test(`${r.code}: the body is validated before anything is written`, () => {
    assert.ok(
      src.indexOf("messageBodyProblem") < src.indexOf("setFormMessage"),
      `${r.path} writes before it validates`,
    );
  });
}
```

- [ ] **Step 4: Update the three existing route-gate tests**

1. `src/lib/acc/settings-tabs.test.ts` — change the pinned handler count from `31` to `33` (the new route adds GET and POST). The comment above it explains why the number is pinned; leave it. **Read how that file asserts an admin-only rule** (`tab: null`, e.g. the `approvers` and `departments/sync` entries) and make sure the new `messages` entry satisfies the same assertion — it expects a `requireRole` gate, not a tab guard.
2. `src/lib/acc/reimburse/settings-route-gates.test.ts` — add a `ROUTE_GATES` entry for `messages` using the **role** gate shape, not the tab shape. Copy it from the existing `erp-sync` entry, which is admin-only for its own reason; do **not** write `{ kind: "tab", tab: "messages" }`.
3. `src/lib/adv/settings-route-gates.test.ts` — read the file first to learn its entry shape, then add one entry for `advance/settings/messages` and one for `clear-advance/settings/messages`, both with the **role** gate shape, matching whatever that file's existing admin-only entries use (`vendors/sync`, `erp-batches`, `locations/sync` and `erp-sync` are all admin-only there).

> If any of those three test files asserts "every grantable key has a tab-gated route" in the other direction too, nothing needs doing — `messages` is not a grantable key on any form, so it is outside that assertion entirely.

- [ ] **Step 5: Run everything**

Run: `npm test`
Expected: PASS, including `src/lib/acc/settings-tabs.test.ts`, which failed at the end of Task 5.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/app/api/request/*/settings/messages/route.ts src/lib/form-environment/form-message-route-guard.test.ts src/lib/acc/settings-tabs.test.ts src/lib/acc/reimburse/settings-route-gates.test.ts src/lib/adv/settings-route-gates.test.ts
git commit -m "feat(form-message): five routes, each pinning its own form code and gate"
```

---

### Task 7: The hook and the settings panel

**Files:**
- Create: `src/lib/hooks/useFormMessage.ts`
- Create: `src/components/settings/FormMessageSettings.tsx`

**Interfaces:**
- Consumes: `useFormEnvironments`; `parseFormMessage`, `expandFormMessage`, `messageBodyProblem`, `MAX_*` (Task 1); the routes (Task 6)
- Produces: `useFormMessage(formCode: string): string[]`; `<FormMessageSettings endpoint formCode />`

- [ ] **Step 1: The hook**

```tsx
"use client";

import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";

/**
 * A form's notice bullets, already expanded server-side.
 *
 * Rides on the payload every form page already fetches — one SWR key shared
 * across the page, so this costs no request of its own. `FormOwnerNotice`'s
 * own hook is the model.
 *
 * `[]` while loading and `[]` on a failed fetch: a notice box that flashes in
 * and out is worse than one that appears a moment late, and a form must never
 * fail to render because its copy could not be read.
 */
export function useFormMessage(formCode: string): string[] {
  const { data } = useFormEnvironments();
  return data?.forms?.[formCode]?.message ?? [];
}
```

- [ ] **Step 2: The panel**

`src/components/settings/FormMessageSettings.tsx`. One component for all five tabs, parameterised by `endpoint` and `formCode` — the shape `BrandToggleCard` already uses.

```tsx
"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Save, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";
import {
  expandFormMessage,
  parseFormMessage,
  messageBodyProblem,
  FORM_OWNER_TOKEN,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_BLOCKS,
} from "@/lib/form-environment/form-message-text";

interface MessageRow {
  body: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const fetcher = async (url: string): Promise<MessageRow> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
  return json.data as MessageRow;
};

/**
 * The Message tab, shared by all five forms.
 *
 * The **live preview** is not decoration: it runs the same
 * `parseFormMessage` + `expandFormMessage` the form runs, against this form's
 * real owners, so the blank-line rule and a mistyped token are visible before
 * saving rather than after. It is the only thing that makes the format
 * learnable.
 */
export function FormMessageSettings({
  endpoint,
  formCode,
}: {
  endpoint: string;
  formCode: string;
}) {
  const { data, error, isLoading, mutate } = useSWR<MessageRow>(endpoint, fetcher);
  const { data: env } = useFormEnvironments();
  const owners = env?.forms?.[formCode]?.owners ?? [];

  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seeded once from the server, then owned by the textarea — re-seeding per
  // render would snap a half-typed edit back on every revalidation.
  useEffect(() => {
    if (data && text === null) setText(data.body);
  }, [data, text]);

  const body = text ?? "";
  const blocks = expandFormMessage(body, owners);
  const problem = messageBodyProblem(body);
  const dirty = data != null && body !== data.body;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
      await mutate(json.data as MessageRow, { revalidate: false });
      setText((json.data as MessageRow).body);
      toast.success("บันทึกข้อความแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>;
  }
  // A failed read must never render as an empty message: saving over it would
  // wipe the real copy. Same rule `LogPanel` learned the hard way.
  if (error) {
    return (
      <p className="text-[13px]" style={{ color: "var(--text-danger)" }}>
        โหลดข้อความไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
      >
        <p className="m-0">• คั่นแต่ละข้อด้วย<strong>บรรทัดว่าง 1 บรรทัด</strong> — การขึ้นบรรทัดใหม่เฉย ๆ จะยังอยู่ในข้อเดียวกัน</p>
        <p className="m-0">• พิมพ์ <code>{FORM_OWNER_TOKEN}</code> เพื่อแทนชื่อเจ้าของฟอร์ม — ถ้าลบออก บรรทัดติดต่อจะหายไปด้วย</p>
        <p className="m-0">• ปล่อยว่างไว้ = ไม่แสดงกล่องข้อความบนฟอร์มนี้</p>
      </div>

      <textarea
        value={body}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full rounded-xl px-3 py-2.5 text-[13px] leading-relaxed font-mono"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap text-[12px]">
        <span style={{ color: problem ? "var(--text-danger)" : "var(--text-muted)" }}>
          {problem ?? `${body.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} ตัวอักษร · ${parseFormMessage(body).length} / ${MAX_MESSAGE_BLOCKS} ข้อ`}
        </span>
        <Button onClick={save} disabled={saving || !!problem || !dirty}>
          <Save size={14} /> {saving ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
      </div>

      {data?.updatedAt && (
        <p className="text-[11.5px] m-0" style={{ color: "var(--text-faint)" }}>
          แก้ไขล่าสุด {new Date(data.updatedAt).toLocaleString("th-TH")}
          {data.updatedBy ? ` โดย ${data.updatedBy}` : ""}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <Eye size={13} /> ตัวอย่างที่ผู้ขอเบิกจะเห็น
        </span>
        {blocks.length === 0 ? (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-faint)" }}>
            ไม่มีข้อความ — ฟอร์มนี้จะไม่แสดงกล่องข้อความ
          </p>
        ) : (
          <div
            className="rounded-2xl px-4 py-3.5 flex flex-col gap-1"
            style={{
              background: "color-mix(in srgb, var(--color-action) 8%, var(--bg-card))",
              border: "1px solid color-mix(in srgb, var(--color-action) 25%, var(--border-card))",
            }}
          >
            {blocks.map((b, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed m-0 whitespace-pre-line" style={{ color: "var(--text-secondary)" }}>
                {b}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

> Check `@/components/ui/Button`'s actual export and props before using it; if it differs, match the neighbouring settings panels rather than changing the component.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/hooks/useFormMessage.ts src/components/settings/FormMessageSettings.tsx
git commit -m "feat(form-message): the shared Message panel, with a live preview"
```

---

### Task 8: Mount the tab on the five settings pages

**Files:**
- Modify: `src/app/(dashboard)/request/accounting/settings/page.tsx`
- Modify: `src/app/(dashboard)/request/accounting/travel-booking-settings/page.tsx`
- Modify: `src/app/(dashboard)/request/reimburse/settings/page.tsx`
- Modify: AP-2's and AP-3's settings pages (find with `ls "src/app/(dashboard)/request/advance/settings" "src/app/(dashboard)/request/clear-advance/settings"`)

- [ ] **Step 1: AP-1**

Add `"messages"` to the local `TabKey` union, import `MessageSquare` from `lucide-react` and `FormMessageSettings`, and add to `TABS` between `vehicles` and `departments`:

```tsx
  { key: "messages", label: "Message", icon: <MessageSquare size={15} /> },
```

and in the panel switch:

```tsx
{tab === "messages" && (
  <FormMessageSettings endpoint="/api/request/accounting/settings/messages" formCode="AP-1" />
)}
```

- [ ] **Step 2: AP-17**

`TabKey` becomes `TravelOptionKind | "brands" | "access" | "per-diem" | "messages"`. Add `messages: <MessageSquare size={15} />` to `TAB_ICONS`.

**Here you DO touch `TABS`** — unlike the other four pages. `TABS` is
`GRANTABLE_BOOKING_TABS.map(...).concat([per-diem, access])`, and Task 5
deliberately left `GRANTABLE_BOOKING_TABS` alone, so `messages` has to join the
`.concat` — ahead of `per-diem`, to sit last among the configuration tabs:

```tsx
    .concat([
      { key: "messages", label: "Message", icon: TAB_ICONS.messages },
      { key: "per-diem", label: "เบี้ยเลี้ยงต่างประเทศ", icon: TAB_ICONS["per-diem"] },
      { key: "access", label: "สิทธิ์เข้าถึง", icon: TAB_ICONS.access },
    ]);
```

The comment above that `.concat` says neither of its entries may come from
`GRANTABLE_BOOKING_TABS`; extend it to name `messages` and why (the grant is
unstorable — ACC Portal rewrites `AccBookingApproverTab`).

Render the panel for `tab === "messages"` with endpoint `/api/request/travel-booking/settings/messages` and `formCode="AP-17"`.

- [ ] **Step 3: AP-4, AP-2, AP-3**

Same pattern on each page: an icon entry if that page keeps one, and a panel branch.

| page | endpoint | formCode | tab key |
|---|---|---|---|
| AP-4 | `/api/request/reimburse/settings/messages` | `AP-4` | `messages` |
| AP-2 | `/api/request/advance/settings/messages` | `AP-2` | `advanceMessages` |
| AP-3 | `/api/request/clear-advance/settings/messages` | `AP-3` | `clearMessages` |

> **Nothing extra is needed to hide the tab from a non-admin.** Every one of
> these pages already filters its visible tabs through its own
> `isGrantable*TabKey`, and `messages` is grantable nowhere — so an admin sees
> it and nobody else does, with no new condition to write. If you find yourself
> adding a role check to a page, stop: it means the key was wrongly added to a
> grantable list in Task 5.

- [ ] **Step 4: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add "src/app/(dashboard)/request"
git commit -m "feat(form-message): the Message tab on all five settings pages"
```

---

### Task 9: AP-1 — one notice box, four bullets

**Files:**
- Modify: `src/features/accounting/components/TravelExpenseForm.tsx`
- Modify: `src/features/accounting/constants.ts` (docblock only)

- [ ] **Step 1: Point the top box at the hook**

Replace the `AP1_HEADER_MESSAGE_LINES.map(...)` body of the `data-tour="ap1-notice"` block with the hook's blocks, and render nothing at all when there are none:

```tsx
const messageBlocks = useFormMessage(AP1_FORM_CODE);
```

```tsx
{messageBlocks.length > 0 && (
  <div
    data-tour="ap1-notice"
    className="rounded-2xl px-4 py-3.5 flex items-start gap-2.5"
    style={{
      background: "color-mix(in srgb, var(--color-action) 8%, var(--bg-card))",
      border: "1px solid color-mix(in srgb, var(--color-action) 25%, var(--border-card))",
    }}
  >
    <Info size={16} className="shrink-0 mt-0.5" style={{ color: "var(--color-action)" }} />
    <div className="flex flex-col gap-1">
      {messageBlocks.map((line, i) => (
        <p
          key={i}
          className="text-[12.5px] leading-relaxed m-0 whitespace-pre-line"
          style={{ color: "var(--text-secondary)" }}
        >
          {line}
        </p>
      ))}
    </div>
  </div>
)}
```

`whitespace-pre-line` is new and load-bearing: a block may now contain single newlines.

- [ ] **Step 2: Delete the footer block**

Remove the whole `{/* Footer notes */}` `<div>` — the one holding the four-string array and `ownerNotice`. Then remove the now-unused `const ownerNotice = useFormOwnerNotice(AP1_FORM_CODE);` and its import. Leave `AP1_HEADER_MESSAGE_LINES` imported only if still referenced; if not, drop it from the import list.

- [ ] **Step 3: Update the constant's docblock**

In `src/features/accounting/constants.ts`, above `AP1_HEADER_MESSAGE_LINES`, add:

```
 * **Since 2026-09-25 this is the FALLBACK, not what renders.** The live copy
 * is `Fast_Core.dbo.FormMessage` (migration 164), edited at Settings →
 * Message. This array is what the form shows when that table is missing — the
 * window before 164 is applied — so deleting it would make that window a blank
 * header rather than the one the form has always had.
 *
 * It is also 164's seed for the first three of AP-1's four bullets; the fourth
 * is the contact line that used to sit in a second box at the foot of the form,
 * carrying the `{เจ้าของฟอร์ม}` token.
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`, open `http://localhost:3081/request/travel-expense`.
Expected: **one** tinted box at the top with three bullets (the table is not applied yet, so this is the fallback), and **no** grey box at the foot of the travel-details card.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add src/features/accounting/components/TravelExpenseForm.tsx src/features/accounting/constants.ts
git commit -m "feat(ap-1): one notice box, and its copy comes from settings"
```

---

### Task 10: The other four forms read the hook

**Files:**
- Modify: `src/features/travel-booking/components/TravelBookingForm.tsx`
- Modify: `src/features/reimburse/components/ReimburseNotice.tsx`
- Modify: AP-2's and AP-3's form components

- [ ] **Step 1: AP-17**

Replace `AP17_HEADER_MESSAGE_LINES.map(...)` with `useFormMessage("AP-17")`, wrap the box in a `length > 0` guard, and add `whitespace-pre-line` to the `<p>`. Leave the constant in place as the fallback and add the same docblock note as Task 9 Step 3.

- [ ] **Step 2: AP-4**

In `ReimburseNotice.tsx`, replace `REIMBURSE_NOTICE.map(...)` with `useFormMessage("AP-4")` and render nothing when empty. **Its existing styling and paragraph structure do not change** — AP-4's blocks already contain newlines and that component already renders them; confirm it keeps a `whitespace-pre-line` (or equivalent) so they still break. Keep `REIMBURSE_NOTICE` imported nowhere it is no longer used, but do **not** delete the constant — `constants.test.ts` pins it and the service falls back to it.

- [ ] **Step 3: AP-2 and AP-3**

Neither form has a notice block today. Add one to each, in AP-1's exact shape (Task 9 Step 1's markup), with `useFormMessage("AP-2")` / `useFormMessage("AP-3")`. **Both render nothing on day one**, because migration 164 seeds neither and neither has a fallback constant — so these two forms are visually unchanged until somebody types something.

Place it directly above the first section card, where AP-1 and AP-17 put theirs.

- [ ] **Step 4: Verify each form still renders**

Run `npm run dev` and open all five forms. Expected: AP-1 and AP-17 show their fallback bullets, AP-4 shows its six paragraphs unchanged, AP-2 and AP-3 show no box.

- [ ] **Step 5: Typecheck, test, commit**

```bash
npm run typecheck && npm test
git add src/features
git commit -m "feat(form-message): all five forms read their notice from settings"
```

---

### Task 11: Verification and hand-off

- [ ] **Step 1: Full suite and typecheck**

```bash
npm run typecheck
npm test
```
Expected: both clean. Paste the real output — do not claim a pass without it.

- [ ] **Step 2: Confirm the migration number is still free**

```bash
git log --all --oneline --name-only -- 'migrations/164*'
ls migrations/ | grep '^164'
```
Expected: only this branch's `164_core_form_message.sql`. If another branch has taken 164, renumber this file to the next free number and update both seed tests' `readFileSync` paths.

- [ ] **Step 3: Ask the user before applying the migration**

Do **not** apply it unprompted. Show them the command and let them decide:

```bash
npm run apply-sql -- --db Fast_Core --file migrations/164_core_form_message.sql
```

- [ ] **Step 4: After applying — verify against the database, not the apply output**

`apply-sql` prints neither a migration's `PRINT` lines nor its closing `SELECT`, so "applied OK" is not evidence. Write a scratch script under the scratchpad directory that opens `getCorePool()` and reports:

- `dbo.FormMessage` exists, with `FormCode` as the primary key and no identity column;
- it holds exactly **three** rows — `AP-1`, `AP-17`, `AP-4` — and no `AP-2` or `AP-3`;
- `parseFormMessage` of the stored `AP-4` body deep-equals `REIMBURSE_NOTICE`.

- [ ] **Step 5: Confirm the alignment count did not move**

```bash
npm run check:alignment
```
Expected: **PASS at 30 tables.** 31 means the table was wrongly added to `MASTER_TABLES`.

- [ ] **Step 6: Update CLAUDE.md**

Add a section documenting: the table and why it is in `Fast_Core` with no identity column; the blank-line block rule and that AP-4 forces it; the `{เจ้าของฟอร์ม}` token and that deleting it deletes the contact line (a reversal of `form-owner-text.ts`'s "always renders" rule); the five routes and that `FORM_CODE` is pinned per route; the three fallback cases; and migration 164's deployment note (degrades rather than breaking, `check:alignment` stays 30).

**And the one a future reader is most likely to undo: why the Message tab is
admin-only.** Write it as a fact about ACC Portal, not as a judgement about
risk — a message grants nothing, and the tab is ungrantable purely because the
grant would be deleted by the sibling's next save
(`approver-settings-tabs.ts:47-56`, `booking-approver-tabs.ts:93-102`). Name the
remedy: adding the key to **both** applications in one change. This belongs
beside the existing AP-17 "one roster, one answer" note, which records the same
failure happening for real.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: the Message settings tab and Fast_Core.FormMessage"
```

---

## Self-Review

**Spec coverage** — §1 Task 9/10 · §2 Task 9 · §3 Task 2/3 · §4 Task 1 · §5 Task 1 · §6 Task 4 · §7 Task 6 · §8 Task 5 · §9 Task 5/8 · §10 Task 9/10 · §11 Task 7 · §12 Task 2 · §13 (exclusions — nothing to build) · §14 Tasks 1, 2, 3, 6 · §15 Task 11. No gaps.

**Type consistency** — `parseFormMessage`, `expandFormMessage`, `messageBodyProblem`, `FORM_OWNER_TOKEN`, `MAX_MESSAGE_CHARS`, `MAX_MESSAGE_BLOCKS`, `MAX_BLOCK_CHARS`, `listFormMessageBodies`, `getFormMessage`, `setFormMessage`, `FORM_MESSAGE_FALLBACK`, `resolveFormMessageBlocks`, `useFormMessage`, `FormMessageSettings` are spelled identically everywhere they appear.

**Known soft spots, called out rather than hidden**

- Task 6 Step 4.3 tells the executor to read `src/lib/adv/settings-route-gates.test.ts` before editing it — its entry shape was not confirmed while writing this plan.
- Task 8's AP-2/AP-3 page paths and Task 10's AP-2/AP-3 form components are named by description, not by exact path, for the same reason.
- Task 3 Step 2 carries a contingency: if `form-message.ts`'s pool import breaks the test at import time, the pure half moves into `form-message-text.ts`.
