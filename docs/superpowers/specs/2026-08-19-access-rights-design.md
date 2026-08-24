# สิทธิ์เข้าถึง (Access Rights) for AP-1 and AP-17 — design

**Status:** designed 2026-08-19, not yet implemented. Queued behind the AP-4
branch (`feat/ap-4-reimbursement`), which is mid-flight and is editing two of
the files this work needs.

**Goal.** Bring AP-1's settings in line with ACC Portal — the tab order, the
`ผู้อนุมัติบัญชี` → `สิทธิ์เข้าถึง` rename, and per-approver settings-tab
grants — and give AP-17 an access list of its own so its queue and report
disappear for anyone not on it.

---

## 1. Two facts that shape everything below

### 1.1 ACC Portal and Form Portal share one physical database

Measured 2026-08-19: both `.env.local` files name `MSSQL_HOST=203.151.136.161`,
and ACC Portal's `RF_FORM_DATABASE` defaults to `Rocks_Portal_Form` — the same
database `MSSQL_FORM_DATABASE` names here. `AccApprover` rows are **the same
rows** in both apps.

Consequences, all deliberate:

- Adding or deactivating an approver in Form Portal changes who can act in ACC
  Portal, and vice versa. That is the intended behaviour — one roster, one
  source of truth — but it must be written down, because CLAUDE.md's "Shared
  with Rocks Fast" section currently describes only the *Rocks Fast* sibling
  and does not mention ACC Portal at all.
- Any write must go through `writeBothPools` (`src/lib/acc/dual-write.ts`) like
  every other shared master table, or Production and UAT drift and
  `npm run check:alignment` fails.

### 1.2 `AccApproverSettingsTab` already exists here

`migrations/059_portal_form_baseline.sql:62` creates it; it is listed in
`scripts/checks/verify-master-alignment.ts:54` among the dual-written shared
tables and in `scripts/seed-portal-form.ts:62`. ACC Portal's own source says
so out loud:

> `AccApproverSettingsTab` exists in both form databases (migration 059) but
> ACC Portal is its only writer anywhere — Form Portal neither reads nor
> writes it.

**So the AP-1 half of this work needs no migration.** It is wiring, not schema.

---

## 2. AP-1 — match ACC Portal

### 2.1 Tab order and label

`src/app/(dashboard)/request/accounting/settings/page.tsx`. Today:

```
เบิกวันซ้ำข้ามแบรนด์ · ผู้อนุมัติบัญชี · พาหนะ & เรท · แบรนด์ที่เบิกได้ · Interface ERP · แผนก (HR ↔ ERP)
```

Target — ACC Portal's order, verbatim, including `แบรนด์ที่เบิก` losing its
`ได้` and `approvers` moving last under a new name and a `ShieldCheck` icon:

```
แบรนด์ที่เบิก · เบิกวันซ้ำข้ามแบรนด์ · พาหนะ & เรท · แผนก (HR ↔ ERP) · Interface ERP · สิทธิ์เข้าถึง
```

The `TabKey` union keeps its existing keys — only the labels, the icons and
the array order change, so no bookmarked `?tab=` link breaks. `parseTabKey`'s
fallback moves from `approvers` to `brands`, matching the new first tab.

### 2.2 The access endpoint grows three fields

`/api/request/accounting/access` returns `{ account, approver }` today. Target,
matching ACC Portal's contract exactly:

```ts
{ account, approver, admin, settingsTabs: string[], canSettings: boolean }
```

- `approver` — an active `AccApprover` row. Unchanged.
- **`account` changes meaning**: from `isAdminRole(role) || isAccApprover(email)`
  to the approver roster **alone**. This is the "ถ้าไม่ใช้งานจะไม่เห็นเมนู"
  requirement, and it is a *reduction*: an IT/System Admin who is not on the
  roster stops seeing `รายงาน`. They keep `ตั้งค่า`, so they can always grant
  themselves — no one can lock themselves out.
- `admin` — `isAdminRole(role)`.
- `settingsTabs` — the grantable tabs this **non-admin** approver may open;
  `[]` for admins, who see everything.
- `canSettings` — `admin || settingsTabs.length > 0`.

Port `src/lib/acc/settings-tabs.ts` and `approver-settings-tabs.ts` from ACC
Portal. Five tabs are grantable — `brands`, `sameDayBrand`, `vehicles`,
`departments`, `erpInterface`. **`approvers` is not**: the tab that hands out
access stays admin-only, or a granted approver could grant themselves the rest.

One behaviour to preserve on the port: when the table is missing,
`loadSettingsTabsByApproverIds` degrades to **empty**, never permissive. A
permissive default would open the settings page to every approver.

### 2.3 Hub cards

`src/app/(dashboard)/request/accounting/page.tsx`:

| Card | Today | Target |
|---|---|---|
| อนุมัติ (บัญชี) | `approverOnly` | `canAccount` — same set, new name |
| รายงาน | `accountOnly` (admin **or** approver) | `canAccount` (approver only) |
| ตั้งค่า | `adminOnly` | `isAdmin \|\| canSettings` |

A viewer who matches nothing sees ACC Portal's message rather than an empty
grid: *ไม่มีสิทธิ์เข้าถึงโมดูลนี้ — กรุณาติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์ผู้อนุมัติบัญชี*.

---

## 3. AP-17 — its own access list

**Decided 2026-08-19: AP-17 gets its own roster, not AP-1's.** ACC Portal
reuses `AccApprover` for both forms; we are deliberately not copying that. A
person who arranges hotel bookings should not thereby gain the travel-expense
approval queue, and the reverse. It also matches AP-4, whose
`AccReimburseApprover` (migration 090) is already a per-form roster — so after
this, all three forms follow one rule.

### 3.1 New table

`AccBookingApprover`, modelled on `AccReimburseApprover` rather than on
`AccApprover`, because that is the newer and stricter shape:

```sql
CREATE TABLE [dbo].[AccBookingApprover] (
  [Id]          INT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_AccBookingApprover] PRIMARY KEY,
  [StaffId]     INT NOT NULL CONSTRAINT [UQ_AccBookingApprover_StaffId] UNIQUE,
  [Email]       NVARCHAR(200) NOT NULL,
  [DisplayName] NVARCHAR(200) NOT NULL,
  [IsActive]    BIT NOT NULL CONSTRAINT [DF_AccBookingApprover_Active] DEFAULT (1),
  [CreatedBy]   INT NULL,
  [CreatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApprover_Created] DEFAULT (SYSDATETIME()),
  [UpdatedBy]   INT NULL,
  [UpdatedAt]   DATETIME2(7) NOT NULL CONSTRAINT [DF_AccBookingApprover_Updated] DEFAULT (SYSDATETIME())
);
```

Applied to **both** `Rocks_Portal_Form` and `Rocks_Portal_Form_UAT`. It is a
shared master table, so it is dual-written and must be added to
`verify-master-alignment.ts` — which takes the list from 19 to 20 — and to
`seed-portal-form.ts`. It carries no identity floor, exactly as
`AccReimburseApprover` does not: migration 064's `>= 900000` check covers only
the 23 transactional tables 061 reseeded, and a floor here would reject every
dual-write, which inserts production's id into UAT explicitly.

**Seeding is not optional.** The table starts empty, and the moment the gate
goes live an empty roster hides the queue and the report from everyone. Seed it
from whoever runs AP-17 today, in the same migration, or ship the settings tab
first and the gate second.

### 3.2 A `สิทธิ์เข้าถึง` tab under AP-17 settings

`travel-booking-settings/page.tsx` gains a fifth tab after the four option
lists:

```
เหตุผลการเดินทาง · ที่พัก · การเดินทาง · เช่ายานพาหนะ · สิทธิ์เข้าถึง
```

Admin-only, and **not** grantable per-tab — AP-17's per-tab grants are out of
scope, matching ACC Portal, which has none either. The panel reuses AP-1's
`ApproverSettings.tsx` shape (AD user search, activate/deactivate as a soft
delete) against the new table.

### 3.3 Gating

New `/api/request/travel-booking/access` returning `{ account, approver, admin }`
— deliberately its own endpoint rather than a field bolted onto AP-1's, so the
two forms' access questions never have to be asked together.

`travel-booking/page.tsx`: `คิวจองที่พัก/ตั๋วโดยสาร` and `รายงาน` move from
`accountOnly` (admin **or** approver) to the AP-17 roster alone; `ตั้งค่า`
stays `adminOnly`.

**The server must be gated too, not only the cards.** Hiding a card is not
authorization. The AP-17 queue, report and export routes each need the same
check — today several of them accept any `canAccessAccountArea` caller.

---

## 4. AP-4, for consistency

AP-4's `AccReimburseApprover` already exists and has **no editor** — the
approval chain currently refuses everyone. Task 8 of the AP-4 plan owns that
panel; it should be built to the same shape as §3.2 so the three forms read
alike.

---

## 5. What this does not do

- No per-tab grants for AP-17 or AP-4. AP-1 only, matching ACC Portal.
- No change to who may *submit* any form. This governs the admin and approval
  surfaces only.
- No change to `AccApprover`'s own columns, so ACC Portal needs no redeploy.

## 6. Risks

1. **The `account` narrowing is a live permission reduction across a shared
   database.** Anyone relying on admin-role access to AP-1's report loses it at
   deploy. Check who is on `AccApprover` before shipping.
2. **An empty `AccBookingApprover` hides AP-17's queue from everyone.** See
   §3.1 — seed with the migration.
3. **Two apps, one roster, one UI each.** Form Portal's `สิทธิ์เข้าถึง` tab
   and ACC Portal's edit the same rows with no locking. Last write wins on a
   simultaneous edit; acceptable for a roster changed a few times a year, but
   it is a real property and belongs in CLAUDE.md.
