# AP-3 Phase 2 Step 2 — External Document No. and Business Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct the two columns of the interface layout that are being filled in wrongly today — External Document No., which carries the request number instead of the requester's staff id, and Business Unit, which the codeunit hard-codes to `COCO` on every line of both AP-2 and AP-3.

**Architecture:** Two halves with different owners and different readiness. **2b** is portal-only, testable the day it is written, and ships first. **2a** needs a codeunit change and a rule nobody has stated yet, so its AL half is written to be inert until the portal opts in, and its portal half waits.

**Tech Stack:** TypeScript, `node:test` via `npm test`; AL (codeunit 50263) for the 2a half.

**Spec:** `docs/superpowers/specs/2026-09-08-ap3-phase2-erp-fields-design.md` §5.1, §5.2

---

## Ordering, and why 2b goes first

2a is the more consequential of the two — a wrong dimension sits on every AP-2
and AP-3 line already in BC. But it cannot be finished: §8 q3 of the spec asks
what decides a line's Business Unit and nobody has answered. Writing the portal
half against a guessed rule would put a *different* wrong value on the same
lines.

So this plan ships 2b, then does the inert AL half of 2a, and stops at the point
where the rule is needed. Task 4 is the question, written down as a task so it
is not lost.

---

## File Structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/lib/clr/clear-advance-erp-payload.ts` | Build the AP-3 journal | `employeeCode` comes from a new `staffId` input, not the request no. |
| `src/lib/clr/clear-advance-erp-payload.test.ts` | Unit tests | New tests |
| `src/lib/clr/clear-advance-erp-send.ts` | Load a request, call the builder | Pass `req.staffId` |
| `R:\PPFunction\AL\...\APJournalCreate.al` | Codeunit 50263 | `buCode` key, `COCO` fallback (Task 3) |

---

## Task 1: External Document No. carries the staff id

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-payload.ts:20-40` (`ClrJournalInput`) and `:53`
- Test: `src/lib/clr/clear-advance-erp-payload.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/clr/clear-advance-erp-payload.test.ts`:

```ts
/* ── External Document No. (spec §5.2, sheet row 25: "รหัสพนักงาน") ──────
 *
 * The field was populated from the start, which is why this read as done until
 * someone looked at the value: ADC26-09008 reached BC with an External Document
 * No. of "ADC26-09008" rather than the requester's 10177.
 */

test("External Document No. is the requester's staff id", () => {
  const p = buildClearAdvanceJournalPayload(base({ staffId: 10177 }));
  for (const l of p.lines) assert.equal(l.employeeCode, "10177");
});

test("every line carries it, not just the expense line", () => {
  const p = buildClearAdvanceJournalPayload(base({
    staffId: 10177,
    advanceAmount: 5000,
    items: [{ glAccountNo: "610322005", amountBeforeVat: 1000, vatAmount: 70, whtAmount: 30, branchCode: "HQ01" }],
  }));
  assert.ok(p.lines.length >= 4, "expected expense, VAT, WHT, vendor and bank lines");
  assert.deepEqual(new Set(p.lines.map((l) => l.employeeCode)), new Set(["10177"]));
});

/* Without a staff id there is nothing true to send. The request number is not a
 * substitute — it is what made this wrong in the first place — so the field goes
 * out empty rather than carrying a value that means something else. */
test("no staff id leaves External Document No. empty", () => {
  const p = buildClearAdvanceJournalPayload(base({ staffId: null }));
  for (const l of p.lines) assert.equal(l.employeeCode, "");
});
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"`
Expected: `# fail 3` — `staffId` is not a property of the input, and the value is still the request number.

- [ ] **Step 3: Take the value from the staff id**

In `src/lib/clr/clear-advance-erp-payload.ts`, add to `ClrJournalInput` after
`requesterName`:

```ts
  /**
   * The requester's HR staff id. Goes to BC as External Document No. — sheet
   * row 25, "รหัสพนักงาน", and the requirements say *only* that
   * (`ap3-clear-advance-specification.md` §4). Null when the request has no
   * staff id, which sends the field empty rather than substituting something
   * that means something else.
   */
  staffId?: number | null;
```

and replace line 53:

```ts
  const employeeCode = input.staffId != null ? String(input.staffId).slice(0, 35) : "";
```

Leave the comment above it corrected too — it currently says the request number
is carried there on purpose.

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/clr/clear-advance-erp-payload.ts src/lib/clr/clear-advance-erp-payload.test.ts
git commit -m "fix(ap-3): External Document No. is the staff id, not the request no."
```

---

## Task 2: The sender passes the staff id

**Files:**
- Modify: `src/lib/clr/clear-advance-erp-send.ts` (the `buildClearAdvanceJournalPayload({ ... })` call)

- [ ] **Step 1: Pass it**

`getRequest` already returns `staffId` (`clear-advance-request-service.ts:82`).
Add to the payload call, beside `requesterName`:

```ts
        staffId: req.staffId,
```

- [ ] **Step 2: Run tests and typecheck**

Run: `npm test 2>&1 | Select-String -Pattern "^# (pass|fail)"` then `npx tsc --noEmit`
Expected: `# fail 0`; no errors outside `.next/`.

- [ ] **Step 3: Verify against a real clearing before sending**

With the dev server on `:3081`, open an approved AP-3 clearing in the ERP queue
and check the preview's underlying data:

```js
await fetch('/api/request/clear-advance/erp/preview?ids=<id>').then(r => r.json())
```

The preview line shape does not expose `employeeCode`, so confirm it instead on
the send in Task 3 — or add it temporarily to the preview mapping and take it
out again. Do not ship a temporary field.

- [ ] **Step 4: Commit**

```bash
git add src/lib/clr/clear-advance-erp-send.ts
git commit -m "feat(ap-3): the sender passes the requester's staff id to the journal builder"
```

---

## Task 3: Prove it in BC

Neither test nor preview can show what BC stored. The codeunit writes
`employeeCode` into External Document No. (`APJournalCreate.al:214`) and that
field is what accounting reconciles against.

**Files:** none — verification.

- [ ] **Step 1: Drive one clearing end to end**

Create an AP-3 clearing on UAT, approve it through all three steps and send it.
The manager step needs `ACC_MANAGER_DEV_BYPASS=1` in `.env.local` and a restart
of `:3081` unless you are the assigned manager. **Take it back out and restart
again afterwards.**

- [ ] **Step 2: Confirm what BC received**

The portal does not store what it sent, so read it back from BC through the same
OData service the send uses, or ask accounting to open the journal batch and
read the External Document No. on the new document.

Expected: the requester's staff id (`10177` for Plume), not `ADC26-090xx`.

- [ ] **Step 3: Record the document number**

Put it in the commit message or the PR description, as Step 1 did with
`PVA2609-0009`.

---

## Task 4: The Business Unit question

2a cannot be built past its AL half until this is answered. This task exists so
the question is tracked rather than remembered.

**Files:** none — a question for accounting.

- [ ] **Step 1: Ask what decides a line's Business Unit**

The layout shows BU varying per line — `COCO` on one expense line, `DOCO` on the
next — and for the bank line notes "ล็อคตามสาขา Location ERP". Rows 25-29 pair
`DOCO`, `DODO`, `DODO-M`, `RFM`, `COCO` with G/L accounts, but that block is a
legend, not data, and it does not state the rule.

Candidate readings, none of them to be assumed:
- BU follows the **G/L account** on the line (what the legend hints at)
- BU follows the **branch**, as the bank line's note implies for that line
- BU is a property of the **brand / company** and is constant per clearing

- [ ] **Step 2: Write the answer into the spec**

Update §5.1 and close §8 q3 of
`docs/superpowers/specs/2026-09-08-ap3-phase2-erp-fields-design.md`.

---

## Task 5: The AL half of Business Unit

Safe to write and deploy before the rule is known, because it changes nothing
until a caller sends the key.

**Files:**
- Modify: `R:\PPFunction\AL\ALProject12_SalesTran\ACCForm\AP\APJournalCreate.al:280-282`

- [ ] **Step 1: Read the key, keep the old value as the fallback**

Replace:

```al
    local procedure GetBusinessUnitCode(): Code[20]
    begin
        exit('COCO');
    end;
```

with a lookup that takes the line's value when it is given:

```al
    local procedure GetBusinessUnitCode(BuCode: Text): Code[20]
    begin
        // The layout (AP-UP.xlsx, "AP-3 (Interface ERP)") has Business Unit as a
        // per-line column; this used to return a constant, so every line of every
        // AP-2 and AP-3 journal carried COCO whether or not that was right.
        // The constant stays as the fallback: a caller that sends nothing keeps
        // exactly today's behaviour, which is what makes this safe to deploy
        // before either portal sends the key.
        if BuCode <> '' then
            exit(CopyStr(BuCode, 1, 20));
        exit('COCO');
    end;
```

and at both call sites (`:225` and `:234`) pass the line's value:

```al
        GenJnlLine.Validate("Shortcut Dimension 2 Code", GetBusinessUnitCode(GetJsonText(LineObject, 'buCode')));
```

```al
        AddDimensionToTemp(TempDimSetEntry, 'BU', GetBusinessUnitCode(GetJsonText(LineObject, 'buCode')));
```

Read `buCode` once into a local at the top of the line loop rather than calling
`GetJsonText` twice, matching how `branchCode` is handled at `:135`.

- [ ] **Step 2: Compile**

Build the extension in VS Code (AL: Package) or with `alc`. A compile is the
only check available here — there is no AL test project in this workspace.

- [ ] **Step 3: Deploy to Sandbox and confirm nothing changed**

Publish, then send one AP-3 clearing that does **not** carry `buCode`. Its lines
must still land with `BU = COCO`. This is the whole point of the fallback: the
change is provably inert until someone opts in.

- [ ] **Step 4: Commit**

The AL workspace is a separate repository from Form_Portal. Commit there:

```bash
git add ACCForm/AP/APJournalCreate.al
git commit -m "feat(ap): the journal API accepts a per-line Business Unit"
```

---

## Done

- `npm test` at or above baseline, `npx tsc --noEmit` clean of source errors.
- One AP-3 document in BC whose External Document No. is a staff id.
- The codeunit accepting `buCode`, deployed, and demonstrably inert without it.
- §8 q3 answered in the spec, which unblocks the portal half of 2a.

**Not in this plan:** the portal sending `buCode` (needs Task 4), Step 3's WHT
vendor line, Step 4's VAT and tax block.
