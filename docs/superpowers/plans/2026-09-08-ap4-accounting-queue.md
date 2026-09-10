# AP-4 Accounting Queue Implementation Plan — stage 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give AP-4's accounting approvers a queue to work `(ManagerApproved, ACCOUNT)` claims from, with an editable payment date, a G/L account per line, and no Reject.

**Architecture:** Nothing structural is new. The step machine, the roster and the
approval service already exist and are not touched except where this plan says
so. What is added is a *place to stand*: two menu keys on the existing
`AccReimburseAccessTab` (no migration — that table has no CHECK on `TabKey`), a
read-only queue query over `AccRequest` + `AccReimburse`, a page, and a route.
The payment date's server rule is loosened from round-membership to a bounded
sanity check, and the round becomes the suggestion beside it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MSSQL via `mssql`,
SWR on the client, `node:test` via `npm test`.

**Spec:** `docs/superpowers/specs/2026-08-26-ap4-accounting-erp-design.md`
(§1 Decisions, §2 state machine, §3 Stage 1). **Read it alongside this plan.**

### Amendments to that spec, agreed 2026-09-08 — these WIN where they conflict

1. **The payment date is editable, not a round membership test.** The spec's
   §3.2 says "one payment date for the whole selection, from
   `getReimbursePaymentOptions`". It stays as the *suggested* value; the server
   rule changes. See Task 6 for the exact bound and why it is not unbounded.
2. **The G/L account picker is surfaced on this page** (Task 8). The spec does
   not mention it because it predates the request.
3. **Stage 3 (Interface ERP / PV number) and stage 4 (clearance) are OUT OF
   SCOPE.** Do not add `clearance` behaviour beyond storing its tick — the queue
   it would open does not exist yet. Stage 3 is blocked on the spec's own open
   item #1: whether Business Central returns the posted document number on the
   posting call has never been measured.
4. **Migration numbers in the spec are stale.** It says 122; that is taken. The
   highest on this branch is 143 and eleven numbers are already duplicated, so
   `ls migrations/` is the only way to pick one. **This stage needs no
   migration at all** — if you find yourself writing one, stop and re-read §7.
5. **`check:alignment` is 27 tables, not the spec's 25.** This stage must not
   move it.

## Global Constraints

- **`AccReimburseAccessTab` has no CHECK on `TabKey`** (migration 120:101). A row
  naming any string already stores fine. The code-side filter is therefore the
  only thing that makes an unknown key inert — do not add a constraint, and do
  not assume one.
- **Menu keys and settings-tab keys are two vocabularies and must not merge.**
  `isGrantableReimburseTabKey` must keep refusing a menu key, or a menu tick
  becomes a way past `requireReimburseSettingsTab` into the configuration
  routes. This is the exact split AP-17 documents in
  `booking-approver-tabs.ts`; copy the shape, including `filterStorable…`.
- **`AccReimburseAccessTab` is dual-written and in `MASTER_TABLES`.** Every write
  goes through `writeBothPools`. Never write it from a bare pool.
- **Membership grants nothing; the tick grants sight; the roster grants
  authority.** `AccReimburseApprover` decides who may approve, unchanged. A
  person with the tick and no approver row sees an empty queue and cannot act.
  That is correct and needs no special case (spec §3.3).
- **Every claim in `approval-engine.ts` (AP-1's) is pinned `FormCode =
  AP1_FORM_CODE`** because AP-4 parks at the same `(ManagerApproved, ACCOUNT)`
  tuple. Do not relax any of them. CLAUDE.md records that two reviews have
  already rediscovered this.
- **A route added under `/api/request/reimburse/**` inherits `AP-4` from
  `ROUTE_RULES`** automatically. Add no entry to `classify-path.ts`.
- **`npm test` discovers `src/**/*.test.ts`.** `scripts/` is not discovered.
- **`npm run typecheck` is `tsc --noEmit`. There is no lint script.**
- **Thai copy, English identifiers.** Match the register of the file you are in.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/acc/reimburse/settings-tabs.ts` *(modify)* | gains the **menu** vocabulary beside the existing settings-tab one, and `decideReimburseMenuAccess`. Still imports nothing. |
| `src/lib/acc/reimburse/settings-tabs.test.ts` *(modify)* | the two vocabularies stay disjoint; unknown keys inert |
| `src/lib/acc/reimburse/access-tabs.ts` *(modify)* | `filterStorableReimburseKeys` (tabs ∪ menus) on read **and** write; authorization keeps the narrow filter |
| `src/app/api/request/reimburse/access/route.ts` *(modify)* | answers `approvalQueue` and `clearance` booleans |
| `src/lib/acc/reimburse/queue-service.ts` *(create)* | `listReimburseAccountQueue` — the one query behind the page |
| `src/lib/acc/reimburse/queue-policy.ts` *(create)* | pure: which `(status, step)` tuple belongs in the queue, and the row shape |
| `src/lib/acc/reimburse/queue-policy.test.ts` *(create)* | the predicate, at every boundary |
| `src/app/api/request/reimburse/approvals/route.ts` *(create)* | `GET` the queue |
| `src/app/(dashboard)/request/reimburse/approvals/page.tsx` *(create)* | the page shell |
| `src/features/reimburse/ReimburseApprovalQueue.tsx` *(create)* | the queue UI: table, multi-select, date, approve, return |
| `src/lib/acc/reimburse/approval-policy.ts` *(modify)* | `paymentDateError` → `paymentDateProblem` with a bounded rule |
| `src/lib/acc/reimburse/approval-policy.test.ts` *(modify)* | the new bound, at its exact edges |
| `src/lib/acc/reimburse/approval-service.ts` *(modify)* | uses the new rule; `rejectReimburse` refuses a non-`MANAGER` step |
| `src/features/reimburse/components/settings/ReimburseAccessSettings.tsx` *(modify)* | two menu tick columns on the สิทธิ์เข้าถึง grid |

---

## Task 1: The menu vocabulary, kept apart from the settings one

**Files:**
- Modify: `src/lib/acc/reimburse/settings-tabs.ts`
- Test: `src/lib/acc/reimburse/settings-tabs.test.ts`

**Interfaces:**
- Produces: `REIMBURSE_MENU_KEYS`, `ReimburseMenuKey`, `REIMBURSE_MENUS`,
  `isReimburseMenuKey(key: string): boolean`,
  `filterReimburseMenuKeys(keys: string[]): string[]`,
  `filterStorableReimburseKeys(keys: string[]): string[]`,
  `decideReimburseMenuAccess(isAdmin: boolean, granted: string[], menu: string): boolean`

- [ ] **Step 1: Write the failing tests**

Append to `settings-tabs.test.ts`:

```ts
test("a menu key is not a grantable settings tab, and vice versa", () => {
  // The whole point of the split. A menu tick that satisfied
  // `isGrantableReimburseTabKey` would be a way past
  // `requireReimburseSettingsTab` into the configuration routes.
  for (const k of REIMBURSE_MENU_KEYS) {
    assert.equal(isGrantableReimburseTabKey(k), false, `${k} must not be a settings tab`);
  }
  for (const t of GRANTABLE_REIMBURSE_TABS) {
    assert.equal(isReimburseMenuKey(t.key), false, `${t.key} must not be a menu`);
  }
});

test("both vocabularies store, only the right one authorises", () => {
  const mixed = ["rules", "approvalQueue", "access", "nonsense"];
  // `access` is a real tab key but never grantable; `nonsense` is neither.
  assert.deepEqual(filterStorableReimburseKeys(mixed), ["rules", "approvalQueue"]);
  assert.deepEqual(filterGrantableReimburseTabKeys(mixed), ["rules"]);
  assert.deepEqual(filterReimburseMenuKeys(mixed), ["approvalQueue"]);
});

test("an admin sees every menu; a non-admin sees only what is ticked", () => {
  assert.equal(decideReimburseMenuAccess(true, [], "approvalQueue"), true);
  assert.equal(decideReimburseMenuAccess(true, [], "clearance"), true);
  assert.equal(decideReimburseMenuAccess(false, ["approvalQueue"], "approvalQueue"), true);
  assert.equal(decideReimburseMenuAccess(false, ["approvalQueue"], "clearance"), false);
  assert.equal(decideReimburseMenuAccess(false, [], "approvalQueue"), false);
});

test("an unknown menu key is inert even for an admin", () => {
  // The table has no CHECK, so a row naming any string can exist. An admin
  // passing every REAL menu must still not pass a made-up one, or a stray row
  // becomes a capability.
  assert.equal(decideReimburseMenuAccess(true, ["nonsense"], "nonsense"), false);
  assert.equal(decideReimburseMenuAccess(false, ["nonsense"], "nonsense"), false);
});

test("storable keys are de-duplicated and trimmed, in the caller's order", () => {
  assert.deepEqual(
    filterStorableReimburseKeys([" approvalQueue ", "rules", "approvalQueue"]),
    ["approvalQueue", "rules"],
  );
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- src/lib/acc/reimburse/settings-tabs.test.ts`
Expected: FAIL — `REIMBURSE_MENU_KEYS is not defined`.

- [ ] **Step 3: Implement**

Append to `settings-tabs.ts` (which must keep importing nothing):

```ts
/* ── the MENU vocabulary ──────────────────────────────────────────────────
 *
 * A second set of keys in the same `AccReimburseAccessTab.TabKey` column, and
 * keeping the two apart is the design rather than an accident of naming. A tab
 * key grants sight of a CONFIGURATION screen; a menu key grants sight of a
 * WORKING screen. `requireReimburseSettingsTab` gates the first, so a menu key
 * that satisfied `isGrantableReimburseTabKey` would be a way into the settings
 * routes — which is why that function must go on refusing these.
 *
 * No migration: migration 120 deliberately put no CHECK on `TabKey` (its own
 * header says so), which is what makes a second vocabulary possible without one
 * — and exactly what makes the code-side split load-bearing.
 *
 * AP-17 reached the same arrangement first; `booking-approver-tabs.ts` is the
 * shape being copied, including the storable-vs-grantable pair below.
 */
export const REIMBURSE_MENU_KEYS = ["approvalQueue", "clearance"] as const;

export type ReimburseMenuKey = (typeof REIMBURSE_MENU_KEYS)[number];

/**
 * The label each menu carries, as a `Record` for the same reason
 * `REIMBURSE_TAB_LABELS` is one: adding a key without copy is a typecheck
 * failure rather than a blank checkbox.
 */
const REIMBURSE_MENU_LABELS: Record<ReimburseMenuKey, string> = {
  approvalQueue: "คิวอนุมัติ (บัญชี)",
  clearance: "เคลียร์เอกสารอนุมัติ",
};

export const REIMBURSE_MENUS: readonly { key: ReimburseMenuKey; label: string }[] =
  REIMBURSE_MENU_KEYS.map((key) => ({ key, label: REIMBURSE_MENU_LABELS[key] }));

export function isReimburseMenuKey(key: string): boolean {
  const k = String(key).trim();
  for (const m of REIMBURSE_MENUS) if (m.key === k) return true;
  return false;
}

/** Keep only known MENU keys, trimmed, de-duplicated, in the caller's order. */
export function filterReimburseMenuKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if (isReimburseMenuKey(k) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/**
 * Everything that may be STORED in `AccReimburseAccessTab` — tabs ∪ menus.
 *
 * Storage takes the union; authorization keeps the narrow filters. Before AP-17
 * drew this distinction its menu ticks were dropped on read AND on write, so
 * ticking one saved nothing at all and the bug looked like a UI fault.
 */
export function filterStorableReimburseKeys(keys: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw).trim();
    if ((isGrantableReimburseTabKey(k) || isReimburseMenuKey(k)) && !seen[k]) {
      seen[k] = true;
      out.push(k);
    }
  }
  return out;
}

/**
 * May this caller open this AP-4 working screen?
 *
 * An admin passes every REAL menu and no made-up one. That asymmetry matters:
 * the table has no CHECK, so `decideReimburseMenuAccess(true, [], anything)`
 * returning true would turn a typo in a stray row into a capability.
 *
 * This answers SIGHT only. Whether the viewer may act on what they see comes
 * from `AccReimburseApprover`, checked inside the approval service where the
 * money moves — a person with the tick and no approver row gets an empty queue.
 */
export function decideReimburseMenuAccess(
  isAdmin: boolean,
  granted: string[],
  menu: string,
): boolean {
  const wanted = String(menu).trim();
  if (!isReimburseMenuKey(wanted)) return false;
  if (isAdmin) return true;
  return filterReimburseMenuKeys(granted).indexOf(wanted) !== -1;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- src/lib/acc/reimburse/settings-tabs.test.ts` → PASS
Run: `npm run typecheck` → clean

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/reimburse/settings-tabs.ts src/lib/acc/reimburse/settings-tabs.test.ts
git commit -m "feat(ap-4): a menu vocabulary beside the settings-tab one"
```

---

## Task 2: Store both vocabularies, and report the menus

**Files:**
- Modify: `src/lib/acc/reimburse/access-tabs.ts`
- Modify: `src/app/api/request/reimburse/access/route.ts`

**Interfaces:**
- Consumes: `filterStorableReimburseKeys`, `filterReimburseMenuKeys`,
  `decideReimburseMenuAccess` from Task 1.
- Produces: `/api/request/reimburse/access` responds
  `{ ok: true, data: { admin, settingsTabs, canSettings, menus, approvalQueue, clearance } }`
  where `menus: string[]` is the raw granted menu list and the two booleans are
  `decideReimburseMenuAccess`'s answers.

- [ ] **Step 1: Widen storage on BOTH sides**

In `access-tabs.ts`, replace **both** uses of `filterGrantableReimburseTabKeys`
with `filterStorableReimburseKeys`:

- in `loadReimburseTabsByAccessIds`, the final `map.set(...)` line;
- in `setReimburseAccessTabs`, the `const wanted = ...` line.

Change the import accordingly. **Both, or the feature silently does nothing** —
this is AP-17's recorded failure verbatim: filtered on read only, a stored menu
key is invisible; filtered on write only, it is never stored.

Add to that file's header docblock:

```ts
 * **Two vocabularies live in `TabKey`.** Settings tabs grant sight of
 * configuration; menu keys (`approvalQueue`, `clearance`) grant sight of a
 * working screen. Storage takes the union — `filterStorableReimburseKeys` — and
 * authorization keeps the narrow filters, in `settings-tabs.ts`. Narrowing the
 * filter here is what made AP-17's equivalent tick save nothing at all.
```

- [ ] **Step 2: Answer the menus from the endpoint**

In `access/route.ts`, after `const canSettings = ...`:

```ts
    // Sight of a working screen, which is a different question from sight of a
    // settings tab and is answered by a different filter. `granted` is the raw
    // stored list; `decideReimburseMenuAccess` is what decides, so an admin
    // gets both menus without a row and a stray key gets nobody anything.
    const menus = filterReimburseMenuKeys(granted);
    const approvalQueue = decideReimburseMenuAccess(admin, granted, "approvalQueue");
    const clearance = decideReimburseMenuAccess(admin, granted, "clearance");
```

`granted` is the unfiltered list `resolveReimburseTabsByEmail` returned;
`settingsTabs` becomes `filterGrantableReimburseTabKeys(granted)` so the existing
field keeps its exact meaning. Return all six fields.

Update that route's docblock — it currently says "`AccReimburseAccess` means
settings tabs and nothing else", which this task makes false.

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → clean. Run: `npm test` → 1263 pass (no count change).

- [ ] **Step 4: Commit**

```bash
git add src/lib/acc/reimburse/access-tabs.ts src/app/api/request/reimburse/access/route.ts
git commit -m "feat(ap-4): store menu ticks and report them from /access"
```

---

## Task 3: The two tick columns on the สิทธิ์เข้าถึง tab

**Files:**
- Modify: `src/features/reimburse/components/settings/ReimburseAccessSettings.tsx`
- Read for the tab strip: `src/app/(dashboard)/request/reimburse/settings/page.tsx`

**Interfaces:**
- Consumes: `REIMBURSE_MENUS` from Task 1.

- [ ] **Step 1: Render the menu columns beside the tab columns**

The grid currently maps `GRANTABLE_REIMBURSE_TABS` to checkbox columns. Add a
second group from `REIMBURSE_MENUS`, visually separated with a heading so an
admin can tell "may open the settings tab" from "may open the working screen".
Both groups post into the same `keys` array — storage is the union.

**Show the ticks on inactive rows too.** The existing code does this for tab
grants and the reason is in that file: hiding them leaves an admin unable to see
what a deactivated person still holds.

- [ ] **Step 2: Verify by hand**

`npm run dev`, open `/request/reimburse/settings?tab=access`, tick
`approvalQueue` for a non-admin, save, reload, confirm it persisted. **This is
the step that catches a one-sided filter from Task 2** — the tick will render
and vanish on reload if only one side was widened.

- [ ] **Step 3: Commit**

```bash
git add src/features/reimburse
git commit -m "feat(ap-4): tick which working screens a person may open"
```

---

## Task 4: The queue predicate, pure

**Files:**
- Create: `src/lib/acc/reimburse/queue-policy.ts`
- Test: `src/lib/acc/reimburse/queue-policy.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ReimburseQueueRow {
    id: number; requestNo: string; brandCode: string; requesterName: string;
    submittedAt: string | null; totalAmount: number; paymentDate: string | null;
    itemCount: number;
  }
  export function belongsInAccountQueue(status: string, stepCode: string | null): boolean
  ```

- [ ] **Step 1: Write the failing test**

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { belongsInAccountQueue } from "./queue-policy";

test("only (ManagerApproved, ACCOUNT) is in the accounting queue", () => {
  assert.equal(belongsInAccountQueue("ManagerApproved", "ACCOUNT"), true);
});

test("the SAME status at the final step is not", () => {
  // ACCOUNT and ACCOUNT_FINAL both sit at ManagerApproved and are told apart
  // ONLY by the step. A predicate on status alone would put every claim in both
  // queues, and the two-person rule would then be the only thing between one
  // person and both signatures.
  assert.equal(belongsInAccountQueue("ManagerApproved", "ACCOUNT_FINAL"), false);
});

test("every other state is out", () => {
  for (const [status, step] of [
    ["Draft", null], ["Submitted", "MANAGER"], ["Returned", null],
    ["Rejected", null], ["Cancelled", null], ["Approved", null],
    ["ManagerApproved", null],
  ] as const) {
    assert.equal(belongsInAccountQueue(status, step), false, `${status}/${step}`);
  }
});

test("an unknown status is out — an allow-list, not a deny-list", () => {
  // A status added later is far more likely to be another terminal state than
  // another queue-able one, and showing a claim in the wrong queue is the
  // expensive direction.
  assert.equal(belongsInAccountQueue("SomethingNew", "ACCOUNT"), false);
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npm test -- src/lib/acc/reimburse/queue-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Which claims the accounting queue shows.
 *
 * Pure and import-free so it is unit-tested with no database — `@/env`
 * validates the whole environment at import time, so anything reachable from a
 * pool drags a live configuration into the test run.
 *
 * The predicate is on the TUPLE, never on the status alone. `ACCOUNT` and
 * `ACCOUNT_FINAL` both sit at `ManagerApproved` (`STATUS_AT_STEP`,
 * `approval-policy.ts`), so a status-only test puts every claim in both queues.
 *
 * An allow-list: an unrecognised status is out. That is the fail-safe
 * direction, and the same choice `perDiemWritable` and
 * `perdiem-dependency.ts` made for the same reason.
 */
export function belongsInAccountQueue(status: string, stepCode: string | null): boolean {
  return status === "ManagerApproved" && stepCode === "ACCOUNT";
}

/** One row of the accounting queue, as the page renders it. */
export interface ReimburseQueueRow {
  id: number;
  requestNo: string;
  brandCode: string;
  requesterName: string;
  submittedAt: string | null;
  totalAmount: number;
  /** Null until the ACCOUNT step sets one — this queue is where that happens. */
  paymentDate: string | null;
  itemCount: number;
}
```

- [ ] **Step 4: Run the tests** → PASS. `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/reimburse/queue-policy.ts src/lib/acc/reimburse/queue-policy.test.ts
git commit -m "feat(ap-4): the accounting queue's predicate, pure and pinned"
```

---

## Task 5: The queue query, the route and the page

**Files:**
- Create: `src/lib/acc/reimburse/queue-service.ts`
- Create: `src/app/api/request/reimburse/approvals/route.ts`
- Create: `src/app/(dashboard)/request/reimburse/approvals/page.tsx`
- Create: `src/features/reimburse/ReimburseApprovalQueue.tsx`

**Interfaces:**
- Consumes: `ReimburseQueueRow`, `belongsInAccountQueue` (Task 4);
  `decideReimburseMenuAccess` (Task 1); `getReimbursePaymentOptions`
  (`approval-service.ts:123`).
- Produces: `listReimburseAccountQueue(): Promise<ReimburseQueueRow[]>`;
  `GET /api/request/reimburse/approvals` →
  `{ ok: true, data: { rows: ReimburseQueueRow[], paymentOptions: string[], suggested: string | null } }`

- [ ] **Step 1: The query**

`queue-service.ts` reads through `getAccPool()` — AP-4 resolves the UAT database
for a tester and that is correct here; this is transactional data, not
configuration. Join `AccRequest` to `AccReimburse` and count
`AccReimburseItem`. Filter **in SQL** on `FormCode = 'AP-4'`, `Status =
'ManagerApproved'` and `CurrentStepCode = 'ACCOUNT'`, and assert the same tuple
through `belongsInAccountQueue` when mapping each row, so the predicate has one
home even though SQL cannot call it.

`FormCode = 'AP-4'` is not optional: AP-1 parks at the identical tuple.

- [ ] **Step 2: The route**

```ts
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  // Sight of the screen. Authority to act on a row is re-decided per action by
  // the approval service against `AccReimburseApprover`, so a viewer with the
  // tick and no approver row gets rows they cannot action — which is what the
  // spec's §3.3 says should happen.
  const admin = isAdminRole(session.user.role);
  const granted = await resolveReimburseTabsByEmail(session.user.email ?? null);
  if (!decideReimburseMenuAccess(admin, granted, "approvalQueue")) {
    return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }
  …
}
```

- [ ] **Step 3: The page and the component**

The page is a thin server component rendering `<ReimburseApprovalQueue />`.
The component:
- SWR on `/api/request/reimburse/approvals`
- a checkbox per row and a select-all
- one payment date control for the whole selection, **defaulted to
  `suggested`** and editable (Task 6 is what makes an edited value acceptable)
- **Approve** posts each selected id to the existing
  `POST /api/request/reimburse/requests/[id]/approve`, in a loop, exactly as
  AP-17's bulk payout-date control does — every guard on that route is per
  request, so a bulk endpoint would have to re-implement all three and could
  only get them wrong
- **ส่งกลับแก้ไข** posts to the existing `.../return` route and requires a
  comment; the server enforces it through `returnCommentOrError`
- **No Reject button.** Task 7 makes that a rule rather than an omission.
- a 409 from any row refetches the queue rather than offering a retry — the
  round list and the claim's step both move underneath an open page

- [ ] **Step 4: Verify by hand**

`npm run dev`, sign in as an admin, open `/request/reimburse/approvals`.
With no `(ManagerApproved, ACCOUNT)` claim the page shows its empty state; with
one, approving it moves it to `ACCOUNT_FINAL` and it leaves the queue.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/reimburse/queue-service.ts src/app/api/request/reimburse/approvals src/app/\(dashboard\)/request/reimburse/approvals src/features/reimburse/ReimburseApprovalQueue.tsx
git commit -m "feat(ap-4): an accounting queue to work claims from"
```

---

## Task 6: The payment date becomes editable, within a bound

**Files:**
- Modify: `src/lib/acc/reimburse/approval-policy.ts`
- Modify: `src/lib/acc/reimburse/approval-service.ts:457-497`
- Test: `src/lib/acc/reimburse/approval-policy.test.ts`

**Interfaces:**
- Produces: `paymentDateProblem(raw: unknown, today: string): string | null`
  replacing `paymentDateError(raw, validDates)`.

**Why bounded rather than free.** The request was "ใส่เองได้ ยังไม่มีเงื่อนไข".
An unbounded date field on the path that writes `AccRequest.PaymentDate` accepts
a typo'd year silently, and nothing downstream would notice for ten years. The
bound below refuses only what no accountant means: it is a sanity check, not the
round rule. **The round rule is gone** — `PAYMENT_DATE_NOT_A_ROUND` and its
409 go with it, because there is no longer a round to miss.

**What does NOT change:** `REIMBURSE_NOTICE`'s promise of ศุกร์ที่ 1 และ 3, the
seeded `AccReimburseRule`, and the `AccReimburseRuleAck` rows that record a
requester agreeing to it. That rule is the payment POLICY and remains true;
accounting applies it and may deviate for cause, which is what an editable date
means. Do not touch that copy.

- [ ] **Step 1: Write the failing tests**

```ts
test("a real date inside the window is accepted", () => {
  assert.equal(paymentDateProblem("2026-09-18", "2026-09-08"), null);
  // A Wednesday. The round rule is gone: this is no longer a 1st/3rd Friday and
  // is now perfectly acceptable.
  assert.equal(paymentDateProblem("2026-09-16", "2026-09-08"), null);
});

test("the window's exact edges", () => {
  // One month back to the day, and twelve months forward to the day: both in.
  assert.equal(paymentDateProblem("2026-08-08", "2026-09-08"), null);
  assert.equal(paymentDateProblem("2027-09-08", "2026-09-08"), null);
  // One day beyond either edge: out.
  assert.equal(paymentDateProblem("2026-08-07", "2026-09-08"), PAYMENT_DATE_OUT_OF_RANGE);
  assert.equal(paymentDateProblem("2027-09-09", "2026-09-08"), PAYMENT_DATE_OUT_OF_RANGE);
});

test("a typo'd year is what the bound exists for", () => {
  assert.equal(paymentDateProblem("2036-09-18", "2026-09-08"), PAYMENT_DATE_OUT_OF_RANGE);
  assert.equal(paymentDateProblem("0226-09-18", "2026-09-08"), PAYMENT_DATE_OUT_OF_RANGE);
});

test("a missing or malformed date is still refused", () => {
  for (const bad of [null, undefined, "", "  ", "2026-9-8", "08/09/2026", "2026-02-30", 20260908]) {
    assert.equal(paymentDateProblem(bad, "2026-09-08"), PAYMENT_DATE_REQUIRED);
  }
});

test("the window is computed from the day passed in, never from the clock", () => {
  // The service passes the server's today. A function that read the clock could
  // not be tested at its own edges, which is the only place it can be wrong.
  assert.equal(paymentDateProblem("2026-01-15", "2026-01-01"), null);
  assert.equal(paymentDateProblem("2026-01-15", "2025-01-01"), PAYMENT_DATE_OUT_OF_RANGE);
});
```

- [ ] **Step 2: Run and watch them fail** — `paymentDateProblem is not defined`.

- [ ] **Step 3: Implement**

Replace `paymentDateError` with:

```ts
export const PAYMENT_DATE_OUT_OF_RANGE =
  "วันที่จ่ายต้องอยู่ระหว่าง 1 เดือนย้อนหลังถึง 12 เดือนข้างหน้า";

/**
 * What is wrong with a posted payment date, or `null` if nothing is.
 *
 * **This is a sanity bound, not the payment rule.** It replaced a membership
 * test against `getReimbursePaymentDates` on 2026-09-08: accounting picks the
 * date, and a claim that legitimately needs one off the 1st/3rd-Friday round —
 * an urgent payment, a corrected round — can have it without an admin editing
 * the database. The round is still computed and still shown, as the suggested
 * value beside the control.
 *
 * What it refuses is only what nobody means: a year typed wrong. Ten years out
 * is indistinguishable from a deliberate choice to anything downstream, and
 * this is the path that writes `AccRequest.PaymentDate`.
 *
 * `today` is a parameter rather than `new Date()` so the edges are testable —
 * the edges are the only place a window can be wrong. The caller passes the
 * server's day; the browser's is not consulted anywhere on this path.
 */
export function paymentDateProblem(raw: unknown, today: string): string | null {
  if (!isYmd(raw) || !isYmd(today)) return PAYMENT_DATE_REQUIRED;
  const [ty, tm, td] = today.split("-").map(Number);
  const min = ymdOf(new Date(ty, tm - 1 - 1, td));
  const max = ymdOf(new Date(ty + 1, tm - 1, td));
  return raw >= min && raw <= max ? null : PAYMENT_DATE_OUT_OF_RANGE;
}
```

`ymdOf(d: Date): string` formats with local getters — never `toISOString`, which
is UTC and would move the edge by a day for half of every Thai day. If the file
has no such helper, add one beside `isYmd` and note why.

In `approval-service.ts`, `approveReimburseAccountCheck` calls
`paymentDateProblem(paymentDate, todayYmd())` and throws a plain `Error` on any
problem — **delete the `AccConflictError` branch**. It existed because a round
could stop being offered while a dialog was open; nothing about a bounded date
goes stale that way, so 400 is now the honest status.

Keep the `getReimbursePaymentDates` call **only** where the suggestion is
computed (Task 5's route). Remove it from the approve path.

- [ ] **Step 4: Run** → PASS, `npm run typecheck` clean, `npm test` green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/acc/reimburse/approval-policy.ts src/lib/acc/reimburse/approval-policy.test.ts src/lib/acc/reimburse/approval-service.ts
git commit -m "feat(ap-4): accounting picks the payment date, within a sanity bound"
```

---

## Task 7: Reject is gone from both accounting steps, in the server

**Files:**
- Modify: `src/lib/acc/reimburse/approval-service.ts:581-608` (`rejectReimburse`)
- Test: `src/lib/acc/reimburse/approval-policy.test.ts`

- [ ] **Step 1: Write the failing test**

Add a pure predicate and test it:

```ts
test("only the manager may reject", () => {
  assert.equal(mayReject("MANAGER"), true);
  assert.equal(mayReject("ACCOUNT"), false);
  assert.equal(mayReject("ACCOUNT_FINAL"), false);
  assert.equal(mayReject(null), false);
});
```

- [ ] **Step 2: Implement**

```ts
/**
 * Rejecting ends a claim; both accounting steps keep only ส่งกลับแก้ไข.
 *
 * The decision is in the spec's §1 table. A control removed from a page is not
 * a rule, so this is checked in the service — `rejectReimburse` refuses a
 * non-MANAGER step before it claims anything.
 */
export function mayReject(stepCode: string | null): boolean {
  return stepCode === "MANAGER";
}
```

In `rejectReimburse`, before the claim, read the request's `CurrentStepCode` and
throw `new AccForbiddenError(...)` when `mayReject` is false.

- [ ] **Step 3: Run** → PASS. **Step 4: Commit**

```bash
git commit -am "feat(ap-4): only the manager may reject a claim"
```

---

## Task 8: The G/L account picker on the queue

**Files:**
- Modify: `src/features/reimburse/ReimburseApprovalQueue.tsx`
- Read first: `src/lib/acc/reimburse/expense-account-service.ts`,
  `src/app/api/request/reimburse/options/expense-accounts/route.ts`, and the
  existing `ExpenseAccountPicker` component

**This is surfacing existing machinery, not building it.** The reader already
proposes a G/L account per line and the server already validates it against the
Business Central mirror. The picker was hidden in August; this puts it where
accounting can correct a proposal.

- [ ] **Step 1: Render the lines with their accounts**

Expanding a queue row lists its `AccReimburseItem` rows with the current
`Category` value in an `ExpenseAccountPicker`.

**A historical value must render, not blank.** `AccReimburseItem.Category` is
`NVARCHAR(50)` and older rows hold free text such as `"AP-4.2"` rather than an
account number. `ExpenseAccountPicker` already handles this by rendering the raw
value; do not "fix" it into a blank.

- [ ] **Step 2: Save through the existing route** — no new endpoint. If none
  accepts a per-item account change from an approver, add one under
  `/api/request/reimburse/requests/[id]/items` gated by the same approver check
  the approve route uses, and say so in the commit.

- [ ] **Step 3: Verify by hand, then commit**

```bash
git commit -am "feat(ap-4): accounting can correct the proposed G/L account"
```

---

## Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md` (the AP-4 section)
- Modify: `docs/superpowers/specs/2026-08-26-ap4-accounting-erp-design.md`

- [ ] **Step 1: CLAUDE.md**

Add to the AP-4 section: the accounting queue and its route; the two menu keys
and that they share `TabKey` with the settings grants and are kept apart in
code; that the payment date is now accounting's to pick within a bound and that
the 1st/3rd-Friday rule survives as the suggestion and as policy; that Reject is
manager-only.

**Do not touch** the "AP-4 never reaches Business Central, deliberately"
paragraph. It is still true — stage 3 is what makes it false, and it is rewritten
there.

- [ ] **Step 2: The spec**

Front it with a dated amendment block naming the three 2026-09-08 changes
(editable payment date, the G/L picker, the stale migration number and alignment
count) and stating that stages 1 and 2 are being built while 3 and 4 wait on the
BC PV-number question. Do not rewrite its body; it is dated history and the
repo's convention is to front such a file rather than edit it.

- [ ] **Step 3: Commit**

```bash
git commit -am "docs(ap-4): the accounting queue, and the spec's 2026-09-08 amendments"
```

---

## Out of scope, recorded so nobody adds them

- **The Interface ERP queue and the PV number** (spec §5). Blocked on the spec's
  own open item #1.
- **The clearance queue** (spec §6). Its tick is stored by Task 1-3 and opens
  nothing yet; §6.3 says it must land after stage 3 or every approved claim
  parks with nothing able to advance it.
- **Per-AP-4 ERP settings** (spec §4). That is stage 2 and gets its own plan.
- **Any migration.** Spec §7: stage 1 needs none.
- **`AccReimburseItem.Category` → `ErpAccountNo`** (spec §5.2). It belongs to
  the stage that makes money post on its value.
- **Commissioning.** `AccReimburseApprover` was last measured empty and
  migration 092 seeded `AccFormBrand` with `ROCKS`, which is not one of the four
  brands `src/lib/brand.ts` knows. The queue will be empty until an admin fixes
  both, and that is a settings task, not a code one.
