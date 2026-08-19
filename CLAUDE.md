# Form Portal — Developer Guide

> Internal request/forms portal for Rocks Group. Built with Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, MSSQL.
> Cloned from the **Rocks Fast** codebase with Fast Intelligence and Locations removed — see "Shared with Rocks Fast" below before running this alongside that app.

## Quick Start

```bash
npm install
cp .env.example .env.local   # Fill in credentials
npm run dev                   # http://localhost:3081
```

`README.md` carries the same quick start plus the script table and the repo
layout; it is the file to hand someone who has never seen this app.

`npm test` **discovers** its own files: `scripts/run-tests.ts` walks `src/` for
`*.test.ts` and hands them to `tsx --test`. `package.json` used to list every
file by hand, so adding a test and forgetting to list it produced a green run
that had never executed it. Pass paths to run a subset:
`npm test -- src/lib/storage.test.ts`. `npm run typecheck` is `tsc --noEmit`.

Two things about this build that look like faults and are not:

- **`experimental.cpus: 1`** (`next.config.mjs`) holds build and static generation to a single worker instead of one per core — `next build` reports "using 1 worker". Builds are slower on purpose; raise or drop the key to get the cores back.
- **`next-env.d.ts` flip-flops and will keep dirtying your tree.** `next dev` writes `./.next/dev/types/…`, `next build` writes `./.next/types/…`, so whichever you ran last shows as an uncommitted change. Nothing depends on it: `tsconfig.json` includes both paths, and `skipLibCheck` means an unresolved import inside a `.d.ts` never fails the typecheck. Commit it or leave it, but don't go hunting for the cause.

## Architecture

### 3-Database Architecture

| Database | Pool | Purpose |
|----------|------|---------|
| **Fast_Core** | `getCorePool()` | Config, brand/DB/BC connection settings, `FormEnvironment`, `UatTester`. **No longer identity** — see "Auth" |
| **Rocks_Portal_Form** | `getFormPool()` | Form definitions, submissions, approvals, files, logs, and all `Acc*` Accounting tables. Form Portal's own database — `Rocks_Portal_Form_UAT` is the UAT twin, and which one `getFormPool()` returns depends on the form **and on who is asking** (see "Parallel Production and UAT") |
| **Rocks_Portal_Form** (`TeamMember`) | `getProductionFormPool()` via `@/lib/team-member/service` | User identity and roles (migration 066). **Production only** — never the UAT twin, and never `getFormPool()`; see "Auth" |
| **Fast_Data** | `getDataPool()` | Used by Accounting and ERP sync — department maps, travel-booking province lookups, ERP account/dimension sync (`src/lib/acc/department-map-service.ts`, `src/lib/acc/travel-booking/province-service.ts`, `src/lib/acc/travel-booking/request-service.ts`, `src/lib/erp/account-sync.ts`, `src/lib/erp/dimension-sync.ts`). **Not** a BI/reporting database in this app. |
| **Rocks_Portal_HR** | `getHrPool()` → `getAppPool("Rocks_Portal_HR")` | Employee master, manager chain, per-diem allowance history — cross-referenced by StaffId/email |
| **Rocks_Codex** | (cross-DB query, e.g. `[Rocks_Codex].[dbo].[Holiday]`, `[Rocks_Codex].[dbo].[Brand]`) | Holiday calendar, company brand master |
| **Rocks_Portal_Form** (Acc* tables) | `getAccPool()` → `getFormPool()` | Accounting forms: travel expense (AP-1), travel booking (AP-17) |

**IMPORTANT**: Use `new sql.ConnectionPool(config).connect()` for isolated pools. Never use `sql.connect()` (global singleton — causes cross-DB bugs). Pool max is set to 30.

### Parallel Production and UAT

Production and UAT run **side by side in one deployment**. There is no app-wide UAT mode, no separate host, and no build flag. Ordinary users work against `Rocks_Portal_Form` while configured testers work against `Rocks_Portal_Form_UAT` — at the same time, on the same server.

**Two switches, one tester list, and a per-viewer toggle:**

- **Each form has two independent switches** — `ProductionEnabled` and `UatEnabled` in `Fast_Core.dbo.FormEnvironment` (`FormCode`, `ProductionEnabled`, `UatEnabled`, `UpdatedBy`, `UpdatedAt`), set at **Settings → Form Environment** (`/settings/form-environment`, System Admin). **Both can be on at once** — that is the normal pilot state. UAT-only hides the form from everyone who is not testing it; both off closes it to new work entirely. A form with no row is `PRODUCTION_ONLY` (live, not open for testing). Read through `src/lib/form-environment/service.ts` (`getFormSwitchMap`, `setFormFlag`, `listFormEnvironments`). It lives in Fast_Core on purpose: resolving the switches must not depend on which form database is selected. *(The old single `Environment` string column was dropped by migration 065.)*
- **UAT is visible only to configured testers.** `Fast_Core.dbo.UatTester` (migration 063) holds the list, managed at **Settings → UAT Users** (`/settings/uat-users`, System Admin, API `/api/settings/uat-users`). Each tester carries a UAT `ManagerStaffId`, which must itself be an active tester — a chain cannot leak out of the test group. **A tester may be their own manager**, deliberately: that is how one person rehearses the whole submit-to-approve loop, and a UAT approval only ever approves test data. Removing a tester is a soft delete (`IsActive = 0`). Service: `src/lib/uat-tester/service.ts`.
- **A tester must also turn their own UAT mode on** with the **PRO/UAT switch** in the navbar (`src/components/layout/UatModeSwitch.tsx`), which renders only when they are already in UAT mode, or are an active tester *and* at least one form has `UatEnabled`. It POSTs `/api/uat-mode` — the only writer of the `form-portal-uat-mode` cookie (`src/lib/uat-mode.ts`), httpOnly, and 403 for anyone who is not an active tester.

**Resolution order** (`src/lib/form-environment/`), in this order:

1. **The record's id wins.** UAT transactional identities start at 900000 (`isUatId`, `uat-identity.ts`), so a bare id names its own database. Bounded by `boundIdEnvironment`: a **UAT** id is honoured only while the form still has `UatEnabled`, or the viewer is a tester in UAT mode, so switching UAT off actually closes it. A **Production** id is never bounded.
   **Selecting a database is not authorization.** An id ≥ 900000 routes the request to `Rocks_Portal_Form_UAT`; whether the person asking may read or act on what it finds is then decided separately by `decideRequestRead` / `decideRequestMutate` (`src/lib/acc/request-acl-policy.ts`), which refuse **anyone who is not an active `UatTester`** on a UAT record — with a 404, so the record's existence is not confirmed either. That restores the rule the design spec states and the routes did not enforce: *the whole approval chain of a UAT request stays inside the tester group* (`docs/superpowers/specs/2026-08-18-parallel-uat-design.md`). Nothing legitimate is lost — a tester's UAT manager is already required to be an active tester — but at least one `AccApprover` must be on the tester list or UAT requests stall at the ACCOUNT step, which the UAT Users page says out loud. It is **membership, not the cookie**: a tester with UAT mode off still reaches a UAT record by id, which is what makes their own test work openable from a link.
2. **The viewer's UAT mode** — cookie **and** live `getActiveUatTester()` membership, re-checked on every resolve (`viewerIsTesting`). The cookie alone is a forgeable hint.
3. **The form's switches** — `pickEnvironment` picks the one switch that answers for this viewer.

Who is asking comes from the proxy's `x-pathname` and `x-user-email` headers, **never `auth()`** — `getFormPool()` imports `src/lib/form-environment`, so a session lookup would close the loop `getFormPool → auth → jwt → getFormPool`. Code with no request scope (scripts, background work) resolves to Production.

Since migration 066 that is a hard constraint, not a preference: `auth()` no longer reads Fast_Core, it reads `TeamMember` in the form database. Everything on the path that decides *which* form database answers must therefore come from a pool this resolver does not pick — `getFormSwitchMap()` and `getActiveUatTester()` from `getCorePool()`, identity from `getProductionFormPool()`. **`FormEnvironment` and `UatTester` must stay in Fast_Core**, and `@/lib/team-member/service` must never reach for `getFormPool()`.

- **Availability and writability are different questions.** `pickEnvironment().available` asks "may this person reach the form", and an id makes it unconditionally true so records stay readable and approvable. `environmentWritable` asks "is that database still taking new work". Use `resolveCurrentFormAccess()` + `resolveCurrentFormWritable()` on a form's own route, and `resolveFormAccess(formCode, requestId?)` + `resolveFormWritable(...)` to ask about a form from somewhere else (Home, the manager card). **`assertFormWritable()` (`src/lib/uat-tester/guards.ts`) has exactly six call sites** — a `saveDraft` and a submit for each of AP-1, AP-17 and AP-4, in the three `request-service.ts` files. AP-4's `delete-service.ts` deliberately has none, and says why: the guard asks whether the database is still taking *new work*, and withdrawing a draft from a closed form is not that.
- **The manager differs by environment.** UAT routes to the requester's `UatTester.ManagerStaffId`, re-verified at submit time (still an active tester, still active in HR — self is allowed); Production reads `Rocks_Portal_HR.Employee.ManagerStaffId`. **UAT refuses rather than falling back to HR** — a real manager must never find test data in their queue. Three resolvers, keyed on the *resolved environment* and never on the cookie: `resolveManagerInfo()` (the preview card, shared), and a separate `withUatManager` for each form's submit — `resolveRequesterForActor` in `src/lib/acc/employee-context.ts` (AP-1) and `resolveEmployeeForActor` in `src/lib/hr/employee-lookup.ts` (AP-17). `resolveManagerEmail()` is deliberately *not* overridden.
- **Mail follows the resolved environment**, with one exception: a recipient who is an **active tester gets the mail at their real address** with a `[UAT] ` subject prefix. Everyone else is redirected to `UAT_MAIL_REDIRECT` (falling back to `GRAPH_MAIL_FROM`) with a banner naming the intended recipient. If neither is set, `applyUatRedirect` (`src/lib/acc/email-queue.ts`) throws and the row stays queued rather than mailing a real person. The sweep endpoint drains both databases (`processQueueBoth`); per-action drains are single-pool.
- **Business Central follows the same resolution**: `resolveEffectiveErpEnvironment()` (`src/lib/acc/erp-environment.ts`) maps UAT → Sandbox, otherwise Production. No separate ERP toggle — the navbar chip and the global `AppSetting` switch were removed on 2026-08-17. Which BC company and connection Sandbox uses is set at Settings → ERP Interface Environment. **The send echoes and verifies both its environment and its batch**, answering 409 on either drift (`ENVIRONMENT_STALE_ERROR` in the route, `ErpQueueDriftError` from `src/lib/acc/erp-interface-send.ts`) so the client reloads instead of retrying something that cannot succeed.
- **The send claims the batch atomically, and an unknown remote outcome is never retried.** Both properties were missing until 2026-08-19 and either one costs duplicated financial journals:
  - `claimRequestsForSend` takes the whole exact id set in one conditional `UPDATE` inside a transaction and requires `rowsAffected === requestIds.length`; a partial or zero claim rolls back and answers 409 **before** any external I/O. What it replaces read the statuses, then marked rows Pending one at a time with a conditional predicate whose row count was discarded — so two clicks on the same ready batch both passed and both posted.
  - the outcome is classified rather than assumed. `BcJournalPostError.definitelyRejected` (4xx — BC refused, nothing created) releases the claim to retryable `Failed`. A 5xx, a timeout or a dropped connection, and a BC success whose local `Sent` write then fails, both go to `holdForReconciliation`: the rows stay **`Pending`** with the reason in `ErpInterfaceError` and an `erp_interface_unknown` activity row, and the pre-send check refuses `Pending` outright, so nothing posts them again until a person has looked in BC. The route answers 409 (`ErpReconciliationRequiredError`) rather than 400's retry affordance. `Pending` is used as the reconciliation state because `CK_AccRequest_ErpInterfaceStatus` permits only Pending/Sent/Failed — a new value would need a migration applied to both databases before the code could ship.
- **ERP Prep is classified `AP-1`, not `BOTH`**: it is the only path that posts to BC, and the send reads its rows from a single pool. While AP-1 resolves UAT for you, the prep queue you see is the UAT queue.
- **Process-global caches are environment-keyed.** `src/lib/acc/acc-cache.ts` is a shared `Map`; anything derived from a form-pool read must carry the environment in its key — `acc:journal-ctx:{Production|Sandbox}` (`erp-journal-context.ts`) and `acc:prep-dept-ctx:{Production|UAT}` (`erp-prep-service.ts`). Request-scoped react `cache()` memos are not global and are unkeyed by design.
- **The running number floor is a function of the environment.** `UAT_SEQUENCE_FLOOR = 9000` in `src/lib/acc/sequence.ts`: UAT's first number of a year is `09001`, Production's `00001`. Applied only when a `(Prefix, Year)` row is first created, so it never rewinds. The two series stay disjoint only while Production issues ≤ 9000 numbers per prefix per year.
- **Ids never collide**: migration 061 seeds UAT transactional identities at 900000 across 23 transactional tables, and **migration 064 adds a `CHECK (Id >= 900000)`** so a restore or an ad-hoc reseed cannot silently break the property the id rule depends on.
  - **AP-4's three transactional tables are deliberately not among them, and do not need to be.** `AccReimburse`, `AccReimburseItem` and `AccReimburseRuleAck` (migration 088) start at 1 in both databases. The floor exists so that *an id in a URL* names its own database, and none of theirs ever appears in one — every AP-4 route is keyed on `AccRequest.Id` or `AccRequestFile.Id`, both of which 061 and 064 do cover. Adding a floor here would buy nothing and would have to be applied to a database that already holds rows.
- **Attachments** land under `{SHAREPOINT_ACC_FOLDER}/_UAT/{formCode}/...` — the `_UAT` segment sits between the base folder and the form code (`buildAccFolderPath`, `src/lib/acc/sharepoint-path.ts`).
- **Every new route under `/api/request` needs a rule** in `ROUTE_RULES` (`classify-path.ts`, longest matching prefix → `AP-1 | AP-4 | AP-15 | AP-17 | "BOTH" | null`). Without one it silently falls through to Production. The coverage panel on the settings page lists any route no rule covers — `matchRule` is what tells "no rule at all" apart from "a rule that deliberately says Production".
  - **AP-4's settings routes classify `AP-4`, not `null`** — the opposite of `/api/request/accounting/settings`, deliberately. `/api/request/reimburse/settings/rules` with no query string is the **form's own** checklist source, and the ticks it produces become `AccReimburseRuleAck` rows with an FK into whichever database the form resolved to. Production treatment would have a UAT tester's form read production's rule ids while writing acknowledgements into UAT. The reason first recorded for this — that AP-4's rule and approver tables are not dual-written — is **false**; they are, and they are the two tables that took the shared list from 19 to 21. The conclusion survives the premise, which is why the real reason is written down here and in `classify-path.ts`: the next person to notice the inconsistency will otherwise remove it.
- **Shared configuration is dual-written**, not duplicated by hand: `src/lib/acc/dual-write.ts` runs each master-table mutation against both databases in a transaction, and `npm run check:alignment` asserts the **21** shared tables still match (`scripts/checks/verify-master-alignment.ts` holds the list; AP-4 added `AccReimburseRule` and `AccReimburseApprover` to the 19 that were there before). Those tables are deliberately absent from 061/064: they are not transactional, their ids must be **identical** in both databases rather than disjoint, and a floor of 900000 in UAT would reject every write.
  - **Nothing copies production's id into UAT.** `writeBothPools` runs the *same* statement against each database and reads no id back — the only `OUTPUT INSERTED.Id` on this path is `brand-erp-interface-map-service.ts`, using it as its own return value on the production side. Matching ids rest entirely on **the two identity counters staying in lockstep**: both databases were seeded from the same script with identity preserved, and every insert since has arrived through here.
  - **That lockstep can break with no hand-editing and no error, and it is not transactional.** SQL Server allocates an identity value outside the transaction. If the production INSERT succeeds and the UAT one throws, `writeBothPools` rolls both back correctly — but production's counter has already advanced and UAT's has not. Every id allocated afterwards differs by one, permanently and silently. `check:alignment` is what detects it, and only when somebody runs it; run it after any dual-write failure, not just when approvers or vehicles look wrong.
  - **AP-4 raised the cost of that drift.** `AccReimburseRuleAck` records which rule a requester ticked *by id*, so drifted counters re-point an acknowledgement at **different rule text** — a compliance record attributing an agreement the person never made. The other shared tables' worst case is a mismatched vehicle or approver row; this one is materially worse.
  - **Dual-writing `AccReimburseApprover` means the AP-4 approver pool is not per-environment.** Adding someone so they can rehearse the accounting steps in UAT also makes them a production approver of real reimbursement payments. `AccApprover` has had exactly this property all along and it is accepted rather than a defect — recorded here so it is read rather than discovered.
- **Only two endpoints merge both databases** through `src/lib/acc/query-both.ts`: `/api/request/accounting/requests/mine` and `/api/request/accounting/work` — what a person owns or must act on. Sorting and paging happen after the merge, each row carries an `environment` tag, and `keepRowsInCurrentEnvironment` (`current-rows.ts`) then drops rows whose database is not where that form resolves for this viewer today. Nothing is deleted; flipping the switch back brings the rows straight back. **Reports do not merge** — a report is a statement about one set of books, so `/api/request/accounting/report` and its Excel export read one database only.
- **Switching a form does not move its existing requests.** They stay in the database they were written to and stay readable; only new writes go elsewhere.

### Auth

- Microsoft Entra ID (Azure AD) via NextAuth 5
- Session: `{ user: { id, name, email, role, nickname, color, photo } }` — no `hasIntel` flag (Intelligence is gone)
- Roles: `Staff | IT Admin | System Admin | Viewer`
- TeamMember lookup from **`Rocks_Portal_Form.dbo.TeamMember`** (migration 066), never Fast_Core; a missing row is provisioned at login (`provisionTeamMember`) so drafts stay owned by their creator
- **Sign-in fails closed, and a session without a positive internal id is not a session.** Three things changed on 2026-08-19:
  - `lookupTeamMemberForLogin` (`src/lib/team-member-lookup.ts`) returns `found | not_found | unavailable` instead of collapsing a database error to `null`. `signIn` denies on `unavailable`. The old `null` was read as "not a TeamMember", which sent the callback on to ask HR — and if *that* threw too, the outer catch granted a `Staff` session and returned `true`. An enabled Entra account in neither roster signed in successfully whenever the authorization source was down.
  - the HR lookup is wrapped in its own `try`, and the outer catch no longer grants anything. Entra proves *who* someone is; whether they may use this app is a question only the roster and HR answer, and that branch runs when neither could be asked. Graph photo/display-name enrichment keeps its own inner `catch`, so it stays optional.
  - provisioning failure denies the login instead of completing it with `user.id = ""`, and an existing **inactive** row denies rather than being provisioned around.
  - `requireAuth()` / `requireRole()` now require a positive integer `session.user.id` (`isUsableUserId`, `src/lib/auth-identity.ts`), answering 401 with a sign-in-again message otherwise. `Number("")` is 0, so such a session owns nothing and stamps 0 or NULL into whatever it writes. Tokens minted before this live for 30 days, hence the check at the gate as well as at the source. A *retired* row (jwt clears `userId`) now ends in that 401, which is the intent.
- Profile photo fetched via client credentials (`getADUserPhoto`) instead of delegated token
- Role hierarchy: System Admin > IT Admin > Staff/Viewer
- **The jwt callback caches the row for 60s** (`src/lib/auth.ts`). `/api/settings/users` clears that cache after `updateRole`, `addUser` and `deleteUser`, so a role change takes effect on the next request instead of a minute later. It is an in-process Map — it invalidates nothing on a second instance.
- **A row that is retired, or missing, downgrades the token to role `Staff`.** Not a logout — `requireAuth()` only needs the email — and the next successful read restores role, id, nickname, colour and photo.
- **`userId` is cleared only for a *retired* row**, where the roster positively says the person has gone. A *missing* row keeps it and logs `[Auth] no TeamMember row for …` (throttled to once a minute per email). The asymmetry is deliberate: `findTeamMemberByEmail` swallows database errors and returns null, so "missing" means *either* the row is gone *or* the form database could not be read. `userId` authorises nothing — it only selects and stamps the caller's own rows — whereas blanking it during an outage writes `Number("") === 0` into `OfficeFormSubmissions.SubmittedBy` (`int NOT NULL`, no FK) and `CreatedBy = NULL` into `AccRequest`, rows their owner can never see again. The role downgrade *does* cost access while it lasts, including the Fast_Core-backed settings pages that stay up when the form database is down; that is accepted over carrying an unconfirmed grant for the token's 30-day life.

#### TeamMember lives in Form Portal's own database

Migration 066 copied all 17 rows out of `Fast_Core.dbo.TeamMember` — ids preserved — into `Rocks_Portal_Form.dbo.TeamMember`, and left Fast_Core's copy untouched and in service for Rocks Fast. Every read and write goes through **`src/lib/team-member/service.ts`**, the single access point; no SQL elsewhere names the table. It uses `getProductionFormPool()`, never `getFormPool()` — identity must not vary with the route's environment, and 066 is deliberately **not** applied to `Rocks_Portal_Form_UAT`.

**What this bought, and what it did not:**

- ✅ **Identity and roles are no longer shared with Rocks Fast.** A role change here no longer lands in that app, and vice versa.
- ❌ **It did not remove the Fast_Core dependency.** `getCorePool()` still has more than forty call sites across a dozen modules, and two of them cannot move: `getFormSwitchMap()` (`src/lib/form-environment/service.ts`) and `getActiveUatTester()` (`src/lib/uat-tester/service.ts`) resolve *which* form database answers, so they must read a database that resolver never picks — see "Parallel Production and UAT". The app still cannot serve a request without Fast_Core.

**The two rosters diverge from the cut onward. This was accepted, not solved:**

- Both apps provision at login independently (`provisionTeamMember` in each), so a new joiner gets an unrelated row in each database.
- Form Portal's new ids start at **100001** (066 reseeds the identity to 100000); Fast_Core carries on from **2009** (`IDENT_CURRENT` on its table is 2008). An id therefore says which app created the row, and the two ranges can never collide — but an id minted in one app matches nothing in the other. The 17 shared ids are **not** a contiguous block: they are spread across 1..2008 (1-6, 1006-1013, 2006-2008). There is no low-water mark that separates "copied from Fast_Core" from "minted here" — only being above 100000 tells you that.
- **Granting System Admin, or any role, has to be done in both apps.** `/settings/users` writes only `Rocks_Portal_Form`.
- Deactivating someone in one app leaves them active in the other. Same for a name resync.
- Anything that joins `[Fast_Core].[dbo].[TeamMember]` is now reading the other app's roster. Migrations `024` and `058` still do, and `001` creates and seeds that table outright, which is why `001`, `024` and `058` all carry a **do not re-run** header. `001` is the dangerous one: its first batch is nothing but `USE [Fast_Core];`, and `apply-sql.ts` splits on `GO` and runs every batch on one pool, so the `USE` carries into the later batches whenever the pool hands back the same connection and `--db` is quietly ignored. Its last batch seeds a **System Admin** row, a no-op today only because of an `IF NOT EXISTS` on one hard-coded email.
- **`ManagerId` is unmaintained here, and now unread.** Nothing in this app writes it — `provision()` and `addOrReactivate()` both omit the column — and 066 copied exactly one populated row out of 17. Its only reader was Form Builder's `submitter_manager` workflow step, which is gone with that feature, so `managerIdOf()` and `firstActiveWithRole()` were removed from `src/lib/team-member/service.ts` along with it. A DBA curating `ManagerId` by hand in Fast_Core reaches nothing here. AP-1 and AP-17 are unaffected: their manager comes from `Rocks_Portal_HR.Employee.ManagerStaffId`, or from `UatTester.ManagerStaffId` in UAT.

### Authorization — one policy per question

Added 2026-08-19 in response to a security review. Before it, authorization on
the Accounting routes was per-route and, on the direct-by-id paths, absent:
`GET /api/request/accounting/requests/[id]` returned a full claim to any
authenticated session, `GET .../files/[fileId]` streamed any numeric file id,
`POST .../requests/[id]/files` attached to anyone's request, and
`POST .../submit` submitted it. The list endpoints were scoped, so the data was
reachable only by guessing a small integer — which is not a control.

Five shared modules now answer five distinct questions. **Route handlers must
call them rather than inventing a weaker local rule**, and each has a pure,
import-free half so it is unit-tested without a database (`@/env` validates the
whole environment at import time, so anything reachable from a pool drags a live
configuration into the test run):

| Question | Module | Notes |
|----------|--------|-------|
| May this person see / change this request? | `src/lib/acc/request-acl-policy.ts` (pure) + `request-acl.ts` (pools) | `authorizeAccRequest(session, id, "read" \| "mutate")` is the two-line route helper. Read: owner, on-behalf requester, assigned manager, or account area. Mutate: creator only, `Draft`/`Returned` only. Plus the UAT tester barrier — see "Parallel Production and UAT". |
| Are these bytes actually a receipt? | `src/lib/acc/attachment-guard.ts` | Magic-byte allowlist (PNG/JPEG/GIF/WEBP/HEIC/PDF); `File.type` is a hint only. `attachmentResponseHeaders` re-sniffs on download and serves anything non-raster as `attachment` with `nosniff` and a `sandbox` CSP. AP-1 passes `allowedKinds: ["image"]`, AP-17 also takes PDF. |
| Whose national-ID scan is this? | `src/lib/acc/travel-booking/id-card-access.ts` | Data subject only, for granting consent, listing, downloading and reusing. Sharing a department is not consent. |
| Are these books this approver's? | `src/lib/acc/approver-interface-access-shared.ts` (`canActOnInterfaceTarget` / `canActOnClaimBrand`) | Called on the prep detail, the report export (including its `ids=` form), the ERP send and the ACCOUNT approve/reject — every path that previously relied on the list's row filter. |
| Does this booking need an Admin? | `src/lib/acc/travel-booking/derive-flags.ts` | The `needs*` flags are derived from the selected option rows, never from the posted DTO. |

Two supporting pieces:

- **`src/lib/acc/request-errors.ts`** — `AccConflictError` (409) and
  `AccForbiddenError` (403), and `statusForAccError`. The Accounting routes
  answered 400 for everything a service threw, which turned "somebody else
  already submitted this" into the dialog's retryable phase.
- **`src/lib/acc/stored-file.ts`** — `deleteStoredFile` dispatches on
  `StorageBackend`. Three delete paths selected `StoragePath` alone and passed
  SharePoint driveItem ids to `fs.unlink`, then deleted the only row recording
  where the bytes were.

**Response semantics**, used consistently: `400` invalid input, `401`
unauthenticated or no internal id, `403` unauthorized, `404` unauthorized where
confirming existence is itself the leak (UAT records, another person's ID card),
`409` stale or already processed, `413` too large, `502/503` upstream. An
unauthorized or stale path must not mutate the database, storage, mail or ERP.

**The Host header is not an authorization input.** `isManagerDevBypassHost`
(`src/lib/acc/manager-auth.ts`) used to let any signed-in user action the AP-1 /
AP-17 manager step whenever the request arrived with `Host: localhost:3081` —
and `trustHost: true` means Next takes that header as given. It now also requires
a non-production build *and* `ACC_MANAGER_DEV_BYPASS=1`, default off.

**AP-17 still lets an admin action the manager step** (AP-1 deliberately does
not), but it is now recorded: `Actor.onBehalfOfManagerStaffId` makes
`logManagerOnBehalf` write a `manager_acted_on_behalf` activity row naming the
real actor and the manager they stood in for, inside the same transaction as the
approval.

### Theme — Sky

- Palette: **Sky** — pastel cool-blue light theme (`light`) plus a dark counterpart (`dark`, formerly named `gold` in the Rocks Fast original)
- localStorage key: `form-portal-theme`
- Cookie: `form-portal-theme` (persists across sessions; read by the no-flash inline script in `src/app/layout.tsx`)
- Default: `light`
- CSS variables: `var(--bg-card)`, `var(--text-primary)`, etc. — see `src/app/globals.css` for the full token list (defined once under `:root, [data-theme="light"]` and again under `[data-theme="dark"]`)
- Shape and depth: card radius `--radius-card` (14px), tile radius `--radius-tile` (12px); `--shadow-card` rather than heavy borders; tinted icon tiles (`--nav-active-bg` background behind icons); the capsule nav uses Tailwind's `rounded-full`, not a token — `--radius-full` and `--shadow-lift` are defined in `globals.css` but nothing consumes them
- Semantic action tokens live in the `@theme` block, which is where Tailwind 4 sources `text-danger` / `text-warning` and friends: action `#4c74c4` / hover `#3d63b0`, success `#3d8560`, warning `#b5793a`, danger `#c25b5b`. They are single-valued across both themes on purpose — surfaces needing a per-theme value use `--btn-danger-bg`, `--text-danger`, `--status-*` or `--ring-*` instead
- No brand-mark gradient tokens: the navbar mark is `/brandlogo/rocks.png`, not a drawn letter
- Status pills: `--status-{pending,ok,draft,bad}-{bg,text}`
- The `.acc-theme` scope on Accounting pages (`src/app/globals.css`) was retuned from the original's rose accent to Sky; its non-colour rules (hidden scrollbars, suppressed number spinners, `overflow-x: clip`) are unchanged

## Shared with Rocks Fast

Form Portal was cloned from the Rocks Fast codebase and **still shares live infrastructure** with it. This is not a separate environment — treat both apps as one system when operating on shared resources:

- **Databases are no longer shared**: Form Portal owns `Rocks_Portal_Form` (plus `Rocks_Portal_Form_UAT`). `Fast_Form` belongs to Rocks Fast and this app must not read or write it. `Fast_Core`, `Fast_Data`, `Rocks_Portal_HR` and `Rocks_Codex` are still the same shared databases both apps use, in both environments.
- **Identity is no longer shared, but Fast_Core still is.** Migration 066 gave this app its own `TeamMember` in `Rocks_Portal_Form`; `Fast_Core.dbo.TeamMember` stays exactly as it is and stays in service for Rocks Fast. The two rosters now drift apart — see "TeamMember lives in Form Portal's own database" under Auth for what that costs. Fast_Core itself is still shared: `AppSetting`, brand configuration and the DB/BC connection rows are one set of rows both apps read and write, and `FormEnvironment` / `UatTester` are Form Portal's own tables that live there (Rocks Fast has no code for either). **A query in this app that names `[Fast_Core].[dbo].[TeamMember]` is a bug** — it is reading the sibling's user list.
- **⚠️ Same SharePoint folder, and the two apps' paths collide**: Accounting file attachments (`SHAREPOINT_ACC_SITE` / `SHAREPOINT_ACC_FOLDER`) point at the same document library Rocks Fast uses. `buildAccFolderPath` / `buildAccFileName` (`src/lib/acc/sharepoint-path.ts`) carry **no per-app segment**, so since the database split — Form Portal numbering out of `Rocks_Portal_Form`, Rocks Fast out of `Fast_Form` — both apps independently mint the *same* `TOFyy-nnnn`, the same draft ids and the same `AccRequestFile` ids, and therefore write byte-identical paths. `AP-1/_DRAFT/{requestId}/{type}_draft{requestId}_{fileId}.ext` is the worst case: both id spaces start at 1, so overlap there is the norm, not the exception. Two mitigations are in place and neither is a fix: `uploadFileToSharePoint` passes `@microsoft.graph.conflictBehavior=rename` so a second upload no longer replaces the first app's bytes (Graph's default is *replace*, which also hands back the same driveItem id — one requester's ID-card scan served to the other's request), and `moveSharePointFolder` is best-effort so a submit that finds a foreign `_DRAFT` folder cannot throw. Files can still end up filed under the other app's request number. **A real fix needs a per-app folder segment plus a migration of existing rows** — do not add one casually.
- **`AccEmailQueue` is no longer shared** — each app drains the queue in its own database.
- **Form Portal runs on port 3081**, Rocks Fast on 3020, so both can run at once on the same machine. (Form Portal was on 3021, then briefly shared 3020 with Rocks Fast — a period when only one of them could start.) Running them concurrently is safe **for mail** now that `AccEmailQueue` lives in each app's own database; while the queue was shared, two running apps could drain it and send approval/payment emails twice. It is **not** safe for SharePoint attachments — see the shared-folder bullet above; the port change makes simultaneous operation normal and so makes that path collision routine rather than rare.
- **`UPLOAD_ROOT`** — local attachment storage env var, and **dead configuration in this app: leave it unset.** Attachments go to SharePoint, and local disk only ever served Accounting rows created *before* SharePoint storage existed. Those rows live in `Fast_Form`, the sibling's database — measured 2026-08-19, `Rocks_Portal_Form` holds **zero** `AccRequestFile` rows and `Rocks_Portal_Form_UAT` holds 2, all `StorageBackend = 'sharepoint'`. So no code path reaches the local branch: `files/[fileId]` dispatches on `StorageBackend` and only calls `downloadFile()` for a non-`sharepoint` row, of which there are none. Unset it resolves to `{cwd}/uploads/forms`, which is harmless precisely because nothing reads it. **Every path is still containment-checked**: `resolveStoragePath` (`src/lib/storage.ts`) resolves against the root and compares with `path.relative`, so a stored `StoragePath` that escapes it raises `StoragePathError` on read, write *and* delete rather than being followed. `path.join` alone normalised `..` away and resolved happily outside the root.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) — host-and-port matched allowlist (`["localhost:3081", "127.0.0.1:3081"]`) gating two things: the `devHostOnly` management/settings cards in `REQUEST_CARDS` (`src/lib/constants.ts`) and the manager-approval dev bypass in `src/lib/acc/manager-auth.ts` (`isManagerDevBypassHost`). If this app's port ever changes, this list must be updated or both gates silently disappear.
- **`src/lib/brand-config.ts` is deliberately frozen** — it still contains Dashboard-DB helper fields (`dashboardDbConnectionId`, `dashboardDatabaseName`) with no callers in this app; the Rocks Fast sibling reads them for its Intelligence dashboards. The Brand Configuration settings page hides those fields in the UI but still round-trips their values on save, so Rocks Fast keeps working. **Do not "clean up" these fields** — they are load-bearing for the sibling app even though nothing in Form Portal consumes them.

## Navigation

Top bar and mobile tabs: **Home** · **My Requests** · **My Work** · **Settings** (Settings for IT Admin/System Admin only). Labels are English; in-page copy is Thai.

Only the middle two live in `NAV` (`src/lib/constants.ts`). Home and Settings are composed onto either side of it in `Navbar.tsx`'s `visibleNav` — Home as a literal, Settings behind `canAdmin` — so **adding an entry to `NAV` puts it between them**, not at the end.

- **`Home`** (`/`) — a form catalogue: greeting and stat strip, search, "Continue where you left off" (resumable drafts and Returned requests), then the **Accounting** forms — AP-1 travel expense, AP-17 travel booking and AP-4 staff reimbursement, filtered to the ones available to this viewer. It is a link surface only: it creates no API of its own beyond reading `/api/form-environment` for availability. `src/features/home/HomeCatalogue.tsx`.
  - **Home's card list is its own, not a filter over `REQUEST_CARDS`.** `ACCOUNTING_FORMS` in `HomeCatalogue.tsx` and `REQUEST_CARDS` in `src/lib/constants.ts` are two hand-kept lists, and a form added to one alone appears on only one surface. Environment filtering needs nothing extra either way: `/api/form-environment` resolves every code any `REQUEST_CARDS` badge names.
  - **"Continue where you left off" is still AP-1 and AP-17 only.** `useHomeData` fetches those two drafts endpoints and `ResumableGroup.formCode` is typed to the pair; `/api/request/reimburse/requests/drafts` exists and is not read, so an AP-4 draft is resumable from the form page but is not offered here.
- **`My Requests`** (`/my-request`) — the Accounting requests you submitted and their status. Form-agnostic: `listMyRequestRows` filters on ownership, not `FormCode`, so AP-4 rows appear alongside AP-1's and AP-17's, merged across both databases by `src/lib/acc/query-both.ts`.
- **`My Work`** (`/my-work`) — requests awaiting your approval or otherwise involving you.
- **`Settings`** (`/settings`, IT Admin+) — hub of `SETTINGS_CARDS`: Maps & Routing, Database Connections, Business Central, Brand Configuration, **ERP Interface Environment**, **Form Environment** (`/settings/form-environment`), **UAT Users** (`/settings/uat-users`), **Users & Roles** (`/settings/users`) — the bolded four are `systemAdminOnly` — and Accounting Admin, which points at `/request?group=Settings` rather than `/request/accounting`, because the AP-1 hub would leave out AP-17 and AP-4.

**Form Builder is gone.** Its three entry points were removed first (the nav tab, the Manage Forms settings card, Home's general-forms group), and on 2026-08-19 the feature itself was deleted: the eight pages under `/forms`, all sixteen `/api/forms` routes, and `src/features/forms`. It had never been used here — `/api/forms/[formId]/workflow/steps` writes `OfficeFormWorkflows.CreatedBy` and `OfficeFormWorkflowSteps.UpdatedAt`, neither of which exists in migration `002` or `059`, so configuring a workflow always threw — while carrying an unauthenticated-in-practice upload path, an approval-claim that failed open on a null assignee, and no server-side payload validation. Nothing else in the app referenced it: `my-request`, `my-work` and Home are Accounting-only. The `OfficeForm*` tables are **left in place and unread**; no migration drops them.

The navbar also carries the **PRO/UAT switch** (`src/components/layout/UatModeSwitch.tsx`) — see "Parallel Production and UAT" above for when it renders.

Every dashboard route is also gated by `BrandGate` (`src/components/BrandGate.tsx`), a non-dismissable modal that blocks rendering until the user picks a company brand (PCTH / KSI / PCMY / UNO — `src/lib/brand.ts`). This brand cookie (`rocks-fast-brand`) is unrelated to Intelligence (which is gone); it scopes ERP/Business Central context for Accounting.

## Features

### 1. Office Forms (`/forms`) — deleted

The configurable form builder is **gone**, along with its eight pages, its
sixteen `/api/forms` routes and `src/features/forms`. See "Navigation" above for
why. The `OfficeForm*` tables remain in `Rocks_Portal_Form` and nothing reads
them; `src/lib/graph.ts` and `src/lib/storage.ts` survive because Accounting uses
both.

If it is ever revived, these are the things that were wrong with it, all of them
still true of the deleted code in git history:

- the upload route authenticated but never authorized — no parent-submission ACL
  on upload, list or download, and it built the storage path out of a
  client-supplied `fieldKey` and file name;
- `processApprovalAction` checked the actor only when `AssignedTo` was truthy, and
  `createApprovalRows` inserted `Status='Pending', AssignedTo=NULL` whenever the
  assignee did not resolve — so any authenticated session could action those;
- submissions stored arbitrary JSON: required, min/max and file constraints lived
  only in `FormFiller.tsx`;
- workflow advancement scanned *all* historical approvals, so one `Returned` row
  stopped the workflow permanently after a resubmit;
- `/api/forms/[formId]/workflow/steps` wrote two columns that exist in no
  migration, so workflow configuration threw on first use.

### 2. Request → Accounting (`/request/accounting`)

Three live Accounting forms share a generic request/approval backbone, plus a Business Central ERP integration layer. **Only AP-1 reaches Business Central** — see AP-4 below.

**Storage:** Acc* tables live in **`Rocks_Portal_Form`**, accessed via `getAccPool()` (= `getFormPool()`, `src/lib/acc/pool.ts`). Numbered migrations in `migrations/` (013 onward) built these up incrementally against the old `Fast_Form`; `059_portal_form_baseline.sql` is the generated full-schema baseline used to stand up a new database. Apply with `npm run apply-sql -- --db Rocks_Portal_Form --file <path>` (see `scripts/apply-sql.ts`). **Every migration names its own target database in its header — read that before running it.**

**Standing up a production form database takes 059 *and* 066.** 059 was generated from `Fast_Form`, which never held `TeamMember`, so a database built from 059 alone has no identity table. Since the fail-closed change this now **locks everybody out** rather than degrading them: provisioning fails, `signIn` returns false, and every login lands on `/unauthorized`. That is louder than the old behaviour — which let anyone with an active `Rocks_Portal_HR.Employee` row in as `Staff` with a blank id, leaving `/settings/users` unreachable and the roster unrepairable from the UI — but it is still a stand-up mistake with no in-app remedy, so apply 066. Grep for `[Auth] blocked login (could not provision a TeamMember row)` and `[TeamMember] provision failed for …`.

`066_portal_form_team_member.sql` creates the table and copies the roster out of Fast_Core, so it goes *after* 059. It refuses to run unless the database is named `Rocks_Portal_Form…` **and** has `dbo.AccRequest`: the name test is what keeps a mistyped `--db` out of `Fast_Form`, which has `AccRequest` too and belongs to the live sibling. **066 is a copy, not a seed** — its `INSERT` reads `[Fast_Core].[dbo].[TeamMember]`, so that table must exist and still hold the roster when 066 runs. If it did not, batch 1 would commit the empty table and batch 2 roll back under `XACT_ABORT`, leaving no indexes, no FK and identity at 1; and once anyone logs in and is provisioned, the empty-table guard on the copy blocks the re-run permanently while new ids start at 1 — straight into the range 066 exists to keep clear. **Post-apply check:** `SELECT COUNT(*) FROM dbo.TeamMember` = 17 and `SELECT IDENT_CURRENT('dbo.TeamMember')` = 100000. It is the one migration that must **not** also be applied to `Rocks_Portal_Form_UAT` — identity lives in production only, and both pools reach it three-part. A new migration that changes an `Acc*` table does have to be applied to `Rocks_Portal_Form_UAT` as well, but the parallel-UAT batch is not that shape: **060, 062, 063 and 065 are Fast_Core only** (`FormEnvironment`, `UatTester`), and **061 and 064 are `Rocks_Portal_Form_UAT` only** — they refuse to run against a database whose name does not end in `_UAT`.

**Generic header (shared by all Accounting forms):** `AccFormMaster` (form catalog), `AccRequest` (shared request header), `AccApproval`, `AccActivityLog`, `AccSequence`, `AccEmailQueue`, `AccRequestFile`.

**Running number:** `TOFyy-xxxx`-style, allocated atomically at submit via `src/lib/acc/sequence.ts`.

#### AP-1 — Travel Expense Reimbursement (`/request/travel-expense`)

Office travel-expense reimbursement form (fuel/toll/parking against a route or manual entry).

- **Pages:** `/request/travel-expense` (fill/resume draft), `/request/travel-expense/[id]` (detail + timeline + self-cancel ≤24h after submit)
- **Detail tables:** `AccTravelExpense` + `AccTravelExpenseItem`
- **Settings tables:** `AccApprover` (configured account approvers), `AccVehicle` (vehicle rate table), `AccFormBrand` (brand access per form)
- **Workflow:** Manager (resolved from `Rocks_Portal_HR.Employee.ManagerStaffId`) → Account (from `AccApprover`). Email notification at every transition via Graph queue (`src/lib/acc/email-queue.ts`), drained after each action. Account approval sets `PaymentDate` = next 2nd or 4th Friday, shifted forward past holidays from `Rocks_Codex.Holiday` (`src/lib/acc/payment-calendar.ts`).
- **Conditional fields:** `AccVehicle.IsManualEntry = true` → fare + toll inputs; `false` → OpenRouteService distance × rate + toll + parking, via `DistanceMapField` → `LeafletRoutePicker` (plain Leaflet, `dynamic ssr:false`) + ORS geocoding/directions proxied through global `/api/ors/{geocode,directions}` (`src/lib/ors.ts`). Manual-km fallback when ORS is unavailable.
- **OpenRouteService is a global system setting:** API key stored in `Fast_Core.AppSetting` (`src/lib/app-settings.ts`) with `ORS_API_KEY` env fallback; resolved by `resolveOrsKey()`. Configured at **Settings → Maps & Routing → OpenRouteService** (`/settings/openrouteservice`, IT/System Admin) via `/api/settings/ors` (+`/test`; key always masked).
- Shared calculation logic in `src/lib/acc/calc.ts`. Travel date validation: unique per StaffId (except Rejected status), ≤1 month in the past, no future dates.

#### AP-17 — Travel Booking (`/request/travel-booking`)

Accommodation/ticket booking requests for provincial work travel — supports multiple bookings per request, an admin booking queue, per-diem history, and on-behalf submission.

- **Pages:** `/request/travel-booking` (fill/resume draft, multi-row), `/request/travel-booking/[id]` (detail), plus office/admin views under `/request/accounting/travel-booking*` (queue, report, settings)
- **Feature code:** `src/features/travel-booking/`; service/lib code under `src/lib/acc/travel-booking/`
- Uses `Rocks_Portal_HR.EmployeeAllowanceLog` for effective-dated per-diem history and `Fast_Data` for province lookups (`province-service.ts`)

#### AP-4 — Staff Reimbursement (`/request/reimburse`)

An employee itemises money they spent out of pocket, attaches the AP-4.1 Excel summary and the receipts, ticks every line of a compliance checklist, and three approvals later the company pays them back.

- **Pages:** `/request/reimburse` (fill/resume draft), `/request/reimburse/[id]` (detail + timeline), `/request/reimburse/settings` (approvers, the checklist, the brand allowlist)
- **Tables (five, migrations 088–090):** `AccReimburse` + `AccReimburseItem` (the claim and its lines), `AccReimburseRuleAck` (which checklist line this requester ticked, by rule id) — all three transactional — plus `AccReimburseRule` and `AccReimburseApprover`, which are **shared configuration and dual-written**. 091 widened `AccApproval`'s step CHECK for the third step; 092 registers the form; 093 is its `FormEnvironment` row.
- **Feature code:** `src/features/reimburse/`; services under `src/lib/acc/reimburse/`. `src/features/reimburse/constants.ts` imports nothing and is the home for anything pure that needs a test — the form code, the step and status vocabulary, the notice copy, and `validateRuleText`'s 1,000-character bound.
- **Three approval steps**, not AP-1's two: **Manager** (`Rocks_Portal_HR.Employee.ManagerStaffId`, or `UatTester.ManagerStaffId` in UAT) → **Accounting check** (`ACCOUNT`, from `AccReimburseApprover`), which is the step that sets `PaymentDate` → **Accounting final** (`ACCOUNT_FINAL`), from the same pool but **necessarily a different person** — `canActFinalStep` (`two-person.ts`) refuses a match, and refuses when either StaffId is absent, because a missing id is not evidence of a different person.
- **Payment rounds are the 1st and 3rd Friday** of the month — *not* AP-1's 2nd and 4th, which is why `reimburse/payment-calendar.ts` exists rather than a branch in the shared one; the pure building blocks are shared by import through `payment-calendar-core.ts`. Each round has **its own Monday-noon cutoff**, not one cutoff shared across rounds: a check at Monday 13:00 misses that week's Friday and is then measured against the *next* round's own Monday noon. Dates are shifted forward past `Rocks_Codex.Holiday` like AP-1's.
- **Running numbers are `RBMyy-xxxxx`** — the shared `AccSequence` allocator, keyed on `(Prefix, Year)`, so the series **resets each year**. UAT's first number of a year is `RBMyy-09001` (the `UAT_SEQUENCE_FLOOR`), production's `RBMyy-00001`.
- **AP-4 never reaches Business Central, deliberately.** It is absent from AP-1's report and from the ERP prep queue because both pin `AP1_FORM_CODE` (`report-service.ts`, `erp-prep-service.ts`) — reimbursements are paid, not posted as travel journals. Adding AP-4 to either is a decision, not a bug fix.
- **AP-4 parks at `(ManagerApproved, ACCOUNT)` — the same status/step tuple AP-1 uses.** This is why **every claim in `approval-engine.ts` is pinned to `FormCode='AP-1'`** and every claim in `reimburse/approval-service.ts` is pinned to `AP-4`. Without the pins, AP-1's engine will happily claim an AP-4 request sitting on that tuple and drive it through AP-1's workflow. Removing a pin re-opens a Critical; two reviews have now spent effort rediscovering this.
- **`BrandCode` is validated against `AccFormBrand` at submit** (the submit route, before the service claims anything). The picker offers only granted brands, but a draft can hold any code — including the BrandGate cookie value every request written before the allowlist existed carries — and a client-enforced invariant is not one. A resumed request keeps a code the allowlist has since dropped rather than being silently re-pointed at another company, and is told to pick a new one before submitting.

#### Business Central / ERP integration

Accounting requests can be pushed into Dynamics 365 Business Central. Configuration lives under **Settings**: Database Connections, Business Central (OAuth2 connection), Brand Configuration (per-brand BC + ERP SQL target), ERP Interface Environment (per-brand Sandbox company and connection, System Admin only — which forms use it is set at Settings → Form Environment). Sync logic in `src/lib/erp/account-sync.ts` and `src/lib/erp/dimension-sync.ts` (both query `Fast_Data`), OData client in `src/lib/bc/`.

**Key libs (`src/lib/acc/`):** `pool`, `sequence`, `payment-calendar`, `payment-calendar-core`, `employee-context`, `brand-options`, `access`, `settings-service`, `request-service`, `approval-engine`, `report-service`, `email-queue`, `email-templates`, `calc`, `erp-environment-shared`, plus `travel-booking/*` and `reimburse/*`.

**Feature UI:** `src/features/accounting/` (AP-1), `src/features/travel-booking/` (AP-17) and `src/features/reimburse/` (AP-4) — form components, approval queues, report tables, settings panels.

## Project Structure

`README.md` is the front door — what the app is, quick start, scripts, layout.
This file is the developer guide it points at. `docs/README.md` indexes the
specs, plans and archived reviews, and explains that they are dated history
rather than current state.

```
README.md                             # Entry point — start here, then this file
CLAUDE.md                             # This guide
docs/
├── README.md                         # Index + how to read specs/plans as history
├── UI-GUIDE.md                       # The Sky design system, portable to other apps
├── superpowers/specs/                # Design specs, written before the work
├── superpowers/plans/                # Implementation plans
└── reviews/                          # Completed reviews, kept as remediation record
migrations/                           # Numbered SQL — each names its target DB in its header
scripts/                              # apply-sql, run-tests, seed, and checks/ verifiers
src/
├── app/
│   ├── (auth)/login, unauthorized
│   ├── (dashboard)/
│   │   ├── my-request/, my-work/     # Personal request tracking
│   │   ├── request/                  # Accounting hub, AP-1, AP-17, AP-4, ERP prep
│   │   ├── settings/                 # Admin settings hub — connections, BC, brand config, ERP, users
│   │   └── page.tsx                  # Home — form catalogue
│   ├── api/
│   │   ├── auth/                     # NextAuth
│   │   ├── request/accounting/       # AP-1, AP-17, ERP prep API routes
│   │   ├── request/reimburse/        # AP-4 API routes (its own prefix, not under accounting/)
│   │   ├── settings/                 # Connections, BC, brand-config, ORS, Google Maps, users
│   │   ├── form-environment/         # Per-form availability for Home
│   │   ├── uat-mode/                 # The only writer of the UAT-mode cookie
│   │   ├── health/                   # Liveness (+ /db, detail for System Admin only)
│   │   ├── me/, users/               # Own profile; AD user search
│   │   └── ors/, maps/, weather/     # Routing, Google Maps, Home weather strip
│   ├── loading.tsx                   # Global loading screen
│   └── layout.tsx                    # Root layout — theme no-flash script, providers
├── features/
│   ├── accounting/                   # AP-1 form, approvals, report, settings UI
│   ├── travel-booking/               # AP-17 form, admin queue, report, settings UI
│   ├── reimburse/                    # AP-4 form, detail, settings UI + constants.ts (pure, tested)
│   ├── home/                         # Home catalogue
│   ├── settings/                     # Settings panels
│   └── new-item-inventory/           # WIP — see the note below the tree
├── components/
│   ├── ui/                           # Button, Badge, Avatar, Dialog, DropdownMenu, SidePanel, FullScreenModal
│   └── layout/                       # Navbar, RouteGuard, PageContainer
├── lib/
│   ├── db/mssql.ts                   # Multi-DB pools (Core, Form, Production/UAT Form, Data, generic getAppPool), pool max=30
│   ├── team-member/                  # The only module that touches TeamMember — service.ts + mapping.ts
│   ├── acc/                          # Accounting domain logic (see above)
│   │   ├── request-acl-policy.ts      # Pure object ACL — decideRequestRead/Mutate
│   │   ├── request-acl.ts             # Pool/request-scoped half + authorizeAccRequest()
│   │   ├── attachment-guard.ts        # Magic-byte upload admission + safe download headers
│   │   ├── stored-file.ts             # Backend-dispatching delete (local vs SharePoint)
│   │   ├── request-errors.ts          # AccConflictError / AccForbiddenError -> 409 / 403
│   │   ├── travel-booking/            # + derive-flags.ts, id-card-access.ts
│   │   └── reimburse/                 # AP-4 — two-person.ts, payment-calendar.ts, approval-policy.ts
│   ├── form-environment/             # Which database answers — resolver + classify-path
│   ├── uat-tester/                   # UatTester membership + assertFormWritable guards
│   ├── new-item-inventory/           # WIP — lookup + sequence, no UI yet
│   ├── erp/                          # Business Central sync
│   ├── hr/                           # Rocks_Portal_HR cross-DB lookups
│   ├── graph.ts                      # Microsoft Graph API (searchADUsers, getADUserByEmail, getADUserPhoto, sendEmail)
│   ├── storage.ts                    # Local file storage (UPLOAD_ROOT)
│   ├── bc/                           # Business Central OData + bc-destination.ts allowlist
│   ├── auth.ts, auth.config.ts, api-auth.ts, auth-identity.ts
│   └── hooks/
├── env.ts                            # Type-safe env validation
```

Unit tests sit beside the code they cover as `*.test.ts`; `npm test` discovers
them. `npm run typecheck` is `tsc --noEmit`.

**`new-item-inventory` is a half-built feature, not dead code.** It has a live
lookup route (`/api/request/new-item-inventory/lookup/[resource]`), a service and
a sequence allocator under `src/lib/new-item-inventory/`, a `ROUTE_RULES` entry
pinning it to Production (it reads Fast_Core, so no request id of its own), and
test coverage in `classify-path.test.ts` / `request-id.test.ts` — but only
`constants.ts` and `types.ts` in `src/features/`, and no page. Leave the route
rule alone if you touch `classify-path.ts`.

**`/api/map-preview` was deleted on 2026-08-19.** It was a Locations remnant —
Locations was removed when this app was cloned — with zero callers anywhere in
`src/`, and it proxied Google Static Maps on the server key and cached PNGs into
`.cache/`. Recoverable from git history if the feature ever returns.

## Conventions

- **DB columns**: PascalCase (`Id`, `Name`, `Status`) — map to camelCase in API responses
- **API response**: `{ ok: true, data: ... }` or `{ ok: false, error: "..." }`
- **Auth**: `requireAuth()` / `requireRole(["IT Admin", "System Admin"])`
- **SQL**: Parameterized queries only — `pool.request().input("name", sql.NVarChar, value).query(...)`
- **TeamMember**: never write SQL against it. Call `src/lib/team-member/service.ts`, which owns every statement and pins them to `getProductionFormPool()`. To join it from a query running on another pool, use its `teamMemberTableRef()` → `[Rocks_Portal_Form].[dbo].[TeamMember]`. `service.ts` is the only file in `src/` holding SQL that names the table — keep it that way, because a stray query pointed at Fast_Core does not error, it returns the sibling app's roster.
- **Object authorization**: any route reaching an `AccRequest` by id calls `authorizeAccRequest()` (`src/lib/acc/request-acl.ts`) before it reads or writes. `requireAuth()` proves *a* session, not a right to *this* record.
- **Attachments**: validate with `checkAttachment()` / `checkAttachmentBatch()` and serve with `attachmentResponseHeaders()`. Never trust `File.type`, never echo the stored `ContentType`, never serve an attachment `inline` without re-sniffing.
- **Storage paths**: only through `src/lib/storage.ts` (containment-checked) or `deleteStoredFile()` (backend-dispatching). Never `path.join(UPLOAD_ROOT, …)` by hand.
- **State transitions**: claim with a conditional `UPDATE … WHERE <expected state>` inside the transaction and check `rowsAffected`. Never read-then-write. Allocate a running number *after* the claim, not before.
- **CSS**: Use `var(--variable)` — never raw hex. See `globals.css` for all tokens.
- **Icons**: `lucide-react` only
- **Toasts**: `sonner` — `toast.success()`, `toast.error()`
- **Excel**: `xlsx-js-style` (not `xlsx` — old SheetJS CE has vulnerabilities)
- **Components**: `"use client"` only when needed. Use existing UI components from `@/components/ui`
- **ES5 target**: Don't use `[...set]` or `[...map.values()]` — use `Array.from()` instead
- **Date display**: Use local getters (`getFullYear()`, `getMonth()`), never `toISOString()` — server is Thai time, do NOT use `fixThaiDate()`
- **Logos**: the navbar mark, the favicon (`src/app/layout.tsx`) and the login lockup all use `/brandlogo/rocks.png`; the loading screen uses the Codex Family logo. `public/brandlogo/` holds the Rocks Group and company-brand logos only. Replace the favicon once a Form Portal icon exists, or the two apps share a tab icon

## Environment Variables

```env
# Auth
AUTH_SECRET=
AZURE_AD_CLIENT_ID=
AZURE_AD_CLIENT_SECRET=
AZURE_AD_TENANT_ID=

# Database
MSSQL_HOST=
MSSQL_PORT=1433
MSSQL_DATABASE=Rocks_Codex                      # default catalogue only — see the note below
MSSQL_USER=
MSSQL_PASSWORD=
MSSQL_ENCRYPT=true
MSSQL_TRUST_CERT=true
MSSQL_CORE_DATABASE=Fast_Core
MSSQL_FORM_DATABASE=Rocks_Portal_Form
MSSQL_FORM_UAT_DATABASE=Rocks_Portal_Form_UAT   # served to configured testers in UAT mode; see "Parallel Production and UAT"
MSSQL_DATA_DATABASE=Fast_Data

# Email
GRAPH_MAIL_FROM=noreply@rocksgroup.com
UAT_MAIL_REDIRECT=                              # UAT mail for non-testers goes here (active testers get theirs); falls back to GRAPH_MAIL_FROM

# SharePoint (Accounting file storage — shared with Rocks Fast)
SHAREPOINT_ACC_SITE=
SHAREPOINT_ACC_FOLDER=

# OpenRouteService (AP-1 distance calculation fallback)
ORS_API_KEY=

# Google Maps
GOOGLE_MAPS_API_KEY=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Local attachment storage — point at the Rocks Fast sibling's uploads folder
UPLOAD_ROOT=

# Business Central destination allowlists (optional, additive to the built-in
# Microsoft defaults — see src/lib/bc/bc-destination.ts). Comma-separated hosts.
BC_ALLOWED_OAUTH_HOSTS=
BC_ALLOWED_API_HOSTS=

# Local dev only, default off — lets any signed-in user action the AP-1/AP-17
# manager step on a non-production build served from localhost:3081.
ACC_MANAGER_DEV_BYPASS=

# Client
NEXT_PUBLIC_APP_URL=http://localhost:3081
```

**`MSSQL_DATABASE` is inert.** `src/env.ts` is the only file in the repo that
reads it, and it only asserts the string is non-empty — every pool in
`src/lib/db/mssql.ts` opens an explicitly named database. It still has to name
something the login can open, because it is the connection's default catalogue.

**This repo's own `.env.local` had the broken value, and nobody noticed.** It
named **`Rocks_Codex_UAT`** — the database the next paragraph records as dropped
on 2026-06-20 — and connecting to it answers `Login failed for user 'saai'`.
Measured and changed to `Rocks_Codex` on 2026-08-19; that one is reachable. The
trap the next paragraph warns about had already been walked into here, and it
cost nothing only because `MSSQL_DATABASE` is inert and every pool names its
database explicitly. Two things follow. Being inert is *why* it stayed wrong for
months — there is no failure to notice, so it has to be read to be caught. And
**`.env.local` is gitignored, so this correction does not travel**: production's
environment holds its own copy and must be checked separately, as must any
developer machine set up before that date.

**Do not copy env values from the Rocks Fast sibling on the assumption they are
proven.** `RocksFast/.env.local` is a months-old local snapshot, not a live
config: until 2026-08-19 it still named **`Rocks_Codex_UAT`**, a database
**dropped 2026-06-20** that now answers `Login failed for user 'saai'`. Because
`MSSQL_DATABASE` is inert, nothing failed and no test caught it. The credentials
themselves (`AUTH_SECRET`, the Azure AD trio, `MSSQL_HOST`/`USER`/`PASSWORD`,
Google Maps) *are* shared and identical — it is the database names, the port and
the app URL that must differ.

## Deployment

**Live at `https://form.portal.rocksgroup.com`** since 2026-08-19. The chain is
**Cloudflare → IIS + ARR 3.0 → `next start`** (`x-powered-by: ARR/3.0`, `Server:
cloudflare`). `/api/health` reports `nodeEnv: production`.

### ⚠️ ARR must not rewrite the `Location` header

**`reverseRewriteHostInResponseHeaders` must be `false` on the ARR proxy.** It
defaults to **true**, and while true it rewrites the host of every `Location`
response header to the public host — including the redirect that starts sign-in.
Measured on the live host 2026-08-19:

```
app sends → Location: https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?...
client got → Location: https://form.portal.rocksgroup.com/{tenant}/oauth2/v2.0/authorize?...
```

The path and every query parameter (`redirect_uri` included) survive untouched —
only the origin is replaced — so the browser never reaches Microsoft and sign-in
dies on a 404 at our own host. **This looks exactly like a broken app and is not
one:** the same commit serving `next start` locally with no proxy emits the
correct host, in both development and production mode. Microsoft's own ARR
reference configuration disables this setting for precisely this reason ("ARR
must return the location headers as set by the application in case of
redirects"), and pairs it with `preserveHostHeader = true`, which this app also
needs because `trustHost: true` reads the `Host` header.

Fix it in IIS Manager → server node → *Application Request Routing Cache* →
*Server Proxy Settings* → untick **Reverse rewrite host in response headers**, or
in `applicationHost.config`:

```xml
<system.webServer>
  <proxy reverseRewriteHostInResponseHeaders="false" preserveHostHeader="true" />
</system.webServer>
```

Note that `web.config` is **gitignored**, so no proxy configuration lives in this
repo — it exists only on the server, and a rebuilt server loses it.

### The rest of the deployment checklist

- **`PRODUCTION_HOSTS` in `next.config.mjs`** feeds both `allowedDevOrigins` and `experimental.serverActions.allowedOrigins`. `form.portal.rocksgroup.com` was added 2026-08-19; it was missing at first deploy, which would have rejected every server action from the live host as cross-origin — at runtime, so the build stays green and only a submit reveals it.
- **`NEXTAUTH_URL` and `NEXT_PUBLIC_APP_URL`** must both match the address users actually open, including port. Both are set to `https://form.portal.rocksgroup.com` in production.
- **The Entra app registration must list the callback for every host the app answers on.** Production needs `https://form.portal.rocksgroup.com/api/auth/callback/microsoft-entra-id`; dev needs `http://localhost:3081/api/auth/callback/microsoft-entra-id` (add `http://127.0.0.1:3081/...` too if anyone opens it that way). A `redirect_uri` Entra has never seen fails with `AADSTS50011` before any app code runs.
  **Which value is sent depends on whether `NEXTAUTH_URL` is set.** `auth.config.ts` sets `trustHost: true`, but that only makes the `Host` header the *fallback*: when `NEXTAUTH_URL`/`AUTH_URL` is present it wins outright. Verified 2026-08-19 — a build served on port 3082 with `NEXTAUTH_URL=http://localhost:3081` still sent `redirect_uri=http://localhost:3081/...`. So an unset `NEXTAUTH_URL` makes the registration port-sensitive, and a set one makes it env-sensitive; either way both must agree with what Entra lists.
- **`ERP_SANDBOX_ALLOWED_HOSTS`** (`src/lib/acc/erp-environment-shared.ts`) is `localhost:3081` / `127.0.0.1:3081` — the `devHostOnly` management cards and the manager-approval dev bypass (`src/lib/acc/manager-auth.ts`) disappear on any other host, which is intended for production but worth knowing.
- **`UPLOAD_ROOT` can be left empty** — there are no pre-SharePoint `AccRequestFile` rows in this app's databases (see "Shared with Rocks Fast"). Production already runs with it blank.
- **`SHAREPOINT_ACC_SITE` and `SHAREPOINT_ACC_FOLDER` must both be set, or attachment upload fails outright.** Neither AP-1 nor AP-17 has a local fallback: `isSharePointConfigured()` false makes the route delete its placeholder `AccRequestFile` row and answer **502** with `อัปโหลดไฟล์ขึ้น SharePoint ไม่สำเร็จ`. That is deliberate — files must be reachable from every web deployment — but it means a missing env var breaks uploading rather than quietly writing to disk. Live values verified 2026-08-19 against Graph with the app's own client credentials: `rockspc.sharepoint.com:/sites/Codex-ACCPortal` → site "Codex - ACC Portal" → drive "Documents" → folder `RocksAccUpload`, which already contains `AP-1/`, `AP-17/` and `_UAT/`.
- **Parallel UAT ships in three steps, in this order: apply 062 + 063 → deploy the code → apply 065.** All three are Fast_Core. 062 adds `ProductionEnabled` / `UatEnabled` beside the old `Environment` column and backfills them, leaving that column in place so the *currently running* app keeps working; 063 creates `UatTester`. Only once the new code is live does 065 drop `Environment`. Running 065 first takes the old build down — its `setFormFlag` names that column in the MERGE INSERT. (061 and 064 target `Rocks_Portal_Form_UAT` and are independent of the deploy; 061 must precede any UAT write.)
- **065 is one-way.** After it has run, a `git revert` of the parallel-UAT branch restores a `setFormFlag` that writes to a column that no longer exists, so the first write to any form fails. Reverting past commit `54ff2d7` means re-adding `FormEnvironment.Environment` as **NULLable** first — the original was `NOT NULL` with no default, which cannot be added back to a table that already has rows without backfilling one.
- **`066_portal_form_team_member.sql` must be applied to whichever database `MSSQL_FORM_DATABASE` names.** It is already applied to the live `Rocks_Portal_Form`; a fresh stand-up needs 059 then 066, or nobody can sign in at all (see the Accounting storage note). Never apply it to `Rocks_Portal_Form_UAT`.
- Liveness probe: `curl http://127.0.0.1:3081/api/health` → `{"ok":true,"data":{"service":"form-portal",…}}`.
- **`/api/health/db` no longer publishes the topology.** `auth.config.ts` exempts every `/api/health*` path from authentication, and that endpoint was returning the MSSQL host, port, service-account username, database name and the raw driver error text to anyone who asked. It now answers `database: "reachable" | "unreachable"` plus a 200/503, and includes the detail only for a System Admin. The diagnostic line goes to the server log unconditionally, which is where an operator should read it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
