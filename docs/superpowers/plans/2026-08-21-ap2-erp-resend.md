# AP-2 ERP Re-send (Pull-back → Resent → Re-issue) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an ACC_OFFICER pull a `Sent` AP-2 advance back into the Interface "รอส่ง" queue, re-select its payment date, and re-send it as a new PV — keeping an accurate ADV↔PV history — without any BC mutation.

**Architecture:** Form/DB only. A new `AccAdvanceErpAttempt` table records one row per PV send; every successful send inserts a `Sent` attempt; a pull-back flips the current `Sent` attempt to `Resent` and clears the request's interface fields so it re-enters "รอส่ง". Re-send uses the existing send path unchanged. The old unposted BC line is left for Accounting to handle, guided by the report.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, MSSQL (`mssql` driver, `getAccPool = getFormPool` id-routing), node:test (`tsx --test`), Playwright MCP for E2E.

**Spec:** `docs/superpowers/specs/2026-08-21-ap2-erp-resend-design.md`
**Branch:** `feat/ap-2-advance`

---

## File Structure

| File | Responsibility |
|---|---|
| `migrations/101_acc_advance_erp_attempt.sql` (new) | Table `AccAdvanceErpAttempt` + backfill of current `Sent` AP-2 rows as attempt #1 |
| `src/lib/adv/advance-erp-attempt-service.ts` (new) | `recordSentAttempt`, `markResent`, `listAttempts` + `nextAttemptNo` pure helper |
| `src/lib/adv/advance-erp-attempt-service.test.ts` (new) | Unit test for the `nextAttemptNo` pure helper |
| `src/lib/adv/advance-erp-send.ts` (modify) | Call `recordSentAttempt` in the success loop |
| `src/app/api/request/advance/erp-queue/pullback/route.ts` (new) | POST `{id}` — guard `Sent`, `markResent`, log |
| `src/app/api/request/advance/erp-queue/payment-date/route.ts` (new) | POST `{id, paymentDate}` — validate + set `AccRequest.PaymentDate` |
| `src/app/api/request/advance/requests/[id]/attempts/route.ts` (new) | GET attempts for the mapping display |
| `src/features/advance/components/AdvanceErpQueue.tsx` (modify) | "รอส่ง" payment-date picker; "ส่งแล้ว" pull-back button + attempt chain |
| `src/lib/adv/advance-queue-service.ts` (modify) | Include `Resent` attempts in the Excel export |

---

## Task 1: Migration — `AccAdvanceErpAttempt` table + backfill

**Files:**
- Create: `migrations/101_acc_advance_erp_attempt.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- 101: AP-2 ERP send-attempt history — one row per PV send, so a Sent advance
-- can be pulled back (attempt -> 'Resent') and re-sent (new attempt -> 'Sent')
-- while keeping the ADV↔PV mapping. Form/DB only; no BC changes.
-- Apply on BOTH Rocks_Portal_Form AND Rocks_Portal_Form_UAT.

IF NOT EXISTS (
  SELECT 1 FROM sys.objects
  WHERE object_id = OBJECT_ID('dbo.AccAdvanceErpAttempt') AND type = 'U'
)
BEGIN
  CREATE TABLE dbo.AccAdvanceErpAttempt (
    Id            INT IDENTITY(1,1) PRIMARY KEY,
    RequestId     INT NOT NULL,
    AttemptNo     INT NOT NULL,
    ErpDocumentNo NVARCHAR(35) NULL,
    Environment   NVARCHAR(20) NULL,
    Company       NVARCHAR(100) NULL,
    Status        NVARCHAR(20) NOT NULL,   -- 'Sent' | 'Resent'
    SentAt        DATETIME2 NULL,
    SentBy        INT NULL,
    ResentBy      INT NULL,
    ResentAt      DATETIME2 NULL,
    CreatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME(),
    UpdatedAt     DATETIME2 NOT NULL DEFAULT SYSDATETIME()
  );
  CREATE INDEX IX_AccAdvanceErpAttempt_Request
    ON dbo.AccAdvanceErpAttempt (RequestId, AttemptNo);
END
GO

-- Backfill: every AP-2 request currently 'Sent' becomes attempt #1 ('Sent'),
-- so the history is continuous from day one. Company is unknown historically → NULL.
INSERT INTO dbo.AccAdvanceErpAttempt
  (RequestId, AttemptNo, ErpDocumentNo, Environment, Company, Status, SentAt, SentBy)
SELECT r.Id, 1, r.ErpDocumentNo, r.ErpInterfaceEnvironment, NULL, 'Sent',
       r.ErpInterfaceSentAt, r.ErpInterfaceSentBy
FROM dbo.AccRequest r
WHERE r.FormCode = 'AP-2' AND r.ErpInterfaceStatus = 'Sent'
  AND NOT EXISTS (SELECT 1 FROM dbo.AccAdvanceErpAttempt a WHERE a.RequestId = r.Id);
GO

PRINT '=== Migration 101 complete (AccAdvanceErpAttempt + backfill) ===';
GO
```

- [ ] **Step 2: Apply to UAT first**

Run: `npm run apply-sql -- --db Rocks_Portal_Form_UAT --file migrations/101_acc_advance_erp_attempt.sql`
Expected: prints `applied 101_acc_advance_erp_attempt.sql to Rocks_Portal_Form_UAT OK` and `Migration 101 complete`.

- [ ] **Step 3: Apply to Production**

Run: `npm run apply-sql -- --db Rocks_Portal_Form --file migrations/101_acc_advance_erp_attempt.sql`
Expected: prints `applied ... to Rocks_Portal_Form OK`.

- [ ] **Step 4: Verify backfill (read-only, via mssql-rocks MCP)**

Query both DBs:
```sql
SELECT RequestId, AttemptNo, ErpDocumentNo, Status FROM [Rocks_Portal_Form_UAT].[dbo].[AccAdvanceErpAttempt] ORDER BY RequestId;
```
Expected: one `AttemptNo=1, Status='Sent'` row per previously-Sent AP-2 request (e.g. ADV26-00001/00004/00005/00008/00009 …), matching each request's `ErpDocumentNo`.

- [ ] **Step 5: Commit**

```bash
git add migrations/101_acc_advance_erp_attempt.sql
git commit -m "feat(ap-2): migration 101 — AccAdvanceErpAttempt send-attempt history + backfill"
```

---

## Task 2: Attempt service + `nextAttemptNo` unit test

**Files:**
- Create: `src/lib/adv/advance-erp-attempt-service.ts`
- Test: `src/lib/adv/advance-erp-attempt-service.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

`src/lib/adv/advance-erp-attempt-service.test.ts`:
```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAttemptNo } from "./advance-erp-attempt-service";

test("first attempt is 1 when there is no prior attempt", () => {
  assert.equal(nextAttemptNo(null), 1);
  assert.equal(nextAttemptNo(0), 1);
});

test("next attempt is max + 1", () => {
  assert.equal(nextAttemptNo(1), 2);
  assert.equal(nextAttemptNo(3), 4);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx tsx --test src/lib/adv/advance-erp-attempt-service.test.ts`
Expected: FAIL — `Cannot find module './advance-erp-attempt-service'` (or `nextAttemptNo is not a function`).

- [ ] **Step 3: Implement the service**

`src/lib/adv/advance-erp-attempt-service.ts`:
```ts
import { getAccPool, sql } from "@/lib/adv/pool";

export interface ErpAttempt {
  id: number;
  attemptNo: number;
  erpDocumentNo: string | null;
  environment: string | null;
  company: string | null;
  status: "Sent" | "Resent";
  sentAt: string | null;
  sentBy: number | null;
  resentAt: string | null;
}

/** Pure: the attempt number to use given the current max (null/0 → 1). */
export function nextAttemptNo(currentMax: number | null): number {
  return (currentMax ?? 0) + 1;
}

/** Record a successful send as the next attempt (Status='Sent') for a request. */
export async function recordSentAttempt(
  requestId: number,
  documentNo: string | null,
  environment: string | null,
  company: string | null,
  userId: number,
): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("doc", sql.NVarChar, documentNo)
    .input("env", sql.NVarChar, environment)
    .input("company", sql.NVarChar, company)
    .input("by", sql.Int, userId)
    .query(`
      INSERT INTO [dbo].[AccAdvanceErpAttempt]
        (RequestId, AttemptNo, ErpDocumentNo, Environment, Company, Status, SentAt, SentBy)
      SELECT @rid,
             COALESCE((SELECT MAX(AttemptNo) FROM [dbo].[AccAdvanceErpAttempt] WHERE RequestId=@rid), 0) + 1,
             @doc, @env, @company, 'Sent', SYSDATETIME(), @by`);
}

/** Pull a Sent advance back: flip its current 'Sent' attempt to 'Resent' and
 *  clear the request's interface fields so it re-enters the "รอส่ง" queue. */
export async function markResent(requestId: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[AccAdvanceErpAttempt]
      SET Status='Resent', ResentBy=@by, ResentAt=SYSDATETIME(), UpdatedAt=SYSDATETIME()
      WHERE RequestId=@rid AND Status='Sent';

      UPDATE [dbo].[AccRequest]
      SET ErpInterfaceStatus=NULL, ErpDocumentNo=NULL, ErpInterfaceError=NULL,
          ErpInterfaceSentAt=NULL, ErpInterfaceSentBy=NULL, ErpInterfaceEnvironment=NULL,
          UpdatedAt=SYSDATETIME()
      WHERE Id=@rid`);
}

/** All send attempts for a request, oldest first (for the mapping display). */
export async function listAttempts(requestId: number): Promise<ErpAttempt[]> {
  const pool = await getAccPool();
  const r = await pool.request().input("rid", sql.Int, requestId).query(`
    SELECT Id, AttemptNo, ErpDocumentNo, Environment, Company, Status, SentAt, SentBy, ResentAt
    FROM [dbo].[AccAdvanceErpAttempt] WHERE RequestId=@rid ORDER BY AttemptNo`);
  return r.recordset.map((x: Record<string, unknown>) => ({
    id: x.Id as number,
    attemptNo: x.AttemptNo as number,
    erpDocumentNo: (x.ErpDocumentNo as string) ?? null,
    environment: (x.Environment as string) ?? null,
    company: (x.Company as string) ?? null,
    status: x.Status as "Sent" | "Resent",
    sentAt: x.SentAt ? (x.SentAt as Date).toISOString() : null,
    sentBy: (x.SentBy as number) ?? null,
    resentAt: x.ResentAt ? (x.ResentAt as Date).toISOString() : null,
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx --test src/lib/adv/advance-erp-attempt-service.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Add the test to the `test` script**

In `package.json`, append ` src/lib/adv/advance-erp-attempt-service.test.ts` to the end of the `"test"` command string.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: exit 0.
```bash
git add src/lib/adv/advance-erp-attempt-service.ts src/lib/adv/advance-erp-attempt-service.test.ts package.json
git commit -m "feat(ap-2): advance-erp-attempt-service (record/markResent/list + nextAttemptNo)"
```

---

## Task 3: Record a `Sent` attempt on every successful send

**Files:**
- Modify: `src/lib/adv/advance-erp-send.ts` (import near top; call inside the success loop ~line 309-314)

- [ ] **Step 1: Add the import**

At the top of `advance-erp-send.ts`, next to the existing `buildAdvance...payload` import:
```ts
import { recordSentAttempt } from "@/lib/adv/advance-erp-attempt-service";
```

- [ ] **Step 2: Call it in the success loop**

In `sendAdvanceErpBatch`, the per-entry success loop currently reads:
```ts
      for (const e of entries) {
        await markInterfaceStatus(e.req.id, "Sent", { userId, environment: target.environment, documentNo: docNo });
        await logInterfaceActivity(e.req.id, userId, "erp_interface_sent",
          `ส่งเข้า ERP ${envLabel} · ${target.interfaceTarget} · ${e.req.requestNo ?? e.req.id} · Doc: ${docNo ?? "—"} · BCResp: ${resp}`);
        results.push({ id: e.req.id, ok: true });
      }
```
Insert the attempt record right after `markInterfaceStatus`:
```ts
      for (const e of entries) {
        await markInterfaceStatus(e.req.id, "Sent", { userId, environment: target.environment, documentNo: docNo });
        await recordSentAttempt(e.req.id, docNo, target.environment, target.interfaceTarget, userId);
        await logInterfaceActivity(e.req.id, userId, "erp_interface_sent",
          `ส่งเข้า ERP ${envLabel} · ${target.interfaceTarget} · ${e.req.requestNo ?? e.req.id} · Doc: ${docNo ?? "—"} · BCResp: ${resp}`);
        results.push({ id: e.req.id, ok: true });
      }
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adv/advance-erp-send.ts
git commit -m "feat(ap-2): record a Sent attempt on each successful ERP send"
```

---

## Task 4: Pull-back route

**Files:**
- Create: `src/app/api/request/advance/erp-queue/pullback/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { markResent } from "@/lib/adv/advance-erp-attempt-service";

/** POST { id } — pull a Sent AP-2 advance back to the "รอส่ง" queue for a corrected re-send. */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) {
      return NextResponse.json(
        { ok: false, error: "เฉพาะผู้อนุมัติบัญชี/แอดมินเท่านั้น" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number };
  const id = Number(body.id);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ ok: false, error: "ไม่พบรายการ" }, { status: 400 });
  }

  const pool = await getAccPool();
  const st = await pool.request().input("id", sql.Int, id)
    .query(`SELECT ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='AP-2'`);
  const cur = (st.recordset[0]?.ErpInterfaceStatus as string | null) ?? null;
  if (cur !== "Sent") {
    return NextResponse.json(
      { ok: false, error: "ดึงกลับได้เฉพาะรายการที่ส่งแล้ว (Sent)" }, { status: 400 });
  }

  await markResent(id, actor.userId);
  await pool.request()
    .input("rid", sql.Int, id).input("by", sql.Int, actor.userId)
    .input("action", sql.NVarChar, "erp_interface_pullback")
    .input("note", sql.NVarChar, "ดึงกลับเพื่อยิงใหม่ (Resent)")
    .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
            VALUES (@rid, @by, @action, @note)`);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/request/advance/erp-queue/pullback/route.ts"
git commit -m "feat(ap-2): pull-back route — mark current attempt Resent + reset interface"
```

---

## Task 5: Payment-date route

**Files:**
- Create: `src/app/api/request/advance/erp-queue/payment-date/route.ts`

- [ ] **Step 1: Write the route**

`AccRequest.PaymentDate` is the field the send payload reads (`req.paymentDate` → `postingDate`), so we update it here.

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { buildAccActor } from "@/lib/acc/actor-context";
import { isAdvanceApprover } from "@/lib/adv/advance-approver-service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getPaymentDates } from "@/lib/acc/payment-calendar";

/** POST { id, paymentDate } — re-target the payment cycle for an Approved,
 *  not-yet-Sent AP-2 advance (used on the "รอส่ง" queue before re-sending). */
export async function POST(req: NextRequest) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
  const isAdmin = session.user.role === "IT Admin" || session.user.role === "System Admin";
  if (!isAdmin) {
    const [h, o, d] = await Promise.all([
      isAdvanceApprover(actor.email, "HEAD_ACC"),
      isAdvanceApprover(actor.email, "ACC_OFFICER"),
      isAdvanceApprover(actor.email, "DIRECTOR"),
    ]);
    if (!h && !o && !d) {
      return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์" }, { status: 403 });
    }
  }

  const body = (await req.json().catch(() => ({}))) as { id?: number; paymentDate?: string };
  const id = Number(body.id);
  const paymentDate = typeof body.paymentDate === "string" ? body.paymentDate : "";
  if (!Number.isFinite(id) || !paymentDate) {
    return NextResponse.json({ ok: false, error: "ข้อมูลไม่ครบ" }, { status: 400 });
  }

  const valid = await getPaymentDates();
  if (!valid.includes(paymentDate)) {
    return NextResponse.json({ ok: false, error: "วันจ่ายไม่ถูกต้อง" }, { status: 400 });
  }

  const pool = await getAccPool();
  const st = await pool.request().input("id", sql.Int, id)
    .query(`SELECT Status, ErpInterfaceStatus FROM [dbo].[AccRequest] WHERE Id=@id AND FormCode='AP-2'`);
  const row = st.recordset[0] as { Status?: string; ErpInterfaceStatus?: string | null } | undefined;
  if (!row || row.Status !== "Approved" || row.ErpInterfaceStatus === "Sent") {
    return NextResponse.json(
      { ok: false, error: "แก้วันจ่ายได้เฉพาะรายการที่อนุมัติแล้วและยังไม่ได้ส่ง" }, { status: 400 });
  }

  await pool.request().input("rid", sql.Int, id).input("pd", sql.Date, paymentDate)
    .query(`UPDATE [dbo].[AccRequest] SET PaymentDate=@pd, UpdatedAt=SYSDATETIME()
            WHERE Id=@rid AND FormCode='AP-2'`);

  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add "src/app/api/request/advance/erp-queue/payment-date/route.ts"
git commit -m "feat(ap-2): payment-date route — re-target cycle for not-yet-Sent advance"
```

---

## Task 6: Attempts GET route (for the mapping display)

**Files:**
- Create: `src/app/api/request/advance/requests/[id]/attempts/route.ts`

- [ ] **Step 1: Write the route**

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { listAttempts } from "@/lib/adv/advance-erp-attempt-service";

/** GET — send-attempt history (ADV↔PV mapping) for one AP-2 request. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isFinite(rid)) {
    return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });
  }
  try {
    const data = await listAttempts(rid);
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "error" }, { status: 500 });
  }
}
```

> Note: the `params: Promise<…>` + `await ctx.params` shape matches this repo's other `[id]` routes (Next 16). If a sibling route uses a non-promise `params`, copy that shape instead.

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit` → exit 0.
```bash
git add "src/app/api/request/advance/requests/[id]/attempts/route.ts"
git commit -m "feat(ap-2): GET attempts route for the ADV↔PV mapping display"
```

---

## Task 7: "รอส่ง" tab — per-row Payment Date picker

**Files:**
- Modify: `src/features/advance/components/AdvanceErpQueue.tsx`

Context: the component already fetches queue rows (each `ErpQueueRow` has `id` and `paymentDate`), has a `pending` tab listing `sendable` rows, and posts to `/api/request/advance/erp-queue/send`. There is an existing `/api/request/advance/payment-dates` GET returning `{ dates, default }`.

- [ ] **Step 1: Load payment-date options once**

Near the other `useState`/`useEffect` hooks at the top of the component, add:
```tsx
  const [paymentDateOpts, setPaymentDateOpts] = useState<string[]>([]);
  useEffect(() => {
    fetch("/api/request/advance/payment-dates")
      .then((r) => r.json())
      .then((j: { ok?: boolean; dates?: string[] }) => { if (j?.dates) setPaymentDateOpts(j.dates); })
      .catch(() => {});
  }, []);
```

- [ ] **Step 2: Add the change handler**

Add this handler in the component body (alongside `sendAll` / other handlers), where `reload` is the existing function that refetches the queue (use the same refresh call `sendAll` uses after a successful send):
```tsx
  async function changePaymentDate(id: number, paymentDate: string) {
    const res = await fetch("/api/request/advance/erp-queue/payment-date", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, paymentDate }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string };
    if (!j.ok) { toast.error(j.error ?? "แก้วันจ่ายไม่สำเร็จ"); return; }
    toast.success("อัปเดตวันจ่ายแล้ว");
    await reloadQueue();
  }
```
> Replace `reloadQueue()` with the component's actual queue-refetch function (the one called after `sendAll` succeeds). If the pending list is derived from a `rows` state loaded by a `load()`/`refresh()` effect, call that.

- [ ] **Step 3: Render the picker on each pending row**

In the `pending` tab's row rendering, show the payment date as an inline `<select>` (fallback to plain text if no options loaded yet):
```tsx
  {paymentDateOpts.length > 0 ? (
    <select
      value={row.paymentDate ?? ""}
      onChange={(e) => changePaymentDate(row.id, e.target.value)}
      className="text-[12px] px-2 py-1 rounded-lg"
      style={{ background: "var(--bg-card)", color: "var(--text-primary)", border: "1px solid var(--border-card)" }}
    >
      {!row.paymentDate && <option value="">— เลือกวันจ่าย —</option>}
      {paymentDateOpts.map((d) => <option key={d} value={d}>{d}</option>)}
    </select>
  ) : (
    <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>{row.paymentDate ?? "—"}</span>
  )}
```
Place it in the pending row's "วันจ่าย" cell/line. If the pending list currently shows rows compactly without a วันจ่าย field, add a small labelled row: `วันจ่าย: <picker>`.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/features/advance/components/AdvanceErpQueue.tsx
git commit -m "feat(ap-2): payment-date picker on the รอส่ง queue rows"
```

---

## Task 8: "ส่งแล้ว" tab — pull-back button + attempt chain

**Files:**
- Modify: `src/features/advance/components/AdvanceErpQueue.tsx`

- [ ] **Step 1: Add pull-back state + handler**

Add near the other handlers:
```tsx
  const [pullbackId, setPullbackId] = useState<number | null>(null);
  const [pullbackBusy, setPullbackBusy] = useState(false);

  async function doPullback() {
    if (pullbackId == null) return;
    setPullbackBusy(true);
    try {
      const res = await fetch("/api/request/advance/erp-queue/pullback", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pullbackId }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string };
      if (!j.ok) { toast.error(j.error ?? "ดึงกลับไม่สำเร็จ"); return; }
      toast.success("ดึงกลับแล้ว — ย้ายไปแท็บ “รอส่ง”");
      setPullbackId(null);
      await reloadQueue();
      setTab("pending");
    } finally {
      setPullbackBusy(false);
    }
  }
```
> Use the same queue-refetch function as Task 7 Step 2 for `reloadQueue()`. `setTab` is the existing tab state setter.

- [ ] **Step 2: Add the per-row action in the "ส่งแล้ว" table**

In the `sent` tab's row (the `sentFiltered.map((r) => …)` block), add an action button in the row's last cell:
```tsx
  <button type="button" onClick={() => setPullbackId(r.id)}
    className="text-[12px] font-semibold px-2 py-1 rounded-lg cursor-pointer border-none"
    style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
    title="ดึงกลับเข้าคิวเพื่อยิงใหม่">
    ดึงกลับเพื่อยิงใหม่
  </button>
```
Add a matching header cell `""` (or "การจัดการ") to the sent table's header row so column counts line up.

- [ ] **Step 3: Add the confirm dialog**

Near the existing confirm `<Dialog>` at the bottom of the component:
```tsx
  <Dialog
    open={pullbackId != null}
    onOpenChange={(o) => { if (!pullbackBusy && !o) setPullbackId(null); }}
    title="ดึงกลับเพื่อยิงใหม่?"
    description="ใบเดิม (PV) จะถูกทำเครื่องหมายเป็น Resent และรายการจะกลับไปที่คิว “รอส่ง” เพื่อแก้วันจ่าย/ข้อมูลแล้วยิงใหม่ — บัญชีต้องไม่ post ใบ PV เดิมใน BC"
    contentClassName="max-w-md"
  >
    <div className="flex justify-end gap-2 pt-1">
      <Button variant="secondary" onClick={() => setPullbackId(null)} disabled={pullbackBusy}>ยกเลิก</Button>
      <Button variant="primary" onClick={doPullback} loading={pullbackBusy}>ยืนยันดึงกลับ</Button>
    </div>
  </Dialog>
```

- [ ] **Step 4: Show the attempt chain in the detail panel**

The sent table already opens a detail panel via `setPanelId(r.id)`. In that panel component, fetch and render the attempt chain:
```tsx
  // inside the detail panel, given `panelId`:
  const [attempts, setAttempts] = useState<{ attemptNo: number; erpDocumentNo: string | null; status: string }[]>([]);
  useEffect(() => {
    if (panelId == null) return;
    fetch(`/api/request/advance/requests/${panelId}/attempts`)
      .then((r) => r.json())
      .then((j: { ok?: boolean; data?: { attemptNo: number; erpDocumentNo: string | null; status: string }[] }) => setAttempts(j.data ?? []))
      .catch(() => setAttempts([]));
  }, [panelId]);
  // render:
  {attempts.length > 1 && (
    <div className="mt-2 text-[12px]">
      <div className="font-semibold mb-1">ประวัติการส่ง ERP</div>
      {attempts.map((a) => (
        <div key={a.attemptNo} className="flex gap-2">
          <span className="font-mono">{a.erpDocumentNo ?? "—"}</span>
          <span style={{ color: a.status === "Resent" ? "var(--color-warning)" : "var(--color-success, #16a34a)" }}>
            {a.status === "Resent" ? "Resent (อย่า post)" : "Sent (ปัจจุบัน)"}
          </span>
        </div>
      ))}
    </div>
  )}
```
> Adapt the state placement to wherever the detail panel is defined (same file). If the panel is a separate component, pass `panelId` in and keep this logic there.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/features/advance/components/AdvanceErpQueue.tsx
git commit -m "feat(ap-2): ดึงกลับเพื่อยิงใหม่ action + attempt-chain mapping display"
```

---

## Task 9: Include `Resent` attempts in the Excel export

**Files:**
- Modify: `src/lib/adv/advance-queue-service.ts` (the `buildAdvanceErpWorkbook` / export builder)

Goal: the exported sheet must let Accounting see superseded PVs. Simplest reliable approach: add a "สถานะ Attempt" note by joining `AccAdvanceErpAttempt`, or append `Resent` rows below the current ones.

- [ ] **Step 1: Add a helper to fetch Resent doc-nos per request**

In `advance-queue-service.ts`, add (near the other queries):
```ts
export async function listResentDocNos(requestIds: number[]): Promise<Map<number, string[]>> {
  const map = new Map<number, string[]>();
  if (requestIds.length === 0) return map;
  const pool = await getAccPool();
  const ph = requestIds.map((_, i) => `@r${i}`).join(",");
  const req = pool.request();
  requestIds.forEach((id, i) => req.input(`r${i}`, sql.Int, id));
  const r = await req.query(`
    SELECT RequestId, ErpDocumentNo FROM [dbo].[AccAdvanceErpAttempt]
    WHERE Status='Resent' AND RequestId IN (${ph}) ORDER BY AttemptNo`);
  for (const row of r.recordset as Record<string, unknown>[]) {
    const id = row.RequestId as number;
    const doc = (row.ErpDocumentNo as string) ?? null;
    if (!doc) continue;
    const list = map.get(id) ?? [];
    list.push(doc);
    map.set(id, list);
  }
  return map;
}
```

- [ ] **Step 2: Add a "PV เดิม (Resent)" column to the workbook**

In `buildAdvanceErpWorkbook`, before building rows, look up the resent map for the exported ids and add a trailing column:
```ts
  const resent = await listResentDocNos(rows.map((r) => r.id));
  const columns = ["เลขที่", "Company", "ผู้รับเงิน", "รายละเอียดค่าใช้จ่าย", "วันจ่าย", "จำนวน", "External Doc.", "Doc No. (ERP)", "PV เดิม (Resent)", "วันที่ส่ง", "สถานะ"];
  // …and in each row's cell array, insert after the "Doc No. (ERP)" cell:
  //   (resent.get(r.id) ?? []).join(", ") || "—"
```
Keep the money-column index correct: it currently points at "จำนวน" (index 5); inserting the new column *after* "Doc No. (ERP)" keeps index 5 unchanged. Verify the styling code that references the money column still targets "จำนวน".

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/adv/advance-queue-service.ts
git commit -m "feat(ap-2): export includes superseded (Resent) PV numbers"
```

---

## Task 10: End-to-end verification (Playwright, UAT mode) + push

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Run the unit test suite**

Run: `npm test`
Expected: all tests pass, including `advance-erp-attempt-service.test.ts`.

- [ ] **Step 3: E2E — send → Sent + attempt #1**

In the Playwright browser (UAT mode), pick an Approved AP-2 advance in "รอส่ง", send it. Verify via mssql-rocks MCP:
```sql
SELECT AttemptNo, ErpDocumentNo, Status FROM [Rocks_Portal_Form_UAT].[dbo].[AccAdvanceErpAttempt] WHERE RequestId=<id>;
```
Expected: `AttemptNo=1, Status='Sent'`, `ErpDocumentNo` = the new PV; `AccRequest.ErpInterfaceStatus='Sent'`.

- [ ] **Step 4: E2E — pull back → Resent + back to รอส่ง**

In the "ส่งแล้ว" tab, click "ดึงกลับเพื่อยิงใหม่" → confirm. Expected UI: row leaves "ส่งแล้ว", appears in "รอส่ง". Verify DB:
```sql
SELECT AttemptNo, Status, ResentAt FROM [Rocks_Portal_Form_UAT].[dbo].[AccAdvanceErpAttempt] WHERE RequestId=<id>;
-- attempt #1 → Status='Resent', ResentAt set
SELECT ErpInterfaceStatus, ErpDocumentNo FROM [Rocks_Portal_Form_UAT].[dbo].[AccRequest] WHERE Id=<id>;
-- ErpInterfaceStatus=NULL, ErpDocumentNo=NULL
```

- [ ] **Step 5: E2E — change payment date → re-send → attempt #2 Sent**

On the pulled-back "รอส่ง" row, pick a later Payment Date, then send again. Verify:
```sql
SELECT AttemptNo, ErpDocumentNo, Status FROM [Rocks_Portal_Form_UAT].[dbo].[AccAdvanceErpAttempt] WHERE RequestId=<id> ORDER BY AttemptNo;
-- #1 Resent (DocX), #2 Sent (DocY, different number)
```
Expected: the new PV's posting date reflects the new Payment Date (spot-check via BC or the send payload log in `AccActivityLog`). Export Excel → the row shows Doc No. = DocY and "PV เดิม (Resent)" = DocX.

- [ ] **Step 6: Guard checks**

- Call pull-back on a non-Sent id → 400 "ดึงกลับได้เฉพาะรายการที่ส่งแล้ว".
- Call payment-date with a date not in `getPaymentDates()` → 400 "วันจ่ายไม่ถูกต้อง".

- [ ] **Step 7: Push the branch**

```bash
git push origin feat/ap-2-advance
```

---

## Self-Review

- **Spec coverage:** table + backfill (T1) ✓; attempt service record/markResent/list (T2) ✓; send-hook (T3) ✓; pull-back route with Sent-guard + reset + no reason (T4) ✓; payment-date route validated against getPaymentDates (T5) ✓; mapping display (T6+T8.4) ✓; รอส่ง picker (T7) ✓; ส่งแล้ว pull-back + chain (T8) ✓; export includes Resent (T9) ✓; E2E send/pull-back/re-send/date + guards (T10) ✓. No-BC-mutation honoured throughout. Already-posted case intentionally out of scope (spec §2).
- **Placeholders:** UI steps (T7/T8) intentionally flag `reloadQueue()` and the detail-panel location as "match the existing function/placement" because the exact identifiers live in the large `AdvanceErpQueue.tsx` — the implementer must read the file and bind to the real names. All backend code is complete and exact.
- **Type consistency:** `recordSentAttempt(requestId, documentNo, environment, company, userId)` used identically in T2 and T3; `markResent(requestId, userId)` in T2 and T4; `listAttempts` shape matches the GET route (T6) and the display (T8). `getAccPool`/`sql` imported from `@/lib/adv/pool` everywhere. Money-column index preserved in T9.
```
