# A Message settings tab — every form's notice copy becomes editable

Design, 2026-09-25. Approved by the user the same day.

Two requests, one change. The user asked for AP-1's two notice blocks to be
merged into one at the top of the form, with the form owner as its last bullet;
and for a **Message** tab in settings, after พาหนะ & เรท, on every form's own
settings page.

The second subsumes the first: once the copy comes from the database, "merge
the two blocks into these four bullets" is just the value that gets seeded.

---

## 1. What this replaces

Every form's notice copy is a hardcoded array in `src/features/*/constants.ts`:

| form | constant | blocks |
|---|---|---|
| AP-1 | `AP1_HEADER_MESSAGE_LINES` | 3 |
| AP-17 | `AP17_HEADER_MESSAGE_LINES` | 3 |
| AP-4 | `REIMBURSE_NOTICE` | 6 |
| AP-2 | — | none |
| AP-3 | — | none |

Changing a word is a deploy. The people who own the wording — accounting, HR,
the form owners migration 163 lets an admin name — cannot touch it.

**AP-1 additionally carries a second, separate block at the foot of the form**
(`TravelExpenseForm.tsx`, "Footer notes") holding four more lines, two of which
restate the top box in different words. That duplication is what the user saw
and asked to be collapsed.

---

## 2. Part 1 — AP-1's two blocks become one

The footer block is **deleted**. The top box becomes four bullets, which is the
value migration 164 seeds for AP-1:

```
รอบการเบิกจ่ายค่าเดินทาง — ตัดรอบวันจันทร์ (อนุมัติแล้ว) และจ่ายตามปฏิทินการชำระของบริษัท (ทุกศุกร์ที่ 2 และศุกร์ที่ 4 ของเดือน)

ถ้า ผจก. อนุมัติก่อนเที่ยง เข้ารอบจ่ายถัดไป · ตั้งแต่เที่ยงเป็นต้นไป ข้ามไปอีกหนึ่งรอบ

พนักงานออฟฟิศที่กลับบ้านเกิน 21.00 น. หรือมีชั่วโมงทำงานเกิน 8 ชั่วโมง เบิกค่าเดินทางกลับบ้านได้

กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม: {เจ้าของฟอร์ม}
```

The first three are `AP1_HEADER_MESSAGE_LINES` verbatim — the user's list is
word-for-word what the top box already says, so no existing wording changes.

**Three of the footer's four lines are dropped; the fourth — the owner line —
becomes bullet 4 above.** Two of the three cost nothing, being duplicates:

- `รอบการเบิกจ่ายค่าเดินทาง ตัดรอบวันจันทร์ (แบบฟอร์มที่ได้รับการอนุมัติแล้ว) …` —
  the same rule as bullet 1, worded differently.
- `สำหรับพนักงานออฟฟิศที่กลับบ้านเกิน 21.00 หรือ Working hour > 8h …` — the same
  rule as bullet 3, worded differently.

The third is a real loss and the user was told so:

- `หากติดวันหยุดจะเลื่อนการเบิกจ่ายเป็นวันทำการถัดไป` — not in the user's list.
  It is also **the only one of the four that describes something the code
  actually does**: `shiftPaymentDay` walks backward off a weekend or a
  `Rocks_Codex.Holiday`. Dropping it loses a true statement. It is recorded
  here because after this change anybody can put it back from the settings page
  without a deploy, which is why it was not worth arguing about.

`useFormOwnerNotice` stops being called by `TravelExpenseForm` — the owner
reaches that page through the token instead (§5).

---

## 3. Storage — `Fast_Core.dbo.FormMessage`, migration 164

One row per form:

```sql
CREATE TABLE [dbo].[FormMessage] (
  [FormCode]  NVARCHAR(20)   NOT NULL CONSTRAINT [PK_FormMessage] PRIMARY KEY,
  [BodyText]  NVARCHAR(MAX)  NOT NULL,
  [UpdatedBy] NVARCHAR(200)  NULL,
  [UpdatedAt] DATETIME2(7)   NOT NULL CONSTRAINT [DF_FormMessage_UpdatedAt] DEFAULT (SYSDATETIME())
);
```

It is migration 163's `FormOwner` one table over, and it is in `Fast_Core` for
reasons stronger than 163's own (CLAUDE.md records that `FormOwner` sits there
for "no reason stronger than that moving it would be a migration buying
nothing"):

- **There is no identity column at all.** `FormCode` is the key. So none of the
  dual-write identity-lockstep hazards CLAUDE.md spends three bullets on can
  apply, and the table is **not dual-written, not in `MASTER_TABLES`** —
  `npm run check:alignment` must still read **30** afterwards, and **31 means
  this was wrongly added to that list.**
- **One copy is the correct answer, not a convenience.** The notice is process
  copy: *"จ่ายทุกศุกร์ที่ 2 และ 4"* is the same sentence whether a request lands
  in `Rocks_Portal_Form` or `Rocks_Portal_Form_UAT`. A per-environment copy
  would be a way for the two to silently disagree, not a feature anybody wants.
- **The read is already being made.** `/api/form-environment` opens a
  `getCorePool()` and is fetched by every form page for its environment chip;
  since 163 it already carries `owners`. `message` rides on the same payload.
- **The token and the names arrive together.** `{เจ้าของฟอร์ม}` expands from the
  `owners` already on that payload — one fetch, no ordering problem between
  "the text" and "the names to substitute into it".

**`FormCode` is not foreign-keyed to `AccFormMaster`**, for 163's reason: that
table lives in `Rocks_Portal_Form` and this database cannot reference it.

**There is deliberately no change log**, unlike `ApiKeyLog`. `UpdatedBy` and
`UpdatedAt` answer "who last changed this, and when", which is the whole
requirement for display copy; a per-change history would be a second table for
a paragraph of Thai. If somebody later wants the history that is a new
decision, not a gap being filled.

### The alternative that was rejected

`AccFormMessage` dual-written into both form databases, consistent with the
other `Acc*` configuration tables. It buys that consistency and costs: a second
fetch per form page (or widening five different form-scoped endpoints), a
`MASTER_TABLES` entry at 30 → 31, an identity column whose two counters must
stay in lockstep, and a copy that can legitimately differ between PRO and UAT.
Every one of those is paid for a property — per-environment message copy — that
nobody asked for and that would be read as a bug if it ever appeared.

---

## 4. The body format — blocks separated by a BLANK LINE

**One blank line separates two bullets. A single newline stays inside the
bullet.** The body is a sequence of paragraphs, and a paragraph may be several
lines.

**AP-4 forces this, and it is the non-obvious part of the design.** The obvious
rule — one line, one bullet — is wrong here, because `REIMBURSE_NOTICE`'s six
elements each *contain* newlines:

```
"วิธีการเบิกค่าใช้จ่าย\n- ปริ้นใบสรุปค่าใช้จ่าย Excel เเละเเนบใบเสร็จ…\n- หากเป็นค่าบริการที่…"
```

Under a one-line-per-bullet rule those six compliance paragraphs become roughly
fifteen bullets, silently re-rendering a notice whose wording is under a
byte-identical test. Under the blank-line rule AP-4 round-trips exactly:
**measured 2026-09-25 — zero of the six elements contains a blank line
internally**, so no element can be split by this rule.

`parseFormMessage(body): string[]` is the pure, import-free half
(`src/lib/form-environment/form-message-text.ts`):

- normalise `\r\n` first, so a paste from Word behaves;
- split on two or more consecutive newlines;
- trim each block's **outer** whitespace only;
- drop empty blocks.

It is the **only** definition of what a bullet is, called by the five renderers
and by the settings editor's preview, so the preview cannot disagree with the
form.

### Bounds

Checked server-side by a pure function, so the refusal is testable without a
database:

| bound | value | why |
|---|---|---|
| body length | 5,000 chars | a form header, not a handbook |
| blocks | 20 | past this nobody reads it and the form is pushed off screen |
| one block | 1,000 chars | the longest `REIMBURSE_NOTICE` element is ~480 |

A body that fails any bound is a **400**, never a truncation: silently cutting a
compliance paragraph in half is worse than refusing the save.

**An empty body is legal and means "no notice".** That is AP-2's and AP-3's
state on day one, and it is how a form's box is turned off — the box is not
rendered at all when `parseFormMessage` returns `[]`, rather than rendered
empty.

---

## 5. The `{เจ้าของฟอร์ม}` token

The user chose a token in the text over a line the system always appends
(*"ใช้ token ในข้อความ"*), having been told the cost: **an admin who deletes the
token deletes the contact line, and nothing will put it back.**

That reverses the rule `form-owner-text.ts` states today — that the line "always
renders", falling back to the bare sentence — and it is recorded here as a
decision rather than left to be discovered.

`expandFormMessage(body, owners): string[]` sits beside `parseFormMessage` in
the same import-free module:

- `{เจ้าของฟอร์ม}` → `Kan Kanjanaporn Nabklang (kanjanaporn.n@rocksgroup.com)`,
  comma-joined for several owners, through `formatFormOwner` from
  `form-owner-text.ts` — **imported, not re-spelled**, so one form cannot print
  an owner differently from another.
- **With no owners the token expands to empty AND a trailing `:` or `·` on that
  block is trimmed**, so the bullet degrades to the bare sentence
  `กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม` — exactly what every form prints today
  before an admin names anybody. Without the trim it would read
  `กรณีต้องการยกเลิกติดต่อเจ้าของฟอร์ม:` with a dangling colon on every form on
  the day 164 lands, since 163 seeds no owners.
- A block that is **nothing but** the token, with no owners, becomes empty and
  is dropped.
- The token may appear more than once; every occurrence expands.
- Everything else is literal. A typo — `{เจ้าของform}` — renders as itself,
  which the editor's live preview makes visible immediately. There is
  deliberately no fuzzy matching: a token vocabulary that guesses is one that
  expands something an admin meant literally.

**`FORM_OWNER_FALLBACK` and `formatFormOwner` do not change**, and neither does
`FormOwnerNotice` / `useFormOwnerNotice` — AP-17, AP-4, AP-2 and AP-3 still use
the component, and this design does not take it from them. AP-1 stops calling it
because its owner line moves into the message body. Whether the other four
eventually move their contact line into their own body is a later decision; both
mechanisms working side by side is fine, because the token is opt-in per form.

---

## 6. Reading — on `/api/form-environment`

`FormAccess` gains one field:

```ts
/**
 * The form's notice copy, already split into blocks and with
 * `{เจ้าของฟอร์ม}` expanded against this form's own `owners`.
 *
 * `[]` means "no notice configured", which is a fact; a client can tell it
 * from a payload that failed to load, exactly as `owners` can.
 */
message: string[];
```

**Expanded server-side**, not on the client, for one reason: the owners are
already in hand there, so the five renderers receive a plain `string[]` and
share no logic beyond it. A client-side expansion would put the token rule in
the bundle five times, or in a shared hook every form must remember to call.

`listFormMessages()` mirrors `listFormOwners()` exactly, including **swallowing
a missing table and nothing else**:

```ts
function isMissingTable(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /Invalid object name/i.test(m) && /FormMessage/i.test(m);
}
```

So the window before 164 is applied costs the database-backed copy and not the
page; a dead pool or a permission problem still throws, because silently
printing "no notice" over a `Fast_Core` outage hides the outage without helping
anybody.

### Fallback when the table is missing

A form having no row is **not** the same as that form having an empty message.
The distinction is drawn in the service, not at the render site:

- the table is missing ⇒ every form falls back to its hardcoded constant;
- the table is there and the form has no row ⇒ the constant, because 164 seeds
  every form that has one and a missing row means somebody deleted it;
- the row exists with an empty body ⇒ **`[]`, no box.** An admin who clears the
  message means it.

The constants therefore stay in `src/features/*/constants.ts` as the fallback,
and `FORM_MESSAGE_FALLBACK: Record<string, readonly string[]>` in the service
maps a form code to one. AP-2 and AP-3 have no entry, which is correct: they
have no notice to fall back to.

---

## 7. Writing — five routes, one service, form code pinned by the route

| form | route | gate |
|---|---|---|
| AP-1 | `/api/request/accounting/settings/messages` | `requireSettingsTab("messages")` |
| AP-17 | `/api/request/travel-booking/settings/messages` | `requireBookingSettingsTab("messages")` |
| AP-4 | `/api/request/reimburse/settings/messages` | `requireReimburseSettingsTab("messages")` |
| AP-2 | `/api/request/advance/settings/messages` | `requireAdvClrSettingsTab("advanceMessages")` |
| AP-3 | `/api/request/clear-advance/settings/messages` | `requireAdvClrSettingsTab("clearMessages")` |

All five call one `setFormMessage(formCode, body, actorEmail)`.

**The `formCode` is a literal in each route file and is never read from the
posted body.** A grant is per form, so a posted form code would let somebody
holding AP-2's tab rewrite AP-1's notice. Same rule `requireSettingsTab`'s own
docblock states for the tab key: *which form a route governs is a property of
the route.*

**AP-2 and AP-3 need two keys, not one shared `messages`**, for the reason
`settings-tabs.ts` already records for `advanceErpInterface` /
`clearErpInterface`: one key on both strips is owned by both forms, and
`setAdvClrAccessTabs`' bounded `DELETE` rests on `storableAdvClrKeysForForm`
being **disjoint**. A shared tickable key would make a save from AP-2's grid
clear AP-3's grant. It is also the truer statement — two tabs editing two rows.

**`SETTINGS_ROUTE_TABS` gains a `{ route: "messages", tab: "messages" }` entry.**
`settings-tabs.test.ts` walks the route tree and fails on any settings route
with no entry, so this is enforced rather than remembered.

**No `ROUTE_RULES` entry is needed for any of the five.** The prefixes
`/api/request/accounting`, `/api/request/travel-booking`,
`/api/request/reimburse`, `/api/request/advance` and `/api/request/clear-advance`
are all already classified — and in any case these routes read and write
`Fast_Core` through `getCorePool()`, so which form database resolves is
irrelevant to them. That is a side benefit of §3's storage choice worth naming:
AP-1's and AP-2's settings prefixes are pinned to `null` (Production) precisely
so a config-row id is not read as an `AccRequest` id, and a `Fast_Core` table
sidesteps the question entirely.

---

## 8. Permissions — grantable on all five

`messages` is a grantable settings-tab key on every form:

| form | vocabulary | key |
|---|---|---|
| AP-1 | `GrantableSettingsTabKey` | `messages` |
| AP-17 | `GrantableBookingTabKey` | `messages` |
| AP-4 | `REIMBURSE_SETTINGS_TAB_ORDER` | `messages` |
| AP-2 | `ADVANCE_SETTINGS_TAB_ORDER` | `advanceMessages` |
| AP-3 | `CLEAR_SETTINGS_TAB_ORDER` | `clearMessages` |

**A message grants nothing.** It decides no approval, no posting target, no
brand scope and no read — it is text on a page. That makes it the *least*
consequential grant in this application, well below `erpInterface`, which the
user opened to grants on 2026-09-22 knowing it sets any brand's bank account.
So it carries **no `note`** under the grid; there is nothing to warn about.

`access` remains the only ungrantable tab everywhere, unchanged. AP-17's
`per-diem` also stays off `GRANTABLE_BOOKING_TABS`, unchanged.

Admins pass as they always have, through each guard's existing `isAdminRole` arm.

**What it does reach, stated plainly:** a grant holder can change what every
requester of that form reads before filing, including deleting a compliance
notice or the contact line. That is a real capability and it is the point of the
feature. It is bounded to one form, recorded in `UpdatedBy` / `UpdatedAt`, and
reversible from the same screen.

---

## 9. Tab placement

AP-1, per the user: **after พาหนะ & เรท.**

```
แบรนด์ที่เบิก · เบิกวันซ้ำข้ามแบรนด์ · พาหนะ & เรท · Message · แผนก (HR ↔ ERP) · Interface ERP · สิทธิ์เข้าถึง
```

The other four take the analogous position — after the last tab that configures
the *form's own* options, before the ERP/posting tabs, and always before
`access`, which stays last everywhere:

| form | strip |
|---|---|
| AP-17 | brands · reasons · accommodations · vehicles · rent-vehicles · **messages** · per-diem · access |
| AP-4 | brands · rules · **messages** · glAccounts · buGlMap · erpInterface · access |
| AP-2 | brands · matrix · banks · **advanceMessages** · advanceErpInterface · access |
| AP-3 | glAccounts · buGlMap · locations · **clearMessages** · clearErpInterface · access |

AP-17's strip is built by `GRANTABLE_BOOKING_TABS.map(...).concat([per-diem,
access])`, so adding `messages` to `BOOKING_TAB_ORDER` lands it in exactly that
position with no edit to the page.

The label is **`Message`**, in English, because that is the word the user used
and because every other label being Thai makes it findable rather than
inconsistent. The icon is `MessageSquare` from `lucide-react`.

`ICON_MAP` in the settings hub is hand-kept, but these are per-form tab strips
and do not touch it.

---

## 10. Rendering — each form keeps its own block

The five forms print notices differently and this design does not unify them:
AP-1 renders an `Info`-iconed tinted box, AP-17 the same shape, AP-4's
`ReimburseNotice` renders its own styled paragraphs. Each keeps its own
component; what changes is only where the strings come from.

A shared `useFormMessage(formCode): string[]` hook reads `useFormEnvironments()`
— the same SWR key every form page already shares — and falls back to the
constant. `FormOwnerNotice`'s own hook is the model.

**AP-2 and AP-3 gain a notice box** they do not have today, rendered in AP-1's
shape and **not rendered at all while their message is empty**, which it is on
day one. So nothing about those two forms changes visually until somebody types
something.

---

## 11. The settings editor

One shared component, `FormMessageSettings`, parameterised by `endpoint` and
`formCode` — the shape `BuGlAccountSettings` and `BrandToggleCard` already use
for "one screen, several forms".

- a `<textarea>` holding the raw body;
- **a live preview beneath it**, rendered through the same `parseFormMessage` +
  `expandFormMessage` the form uses, against that form's real owners. This is
  not decoration: it is the only thing that makes the blank-line rule and a
  mistyped token visible before saving;
- a one-line hint naming the token and the blank-line rule;
- character and block counters that turn red at the §4 bounds, with Save
  disabled — the server still refuses, because a control removed from a page is
  not a rule;
- `UpdatedBy` / `UpdatedAt` printed under the Save button, so "who changed
  this?" is answerable on the screen where it is changed.

---

## 12. Seeding — day one is identical

Migration 164 seeds, idempotently (`WHERE NOT EXISTS`, so a re-run never
overwrites an edit):

| form | seeded from |
|---|---|
| AP-1 | the four bullets in §2 |
| AP-17 | `AP17_HEADER_MESSAGE_LINES`, blank-line joined |
| AP-4 | `REIMBURSE_NOTICE`, blank-line joined, **byte-identical within each block** |
| AP-2, AP-3 | nothing |

**AP-4's seed is the delicate one.** `constants.test.ts` asserts
`REIMBURSE_NOTICE` is byte-identical to
`.superpowers/sdd/2026-08-19-ap-4-staff-reimbursement/notice-source-text.md` and
has exactly 6 entries. That test does not move — the constant stays, and stays
pinned — but a **second** test is added asserting that migration 164's seed
`parseFormMessage`s back to exactly `REIMBURSE_NOTICE`. Without it the
compliance copy could be corrupted by the seed while the old test stayed green,
because the old test never reads the migration.

The `**` markers, the double space in the first parenthetical and the leading
space on the fourth block's second line are all part of that source text and
survive the round trip: `parseFormMessage` trims each block's outer whitespace
only, and no block begins or ends with a significant space.

---

## 13. What is NOT in this

- **No rich text, no HTML, no Markdown.** The body renders as text. React
  escapes it, so there is no injection surface, and a settings grant does not
  become a way to put a link or a script on every requester's screen.
- **No per-brand and no per-environment message.** One row per form.
- **No change log table.** §3.
- **No token beyond `{เจ้าของฟอร์ม}`.** A `{แบรนด์}` or `{ชื่อผู้ขอ}` is a
  different feature — those vary per request, while this payload is per form and
  shared by every viewer.
- **AP-17, AP-4, AP-2 and AP-3 keep `FormOwnerNotice` as-is.** Only AP-1's
  contact line moves into the message body, because only AP-1 was asked about.
- **The constants are not deleted.** They are the fallback for a missing table;
  deleting them would make the window before 164 is applied a blank form header
  instead of the one it has today.

---

## 14. Testing

Pure and unit-testable, no database:

- `form-message-text.test.ts` — `parseFormMessage`: blank-line splitting,
  `\r\n`, leading and trailing blank lines, a body that is only whitespace,
  three-or-more newlines, single newlines preserved inside a block.
  `expandFormMessage`: one owner, several owners, no owners plus the
  trailing-colon trim, a block that is only the token, the token twice, a
  mistyped token left literal.
- `form-message-bounds.test.ts` — each bound at and either side of its limit.
- `constants.test.ts` (AP-4) — the existing byte-identical test, plus the new
  round-trip of migration 164's seed.
- `settings-tabs.test.ts` — already walks the route tree; the five new routes
  need their `SETTINGS_ROUTE_TABS` entries or it fails. AP-2/AP-3's
  disjointness assertion already exists and covers the two new keys.
- `form-message-route-guard.test.ts` — source-shape, because these routes reach
  a pool and `@/env` validates the whole environment at import. It pins that
  each route passes **its own** form code (all five are strings, so handing
  AP-4's route `"AP-1"` compiles and silently edits the wrong form's copy) and
  **its own** tab key, and that the gate's refusal is returned rather than
  computed and dropped. The tactic `require-booking-menu-guard.test.ts` uses.

**Not covered by anything here:** that the seeded Thai reads correctly on the
rendered page. That needs a person opening AP-1 after 164 is applied.

---

## 15. Deployment

**Migration 164 is `Fast_Core` only, and the code may ship before or after it.**

Unlike 090 / 120 / 144 / 156 / 158, a missing table here is **degradation, not
an outage**: `listFormMessages` swallows `Invalid object name` and every form
falls back to the constant it renders today. That is the same property migration
163 has, and it is why this can be deployed in either order — worth knowing
which case you are in, because most of this repo's recent migrations are the
other kind.

Two things to do after applying:

1. **Verify against the database, not the apply script's output.** `apply-sql`
   prints neither a migration's `PRINT` lines nor its closing `SELECT`, so
   "applied OK" is not evidence. Check `dbo.FormMessage` exists and holds
   **three** rows — AP-1, AP-17, AP-4 — and that AP-2 and AP-3 have none.
2. **`npm run check:alignment` must still report 30.** 31 means the table was
   wrongly added to `MASTER_TABLES`.

**164 is free across every branch**, checked 2026-09-25 with
`git log --all -- 'migrations/16*'`: master holds 159–163 and no other branch
carries a 164. Re-check before applying — eleven numbers in this repo already
exist twice because two branches picked the same one.

**Reverting the code after 164 has run is safe.** The old build does not know
the table and never reads it; the forms return to their constants, which the new
build never removed.
