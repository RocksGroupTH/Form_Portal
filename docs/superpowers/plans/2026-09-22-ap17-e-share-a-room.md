# AP-17 package E — พักห้องเดียวกับ

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A requester can attach their AP-17 request to a colleague's, sharing that colleague's room — booking nothing themselves, still drawing per diem, and following the host's cancellation and date changes automatically.

**Architecture:** One transactional table binding guest→host; two pure modules owning the policy and the cascade; the cascade runs inside the host's own transaction at the three sites that already give per diem back.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (ES5 target), MSSQL via `mssql`, `node:test` + `node:assert/strict` through `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-21-ap17-e-share-a-room.md` — read it in full before Task 1, including §2's table of four user decisions and what each gives up. Where plan and spec disagree, the spec wins and you report the disagreement.

## Global Constraints

- **This is the first place in this application where one person's request is bound to another's, and where one request's fate moves another's with nobody acting on the second.** Nothing here is routine CRUD. Every task that touches the cascade is touching money that may already have been paid.
- **The migration number is `156`.** `ls migrations/` stops at 152 on this branch; 153 is taken on the unmerged `feat/all-requests-report` branch, 154 by package C, and 155 by the AccTravelPerDiemCountry id realign. CLAUDE.md records eleven already-duplicated numbers — do not add more.
- **`AccTravelRoomShare` is transactional**, so it follows migration 061/064's rule: an identity floor of 900000 in `Rocks_Portal_Form_UAT` and the matching `CHECK`. Its two FKs point at `AccRequest.Id`, which is exactly the id space those migrations protect.
- **It is NOT dual-written and NOT in `MASTER_TABLES`.** `npm run check:alignment` must still read **30**; 31 means it was wrongly added to the shared list.
- **The migration goes to BOTH form databases before the code deploys** — compile-time name binding means a missing table is `Invalid object name`, not an empty result.
- **`@/env` validates the whole environment at import time.** Anything reachable from a DB pool throws on import in a test. Hence the two pure modules: the cascade's *decisions* are unit-tested directly, and only the wiring gets a source-reading guard.
- **ES5 target:** `Array.from()`, never spread over a Set or Map.
- **Thai wall-clock dates, local getters only.** Never slice `YYYY-MM-DD` off an ISO string.
- **Parameterized SQL only.** `getAccPool()` is `getFormPool()`; production-only tables must never be read through it.
- **Never delete or reword an existing explanatory comment** unless the change it describes is the change you are making.
- **Out of scope, recorded so it is not mistaken for an omission:** any host approval or consent flow (declined); splitting a room's cost (no money moves between the two requests); restricting how *many* guests attach to one host (only depth is restricted); backfilling.

## The fact most likely to send you hunting

**There are four public cancellation/rejection paths but only THREE places to hook the cascade.** Measured in `src/lib/acc/travel-booking/approval.ts`:

| public function | line | reaches the per-diem give-back via |
|---|---|---|
| `rejectRequest` | 280 | its own `recomputeAfterDeath(tx, …)` at **:307** |
| `rejectByAdmin` | 451 | `transitionFromStage` → **:418** |
| `rejectByAccount` | 617 | `transitionFromStage` → **:418** |
| `cancelByRequester` | 474 | its own `recomputeAfterDeath(tx, …)` at **:499** |

`transitionFromStage` (defined :378) calls `recomputeAfterDeath` when `target.status === "Rejected"`, which is what serves the middle two. So hooking three sites covers all four paths — **do not go looking for a fourth call site, and do not add one to `rejectByAccount` on the belief that it is missing.**

`recomputeAfterDeath` (:143) is the existing shared helper, and it is the natural place for the cancel cascade: it already runs inside the caller's transaction, already reads the dying request inside it, and already skips silently on a null group key.

## File Structure

| file | responsibility |
|---|---|
| `migrations/156_acc_travel_room_share.sql` | the table, both form databases |
| `migrations/157_uat_room_share_identity.sql` | UAT identity floor + `CHECK` (see Task 1 on why it may be one file or two) |
| `src/lib/acc/travel-booking/room-share-policy.ts` | may this request host? may this one be a guest? chain or cycle? |
| `src/lib/acc/travel-booking/room-share-cascade.ts` | given a host's change and its guests' states, what happens to each |
| `src/lib/acc/travel-booking/room-share-service.ts` | the pool half — attach, detach, load guests, load hostable requests |
| `src/app/api/request/travel-booking/room-share/...` | attach/detach + the host-listing endpoint |
| `src/lib/acc/travel-booking/approval.ts` | the cascade, at the three sites above |
| `src/lib/acc/travel-booking/room-share-cascade-guard.test.ts` | that all three sites call it, inside their transaction |
| `src/features/travel-booking/components/...` | the พักห้องเดียวกับ control and picker |
| `CLAUDE.md` | the feature, and the three costs the user accepted |

---

### Task 1: the table

**Files:**
- Create: `migrations/156_acc_travel_room_share.sql`
- Create (or fold into 156 — see Step 2): `migrations/157_uat_room_share_identity.sql`

**Interfaces:**
- Produces: `AccTravelRoomShare(Id, GuestRequestId, HostRequestId, HostStaffId, CreatedAt, CreatedBy)`.

- [ ] **Step 1: Read two precedents first**

`migrations/144_acc_reimburse_approver_brand.sql` for a both-databases table, and `migrations/061`/`064` for how a transactional table gets its UAT identity floor and `CHECK`. Match the house header: target database, ordering against the deploy, what `check:alignment` must read.

- [ ] **Step 2: Decide one file or two, and say why**

061 and 064 are `_UAT`-only and refuse a database whose name does not end in `_UAT`; 156 must run against **both**. A single file cannot carry both guards honestly. **Split them** unless you find a cleaner precedent in the repo — and if you do split, 157's header must say it is `_UAT` only and runs after 156. Report which you chose.

- [ ] **Step 3: The table**

```sql
CREATE TABLE [dbo].[AccTravelRoomShare] (
  [Id]             INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccTravelRoomShare] PRIMARY KEY,
  [GuestRequestId] INT NOT NULL CONSTRAINT [FK_AccTravelRoomShare_Guest] REFERENCES [dbo].[AccRequest]([Id]),
  [HostRequestId]  INT NOT NULL CONSTRAINT [FK_AccTravelRoomShare_Host]  REFERENCES [dbo].[AccRequest]([Id]),
  [HostStaffId]    INT NULL,
  [CreatedAt]      DATETIME2 NOT NULL CONSTRAINT [DF_AccTravelRoomShare_CreatedAt] DEFAULT (SYSDATETIME()),
  [CreatedBy]      INT NULL
);
CREATE UNIQUE INDEX [UQ_AccTravelRoomShare_Guest] ON [dbo].[AccTravelRoomShare]([GuestRequestId]);
CREATE INDEX [IX_AccTravelRoomShare_Host] ON [dbo].[AccTravelRoomShare]([HostRequestId]);
```

Three things the header must explain rather than leave to be inferred:

- **`UQ_AccTravelRoomShare_Guest` is the rule "a guest has at most one host"**, and it is what stops a half-finished change of mind leaving two rows.
- **`IX_AccTravelRoomShare_Host` is not decoration** — the cascade looks guests up by host on every cancellation, inside a transaction holding locks.
- **`HostStaffId` is denormalised for display only. The identity of the host is `HostRequestId`.** A reader who joins on `HostStaffId` gets the wrong answer the moment somebody files on behalf of somebody else.

- [ ] **Step 4: Do NOT apply it.** Applying against live databases is the user's call. Say in your report that it is unapplied.

- [ ] **Step 5: Commit**

```bash
git add migrations/156_acc_travel_room_share.sql migrations/157_uat_room_share_identity.sql
git commit -m "feat(ap-17): AccTravelRoomShare, the guest-to-host binding"
```

---

### Task 2: `room-share-policy.ts` — who may host, who may be a guest

**Files:**
- Create: `src/lib/acc/travel-booking/room-share-policy.ts`
- Create: `src/lib/acc/travel-booking/room-share-policy.test.ts`

**Interfaces:**
- Consumes: nothing. **This module imports nothing** — that is what makes it testable, and it is the same discipline `date-overlap.ts` and `perdiem-dependency.ts` already keep.
- Produces:

```typescript
export interface ShareCandidate {
  requestId: number;
  requestNo: string | null;
  status: string;
  /** Derived from the option rows, never posted — see `derive-flags.ts`. */
  needsRoomBooking: boolean;
  /** True when this request is itself already a guest of someone. */
  isGuest: boolean;
  /** The request it hosts for, if any — used for the cycle test. */
  hostsFor: number[];
}

export type ShareRefusal = { code: string; message: string };

export function canHost(candidate: ShareCandidate): ShareRefusal | null;
export function canAttach(guest: ShareCandidate, host: ShareCandidate): ShareRefusal | null;
```

- [ ] **Step 1: Write the failing tests**

Every refusal carries a **Thai** message naming the specific reason — this is a requester-facing control and "cannot attach" is not an answer. Cases:

- a live host with `needsRoomBooking: true` and no existing host → `canHost` returns null;
- a host with `needsRoomBooking: false` is refused — *attaching to somebody who booked no room gives the guest neither a bed nor a defensible per-diem claim* (spec §6);
- a `Cancelled` host is refused; a `Rejected` host is refused;
- **a host that is itself a guest is refused — chains are one hop only** (spec §3), and the message must name the request that is already a guest;
- **a cycle is refused**: A hosting B while B hosts A would make cancellation non-terminating;
- a guest attaching to itself is refused;
- a guest that already has a host is refused (the unique index is the backstop, not the message).

The **alive** test must match the one `continuation-chain.ts` uses. Read it and reuse the same set rather than inventing a second — "which statuses count as alive" is already in six places in this feature and a seventh that disagrees is the bug.

- [ ] **Step 2: Run them and watch them fail.** Confirm the file loads.

- [ ] **Step 3: Implement.** Pure functions, no imports, every refusal a named code plus Thai copy.

- [ ] **Step 4: Run them and watch them pass**, then the full `npm test`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ap-17): room-share policy — who may host, who may attach"
```

---

### Task 3: `room-share-cascade.ts` — what happens to each guest

**Files:**
- Create: `src/lib/acc/travel-booking/room-share-cascade.ts`
- Create: `src/lib/acc/travel-booking/room-share-cascade.test.ts`

**Interfaces:**
- Consumes: nothing — **imports nothing.**
- Produces:

```typescript
export interface GuestState {
  requestId: number;
  requestNo: string | null;
  status: string;
  departDate: string;   // YYYY-MM-DD
  returnDate: string;
}

export type GuestAction =
  | { kind: "cancel"; requestId: number; previousStatus: string; wasCompleted: boolean }
  | { kind: "redate"; requestId: number; from: { depart: string; return: string }; to: { depart: string; return: string } }
  | { kind: "skip"; requestId: number; reason: string };

export function cascadeForHostDeath(guests: readonly GuestState[]): GuestAction[];
export function cascadeForHostDates(
  guests: readonly GuestState[],
  hostDates: { depart: string; return: string },
): GuestAction[];
```

- [ ] **Step 1: Write the failing tests**

The spec's §7 names the cases that must exist, and each one is there because it is a decision rather than an edge:

- **a guest at each status, including `Completed`** — a `Completed` guest whose per diem has been paid **is still cancelled**. This is the direction `perdiem-window.ts` exists to prevent, and the user chose it knowingly (spec §2). `wasCompleted` exists so the caller can mail accounting;
- **an already-`Cancelled` or `Rejected` guest is skipped, not re-cancelled**, with a reason;
- a host with no guests → empty array, not a throw;
- a date change where a guest's dates already match → `skip`, not a no-op `redate` that writes a pointless activity row;
- a date change producing an overlap in the guest's own calendar → **still a `redate`**. Spec §4: the guest did not choose it, and blocking the host's change because of a collision in someone else's calendar would be worse. **This must not be an error** — assert that explicitly, because the obvious instinct is to refuse it.

- [ ] **Step 2: Run them and watch them fail.**

- [ ] **Step 3: Implement.** Pure. `cascadeForHostDeath` maps every alive guest to `cancel` and every dead one to `skip`.

- [ ] **Step 4: Run them and watch them pass**, then the full `npm test`.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ap-17): room-share cascade decisions, pure and tested"
```

---

### Task 4: storage, and the endpoint that lists somebody else's requests

**Files:**
- Create: `src/lib/acc/travel-booking/room-share-service.ts`
- Create: the routes under `src/app/api/request/travel-booking/room-share/`

**Interfaces:**
- Consumes: Task 2's policy.
- Produces: attach, detach, `loadGuestsOf(tx, hostRequestId)`, `loadHostableRequests(...)`.

- [ ] **Step 1: The service**

`loadGuestsOf` **must accept an open transaction**, not only a pool — the cascade calls it inside the host's transaction. `perdiem-dependency-load.ts` takes a pool *or* a `tx` for exactly this reason; copy that shape rather than inventing a second.

Attach re-checks `canAttach` **server-side from the database**, inside the transaction that inserts. A client that has had the picker open while the host was cancelled must not slip past.

- [ ] **Step 2: The host-listing endpoint, and its ACL**

This is **new reach: one person listing another person's requests.** Spec §6 is explicit about the shape:

- **it returns only what the picker needs** — running number, travel dates, work location. **Not the amount, not the attachments, not the ID card, not the requester's other fields.** Build the response from a narrow explicit column list, never `SELECT *` or a reuse of the detail read shape;
- **`decideRequestRead` still governs opening the record itself.** This endpoint must never become a way around it. Say in your report how you ensured that;
- only **hostable** requests are offered: alive, not already a guest, `needsRoomBooking = true`;
- **company-wide person search reuses `/api/users/search`** — the same directory search the on-behalf picker uses. Do not write a second.

**`ROUTE_RULES` needs no new entry** — `/api/request/travel-booking` already classifies `AP-17`. Confirm that rather than assuming it, and say so.

- [ ] **Step 3: Filtering**

Default the request filter to **the travel dates the guest has already entered** (the common case is two people on one trip), with request date as the fallback. Spec §6.

- [ ] **Step 4: Tests**

The service reaches `@/env`; the pure admission logic is Task 2's and is already tested. What needs a test here is the **response shape** — that the endpoint cannot return a field it should not. If that can be expressed as a source-reading guard over the column list, write one; if not, say what you would need.

- [ ] **Step 5: Verify and commit**

`npm run typecheck`, full `npm test`.

```bash
git commit -m "feat(ap-17): room-share storage and the host picker endpoint"
```

---

### Task 5: a guest gets per diem despite booking no room

**Files:**
- Modify: `src/lib/acc/travel-booking/request-service.ts` (the submit's `computePerDiem` call)
- Modify: `src/lib/acc/travel-booking/perdiem-recompute.ts` (the recompute's)
- Modify: `src/features/travel-booking/lib/perdiem-estimate-inputs.ts` (the form's estimate)

**Interfaces:**
- Consumes: "is this request a guest?" — one boolean per request.

- [ ] **Step 1: Understand what you are overriding**

Package B's rule is `roomBooked === false → { days: 0, total: 0, groups: [] }`. **A guest books no room and must still be paid** — spec §1, the user's own words, *"(ถ้าเลือกอันนี้จะได้เบี้ยเลี้ยง)"*. So a guest's `roomBooked` argument is **true**.

Express that as one named predicate in one place, and give it a name that says why — `roomBookedOrShared` or similar — rather than writing `needsRoomBooking || isGuest` at three call sites. CLAUDE.md now records that four things compute a per-diem figure and must agree; this makes it four things consulting one predicate, not four copies of a disjunction.

- [ ] **Step 2: All three consumers**

The submit, the recompute, and the form's live estimate. **The estimate is the one most likely to be forgotten** — this branch has already shipped it disagreeing with the submit once, and the fix is recorded in CLAUDE.md. A guest whose screen shows ฿0 while the submit stores real money is the same defect with the sign flipped.

- [ ] **Step 3: Tests**

Extend `perdiem.test.ts` and `perdiem-estimate-inputs.test.ts`: a guest with `needsRoomBooking: false` is paid; a non-guest with `needsRoomBooking: false` is not; the two asserted **side by side in one test**, because each looks like the other's bug — the same pairing `payout-rule.test.ts` uses for the domestic/foreign asymmetry.

- [ ] **Step 4: Verify and commit**

```bash
git commit -m "feat(ap-17): a room-share guest earns per diem without a booking"
```

---

### Task 6: the cascade, inside the host's transaction

**Files:**
- Modify: `src/lib/acc/travel-booking/approval.ts`
- Modify: wherever a host's travel dates can change
- Create: `src/lib/acc/travel-booking/room-share-cascade-guard.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4.

- [ ] **Step 1: The death cascade**

Put it in **`recomputeAfterDeath` (`approval.ts:143`)** unless you find a reason not to — it already runs inside the caller's transaction and is already reached by all three sites serving all four public paths (see "The fact most likely to send you hunting" above). If you put it elsewhere, say why.

Each cancelled guest gets an activity row **`cancelled_by_room_share_host`** carrying the host's running number and the guest's own previous status.

- [ ] **Step 2: The date cascade**

Every live guest's depart and return are rewritten to the host's, per diem recomputed through the **existing** `recomputeGroupPerDiem(tx, groupKey, cause)` — do not write a second recompute — and an activity row **`dates_followed_room_share_host`** records **both** ranges. **Status and approvals are untouched** (spec §2: accepted for throughput).

- [ ] **Step 3: It runs in the host's transaction, and that is the whole safety property**

If the cascade fails, the host's own cancellation **rolls back**. Spec §4 states the direction: a host cancelled while its guests survive is the state this feature exists to prevent, and it is worse than a cancellation the user has to retry.

- [ ] **Step 4: The guard test**

The failure to catch is a **missing call**, which no behavioural test of the four paths can see. Assert, by reading the source:

- all three sites invoke the cascade;
- it is **inside** the transaction, not after the commit.

Copy `perdiem-source-guard.test.ts`'s shape and docblock style. Then **mutation-test your own guard**: remove the call from one site, confirm red; move it after the commit, confirm red; restore; confirm `git status` clean. **Report both results.** This branch has shipped two guards that were green against six real regressions — a guard nobody has tried to defeat is a guard nobody knows the strength of.

- [ ] **Step 5: Verify and commit**

`npm run typecheck`, full `npm test`.

```bash
git commit -m "feat(ap-17): cancel and re-date every guest inside the host's transaction"
```

---

### Task 7: the พักห้องเดียวกับ control

**Files:**
- Modify: `src/features/travel-booking/components/TravelBookingTab.tsx`
- Create: the picker component

- [ ] **Step 1: The control**

On the accommodation section, beside choosing a room. Picking a host **replaces** choosing an accommodation option — the two are alternatives, and the UI must make that legible rather than letting both be set.

- [ ] **Step 2: The picker**

Person first (`/api/users/search`), then one of their requests (Task 4's endpoint), filtered by travel date with request date as the fallback. Show the running number, the dates and the work location — **the three fields the endpoint returns**, and nothing you would have to widen it for.

- [ ] **Step 3: State what the requester is agreeing to**

One Thai line: they book nothing, they still get per diem, and **their request follows the host's** — cancelled if the host cancels, re-dated if the host's dates change. The host has no veto and is merely told, so the guest is the only person who can be warned in advance. Do not bury this.

- [ ] **Step 4: Detaching**

A guest must be able to undo the attachment while their own request is still editable. Use the existing editability rule (`Draft`/`Returned`) rather than a new one.

- [ ] **Step 5: Verify and commit**

```bash
git commit -m "feat(ap-17): พักห้องเดียวกับ — attach to a colleague's booking"
```

---

### Task 8: the three notifications

**Files:**
- Modify: `src/lib/acc/travel-booking/email-templates.ts`
- Modify: the attach path and the cascade

- [ ] **Step 1: Read what package A changed here first**

`buildTravelBookingEmail` gained a fourth parameter `actorName?: string | null` and `notify()` a fifth, on 2026-09-21. Three templates lost their `ผู้ขอ` row because they are sent **to** the requester. Match that work; do not reintroduce a row telling somebody their own name.

- [ ] **Step 2: The three**

Spec §5 — **notification is the entire protection, because the host has no veto**:

- **to the host**, when a guest attaches — naming the guest and the dates, so an unexpected one is visible immediately rather than at check-in;
- **to the guest**, when their request is cancelled or re-dated by the host;
- **to accounting**, when a cascade cancels a request that had already reached `Completed` — the case spec §2 accepted. `wasCompleted` from Task 3 is what tells you. **A cancelled-after-payment request is an accounting problem the moment it happens, and the system must say so** rather than leaving a reconciliation to be discovered.

All three go through the existing `AccEmailQueue`. UAT redirect and the `[UAT] ` prefix are unchanged and must not be special-cased.

- [ ] **Step 3: Tests**

`email-templates.test.ts` exists (package A added it) and uses the placeholder-env + dynamic-`import()` pattern because the module reaches `@/env` at line 1 — **read how before writing**. Assert each new trigger renders the fields that make it useful, and follow package A's precedent of asserting copy against exported constants rather than prose fragments, so rewording does not red the suite for no reason.

- [ ] **Step 4: Verify and commit**

```bash
git commit -m "feat(ap-17): tell the host, the guest and accounting about a room share"
```

---

### Task 9: CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: The feature, in the AP-17 section's voice**

Host and guest as named terms; the one hop; the unique index; that the table is transactional, not dual-written, and that `check:alignment` stays at **30**.

- [ ] **Step 2: The three costs, each as a cost**

This is the part that must not be softened into feature description. Each was chosen by the user on 2026-09-21 with the trade stated:

- **No consent.** A guest attaches to a document they do not own and draws money on it; the host learns afterwards. Both managers still approve their own sides, so nobody is paid without an approval — only without the host's say-so about the room. Notification is the only mitigation.
- **Cancel in every case, including after payment.** This is the direction `perdiem-window.ts` exists to prevent, and the reason it is acceptable is that it is **not silent**: an activity row every time and a mail to accounting when the guest had reached `Completed`.
- **Dates follow without re-approval.** A manager approves 20–24 and the guest travels 25–30 with nobody reviewing it. Accepted for throughput; the per diem follows and the activity row records both ranges.

- [ ] **Step 3: The two interactions a later reader will otherwise rediscover**

- **A guest is asked for no ID card**, because they select no accommodation option and package C's flag is therefore never true on that account. **Intended, not an oversight** — the booking is the host's and the hotel holds the host's identification. A guest who also books a ticket or a rental *is* asked, through C's ordinary rule. And if a supplier ever wants both names, the fix is a `RequiresIdCard` flag on the share itself, **not** a special case in `deriveBookingFlags`.
- **The date cascade can create an overlap package B would have refused at submit.** Accepted and deliberately not an error: the guest did not choose it. It is logged in the same activity row.

- [ ] **Step 4: The deployment checklist**

156 (and 157) to both form databases before the code; `check:alignment` still **30**; the UAT identity floor must be in place before any UAT write, the same rule 061 carries.

- [ ] **Step 5: Verify and commit**

`npm run typecheck` and the full `npm test` — unchanged, since this task edits no code.

```bash
git add CLAUDE.md
git commit -m "docs: record AP-17's room-share feature and its three accepted costs"
```
