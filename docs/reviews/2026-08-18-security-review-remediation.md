> **Status: COMPLETED.** Every finding below was remediated in commit `d4bec43`
> ("fix(security): object ACLs, attachment validation, atomic claims; delete
> Form Builder"). Archived here as the record of what that commit answered —
> see CLAUDE.md → "Authorization — one policy per question" for the design that
> came out of it. The Form Builder findings were closed by deleting the feature,
> so the paths they name (`/api/forms/**`, `src/features/forms`) no longer exist.

# Claude Code: verify and remediate the Form Portal review findings

Review date: 2026-08-18

Reviewed revision: `f5a513c` on `master`

Verdict: **fix before ship**

## Mission

Verify each finding below against the current code, write a failing regression test, implement the smallest durable fix, and then run the full verification gate. Do not treat the current green build as evidence that these paths are safe: the existing suite has no route-level authorization, attachment, workflow-cycle, or external-side-effect concurrency coverage.

Do not deploy, run SQL migrations, call live Business Central/Graph/SharePoint, or commit/push unless the user separately authorizes it. Use fakes, temporary directories, and a disposable database/test harness.

## Architectural constraints to preserve

Read `CLAUDE.md` before changing code. In particular:

- `TeamMember` identity stays pinned to `getProductionFormPool()` through `src/lib/team-member/service.ts`; never move it to `getFormPool()`.
- `FormEnvironment` and `UatTester` stay in Fast_Core; do not import `auth()` into `src/lib/form-environment/**` and create the `getFormPool -> auth -> getFormPool` cycle.
- Production and UAT operate concurrently. Every authorization test must cover both environments and must not let a request ID select a database without also enforcing the correct actor policy.
- Never use global `sql.connect()`.
- Do not rewrite or execute the old `001`, `024`, or `058` migrations. They are explicitly unsafe to re-run.
- Keep the existing SharePoint collision mitigation until a separately planned per-app folder migration exists.
- `package.json` enumerates test files explicitly. Add every new test file to `npm test`, or replace the list with a verified cross-platform discovery mechanism.

## Baseline evidence

These commands passed before this report was created:

```text
npm test                              114 passed, 0 failed
npx tsc --noEmit --incremental false  exit 0
npm run build                         exit 0, Next.js 16.3.1, 113 app routes
```

The build and unit suite do **not** exercise the findings below. No live exploit was attempted; each issue was verified by tracing the entry point through authorization, persistence, and side effects.

## Simpler containment option

Before a broad refactor, check which surfaces are live. If any affected subsystem is not required in production, the smallest safe change is to deny it server-side until its P0/P1 items are fixed:

1. Feature-flag or deny `/api/forms/**` and `/forms/**` if the generic Form Builder is not in active production use.
2. Disable AP-17 previous-ID-card reuse endpoints while the consent/ownership model is corrected.
3. Disable ERP send server-side while an atomic claim/idempotency design is implemented.

Hiding buttons or navigation is not containment; the API route must refuse the operation.

## P0 — stop-ship findings

### P0-1: Attachment handling allows path escape, cross-user access, stored active content, and unbounded buffering

Evidence:

- `src/app/api/forms/submissions/[submissionId]/files/route.ts:12-61` only authenticates. It trusts `submissionId`, `fieldKey`, file name/count/size/type, buffers the complete body, writes storage before the DB insert, and never checks the parent submission owner or state.
- The same route at `:86-107` lists any submission's files to any authenticated user.
- `src/lib/storage.ts:12-31` joins a database/client-controlled relative path to `UPLOAD_DIR` without resolving and enforcing containment for upload, download, or delete.
- `src/app/api/forms/files/[fileId]/route.ts:12-40` downloads by sequential file ID with no parent ACL and serves the stored, client-controlled content type as `inline`.
- `src/proxy.ts:27-33` intentionally omits the page CSP on API responses, so an uploaded HTML/SVG response can execute on the authenticated application origin.
- File constraints declared in `src/features/forms/schemas.ts:28-37` are only UI hints; the upload route never enforces them.
- AP-1 repeats the active-content flaw: `src/app/api/request/accounting/requests/[id]/files/route.ts:45-49,83-84` trusts any caller-declared `image/*` (including SVG), and `src/app/api/request/accounting/files/[fileId]/route.ts:40-47` renders it inline. AP-17 does the same for image/PDF at `src/app/api/request/travel-booking/requests/[id]/files/route.ts:81-86,189-191` and `src/app/api/request/travel-booking/files/[fileId]/route.ts:73-80`.

Verify first:

- With a temporary upload root, post a multipart body whose `fieldKey` or filename contains enough `..` segments to escape the root. Assert a vulnerable build resolves outside the root; never write outside the temporary fixture.
- As user B, attempt upload/list/download against user A's draft and submitted records.
- Upload HTML/SVG or a MIME-mismatched payload and inspect response disposition/type.
- Inject a DB-insert failure after storage succeeds and inspect orphan cleanup.

Required fix:

- Generate opaque server-side storage keys. Keep the original filename as metadata only.
- In all local storage functions, use `path.resolve`, compare with `path.relative`, reject absolute/outside-root targets, and apply the check to read/write/delete.
- Create one parent-submission ACL used by detail, file list, upload, and download. Upload requires owner plus `Draft`/`Returned`; read requires owner, current assigned approver, or authorized form admin.
- Validate `fieldKey` against the immutable published version and require it to be a file field.
- Enforce server-side count, per-file bytes, total bytes, extension, and MIME signature. Do not trust `File.type`. Stream or reject before buffering large bodies.
- Apply signature/size/count validation to the generic, AP-1, and AP-17 attachment stacks. Serve untrusted formats as `attachment`, or from an isolated asset origin. Do not render active HTML/SVG inline on the app origin.
- Remove the stored object if the DB insert/finalization fails.

Regression gate:

- Traversal cannot create/read/delete outside a temporary root.
- Outsider upload/list/download returns 403 or non-enumerating 404 with no side effect.
- Oversize, too-many, unknown-field, MIME-mismatch, HTML, and SVG cases are refused safely across generic forms, AP-1, and AP-17.
- A simulated DB failure leaves no orphaned object.

### P0-2: An unresolved generic-form assignee can be actioned by any authenticated user

Evidence:

- `src/features/forms/workflow-engine.ts:44-63` can resolve an assignee to `null`.
- `src/features/forms/workflow-engine.ts:174-188` still inserts `Status='Pending', AssignedTo=NULL`.
- `src/features/forms/workflow-engine.ts:224-245` checks the actor only when `AssignedTo` is truthy, so null fails open.
- `src/app/api/forms/approvals/[approvalId]/action/route.ts:9-38` exposes the numeric approval ID action to every authenticated session.
- `CLAUDE.md:97` says `ManagerId` is absent for most current/future TeamMember rows, so this is a normal reachable state, not a theoretical null.

Verify first:

- Create a `submitter_manager` or unknown-role step that resolves to null. From an unrelated session, action its approval ID and assert the vulnerable version mutates approval/submission/log/email state.

Required fix:

- Never create an actionable Pending approval without an assignee. Fail submission atomically with a configuration error, or create a distinct non-actionable configuration-error/escalation state.
- The action claim must require exact `AssignedTo = @actorId`, `Status = 'Pending'`, and a valid parent workflow state in one conditional statement/transaction.
- Map service failures to correct HTTP status (`403` unauthorized, `409` stale/already actioned). Do not return HTTP 200 with outer `ok:true` and nested `ok:false`.

Regression gate:

- Null assignee cannot be actioned by owner, outsider, or admin unless an explicit audited escalation role is designed.
- The exact assignee succeeds once; a retry or concurrent loser receives 409; one log/email/state transition exists.

### P0-3: Same-department coworkers can retrieve another employee's national-ID scan

Evidence:

- `src/app/api/request/travel-booking/id-card/consent/route.ts:19-39` accepts a caller-supplied `requesterStaffId` and writes consent for that staff ID.
- `src/lib/hr/employee-lookup.ts:484-503` authorizes an on-behalf target solely by same-department membership.
- `src/app/api/request/travel-booking/id-card/previous/route.ts:20-65` exposes the victim's latest ID-card `fileId` when that setting is true.
- `src/app/api/request/travel-booking/id-card/previous/download/route.ts:20-64` streams a matching staff member's ID card without independently checking consent.
- `src/app/api/request/travel-booking/requests/[id]/files/reuse-idcard/route.ts:42-99` lets the owner of an on-behalf draft copy a known same-requester card and does not check consent.

Verify first:

- Employee A and B share a department. As A, set B's consent, list B's previous card, download it, and attempt reuse into an A-owned on-behalf draft. Tests must use fake bytes/storage.
- Also test known/guessed `fileId` when B's consent is false or absent.

Required fix:

- Only the data subject may grant/revoke reuse consent. If delegation is a real business requirement, model it explicitly, time-bound it, and audit who granted it; same-department status is not consent.
- Independently enforce subject-owned consent and the authorized request relationship on previous metadata, download, and reuse. Never rely on the caller having first used the metadata endpoint.
- If no delegated-consent model exists, disable previous-card reuse for on-behalf requests while preserving ordinary on-behalf request creation.

Regression gate:

- Same-department A targeting B gets 403/404 for consent mutation, previous metadata, direct download, and reuse, even with a known file ID.
- B can use their own consent/card in the correct environment; Production consent cannot authorize UAT data or vice versa.

### P0-4: Concurrent or ambiguous ERP sends can duplicate financial journals

Evidence:

- `src/lib/acc/erp-interface-send.ts:194-255` reads the queue/status before claiming it.
- `src/lib/acc/erp-interface-send.ts:92-157` marks rows Pending one at a time. The conditional predicate is at `:142-143`, but affected-row counts are ignored.
- Both callers can reach the external BC call at `src/lib/acc/erp-interface-send.ts:267-276`.
- If BC returns success but `Sent` persistence or activity logging fails at `:278-291`, the catch at `:300-313` marks the batch retryable `Failed`, so the next retry can post it again.

Verify first:

- Use a barrier-controlled fake BC client and two concurrent sends for the same expected IDs. Count outbound calls.
- Inject failure after fake BC 200 but before/while local finalization, then retry.

Required fix:

- Atomically claim the entire exact batch in one transaction and proceed only when every expected row was claimed. A partial/zero claim returns 409 before external I/O.
- Persist a durable operation/outbox record and deterministic idempotency/reconciliation key before calling BC.
- Verify what idempotency Business Central actually supports. If remote outcome is unknown or remote success cannot be finalized locally, store `Unknown/ReconciliationRequired`; never downgrade it to an automatically retryable Failed state.
- Make activity/audit recording idempotent by operation ID.

Regression gate:

- Two concurrent send requests produce one BC call.
- Failure before the remote call is retryable; failure after an ambiguous/successful remote call never calls BC again automatically.
- Environment and interface target remain bound to the claimed batch.

### P0-5: Authorization-source outages fail open during Entra sign-in

Evidence:

- `src/lib/team-member-lookup.ts:46-56` converts TeamMember lookup failure to the same `null` used for a real miss.
- `src/lib/auth.ts:147-153` then asks HR whether the user is active.
- If HR throws, the outer catch at `src/lib/auth.ts:195-207` grants a Staff session and returns `true`.
- `src/lib/api-auth.ts:7-12` treats an email-bearing session as authenticated, including when it has no stable positive internal user ID.

Verify first:

- Test three distinct outcomes: member not found, lookup unavailable, and HR unavailable. An enabled Entra tenant account absent from both rosters must not receive a session when the authorization data source fails.
- Confirm optional Graph profile/photo failure remains non-blocking.

Required fix:

- Preserve lookup result distinctions such as `found`, `not_found`, and `unavailable` instead of collapsing errors to null.
- Fail closed when TeamMember/HR authorization cannot be established. Keep only cosmetic Graph enrichment optional.
- Require a stable positive internal user ID before enabling any write-capable session. If the form DB cannot provision/read identity, return a clear unavailable/auth error instead of `id=""`.

Regression gate:

- TeamMember miss plus HR exception denies sign-in.
- Active HR employee with successful provisioning signs in as intended.
- Graph/photo failure does not deny an otherwise authorized user.

## P1 — authorization and state-integrity findings

### P1-1: AP-1 direct request and attachment endpoints lack a common object ACL

Evidence:

- `src/app/api/request/accounting/requests/[id]/route.ts:13-27` returns `getRequest(id)` to any authenticated session.
- The returned object assembled in `src/lib/acc/request-service.ts:160-172,264-301` includes personal/travel/amount/approval data and attachment IDs.
- `src/app/api/request/accounting/files/[fileId]/route.ts:13-48` downloads any numeric file ID without joining the parent request.
- `src/app/api/request/accounting/requests/[id]/files/route.ts:55-168` uploads to any existing request without owner/state authorization; `:206-255` checks editable state for deletion but not ownership.
- The upload's `refId` lookup at `:71-80` does not prove that the expense item belongs to the same request.

Required fix and tests:

- Centralize the AP-1 read ACL: creator/requester, assigned pending manager, properly scoped accounting approver, or explicit admin policy.
- Mutations require creator ownership and `Draft`/`Returned`; bind every child/file/ref ID to the same parent in the authorization query.
- Test an owner, assigned manager, in-scope accounting actor, out-of-scope accounting actor, admin, and unrelated Staff across Draft/Submitted/Returned and Production/UAT. Outsider operations must have no DB/storage side effects.

### P1-2: AP-1 submit has no owner claim and is not concurrency-safe

Evidence:

- `src/app/api/request/accounting/requests/[id]/submit/route.ts:29-36` resolves the requester from any supplied request ID and calls `submitRequest` without checking `CreatedBy`.
- `src/lib/acc/request-service.ts:918-944` reads status and allocates a number before the transaction.
- The transition at `src/lib/acc/request-service.ts:969-976` updates only by ID, has no owner/expected-status predicate, and ignores affected rows.

Required fix and tests:

- Claim owner plus expected state inside the transaction before allocating or recording side effects. Use a conditional update/lock and require one affected row.
- Non-owner submit returns 403. Two synchronized submits yield one success and one 409 with exactly one request number, approval set, activity log, and queued notification.

### P1-3: Interface-brand scope is enforced in lists but bypassed by direct actions

Evidence:

- The ERP-prep list applies `resolveApproverInterfaceAccess` and row filtering in `src/app/api/request/accounting/erp-prep/route.ts:47-60`.
- Direct prep detail (`erp-prep/[id]/route.ts:14-32`), report export (`report/export/route.ts:15-53`), ERP send (`erp-prep/send/route.ts:27-88`), and ACCOUNT approve/reject (`requests/[id]/approve/route.ts:56-62`, `reject/route.ts:59-69`) only check broad `canAccessAccountArea`.

Required fix and tests:

- Add one server-side `assertInterfaceTargetAccess`/row-scope policy and call it on every list, detail, export, workflow action, and send path.
- A KSI-only approver must receive 403 for PCTH detail/export/approve/reject/send, and the BC fake must remain uncalled. `ids=` export filters must not bypass scope.

### P1-4: The localhost Host header is an authorization input

Evidence:

- `src/lib/acc/erp-environment.ts:8-10` reads the raw request `Host`.
- `src/lib/acc/erp-environment-shared.ts:3-8` treats `localhost:3081` and `127.0.0.1:3081` as special.
- `src/lib/acc/manager-auth.ts:3-5,33-40` turns that into an unconditional manager-step bypass with no production guard.
- This reaches AP-1 and AP-17 approve/reject/return routes, for example `src/app/api/request/accounting/requests/[id]/approve/route.ts:34-55` and `src/app/api/request/travel-booking/requests/[id]/approve/route.ts:43-55`.

Required fix and tests:

- Never authorize from Host. Remove the bypass, or require both non-production runtime and an explicit default-off server-only development flag/test identity.
- In production-mode tests, forged `Host: localhost:3081` from a non-manager must return 403 with no mutation for approve/reject/return on both forms.

### P1-5: Direct UAT IDs let non-testers act on test requests

Evidence:

- The intended rule says the whole UAT approval chain remains inside active testers: `docs/superpowers/specs/2026-08-18-parallel-uat-design.md:33-40`.
- ID-based routing in `src/lib/form-environment/pick-environment.ts:119-127` and `src/lib/form-environment/index.ts:133-148` can select UAT for a non-tester while UAT is enabled.
- ACCOUNT actions then accept any active production `AccApprover` through `src/app/api/request/accounting/requests/[id]/approve/route.ts:56-62` and `src/lib/acc/access.ts:4-18`.
- `CLAUDE.md:47` still says a non-tester manager may act on a UAT ID, which conflicts with the newer tester-only design and with `CLAUDE.md:42,56`. Resolve and update this documentation inconsistency as part of the fix.

Required fix and tests:

- Treat the tester-only design as the safe default unless the product owner explicitly chooses otherwise. A direct ID may locate a record, but mutation/read authorization must independently require the correct UAT actor policy.
- A non-tester AccApprover cannot read/action a UAT request; an active tester assigned to that step can act even if the UAT-mode cookie is off, because the record ID already names the environment.

### P1-6: Generic form payloads are not validated against their published schema

Evidence:

- `src/features/forms/schemas.ts:68-75` accepts an unbounded `Record<string, unknown>`.
- `src/app/api/forms/submissions/route.ts:91-152` verifies only form/version existence and stores arbitrary JSON.
- `src/app/api/forms/submissions/[submissionId]/submit/route.ts:22-81` does not validate the stored data before workflow conditions consume it.
- Required/min/max checks live only in `src/features/forms/components/FormFiller.tsx:47-65`; file constraints are also client-only.

Required fix and tests:

- Compile the immutable published form version into a server-side validator and enforce it inside the submit transaction.
- Reject missing/unknown/type-invalid fields, required/conditional violations, min/max/length/pattern violations, missing required files, excessive key count/nesting/string/body size, and non-finite numeric values.
- Auto-approval conditions must operate on normalized typed values, not attacker-selected coercions.
- Raw HTTP tests must bypass the UI and prove invalid/crafted/oversized submissions fail with 400/413 and no workflow state.

### P1-7: First-click generic form Submit creates a stranded record

Evidence:

- `src/features/forms/components/FormFiller.tsx:68-80,98-109` creates a new record with `isDraft:false`, then calls PUT and `/submit`.
- `src/app/api/forms/submissions/route.ts:137-152` immediately stores it as Submitted without starting workflow.
- PUT rejects Submitted at `src/app/api/forms/submissions/[submissionId]/route.ts:156-179`; `/submit` rejects it at `submit/route.ts:40-45`. The client also ignores the PUT response.

Required fix and tests:

- Always create as Draft. Prefer one atomic submit endpoint that saves the final payload, validates it, conditionally transitions, starts workflow, records activity, and persists notification work.
- Check every client response before showing success or calling the next step.
- First-click Submit must create exactly one valid in-workflow record. Save Draft remains editable and no intermediate Submitted orphan remains.

### P1-8: Generic submission/workflow transitions are non-atomic and returned attempts poison resubmission

Evidence:

- `src/app/api/forms/submissions/[submissionId]/submit/route.ts:23-81` separates state read, unconditional update, log, email enqueue, and workflow creation.
- `src/features/forms/workflow-engine.ts:210-245,306-379` uses read-then-write transitions without a transaction/compare-and-set.
- A return leaves an old Returned approval at `:265-271`; resubmission creates new rows, but `:323-326` scans all historical approvals and permanently stops whenever any old Returned row exists.
- The schema has no workflow-attempt/cycle identity or uniqueness constraint for a current step.

Required fix and tests:

- Introduce a workflow attempt/cycle ID (or explicitly supersede/archive prior approvals), and scope advancement to the current attempt.
- Use transactions plus conditional state claims and affected-row checks. Add a unique constraint for one approval per submission/step/cycle.
- Persist notification work in the same transaction through an outbox.
- Test concurrent submit/action, injected failures, parallel-step completion, reject/return races, and return -> edit -> resubmit -> final approval. Each logical transition and notification must occur once.

### P1-9: AP-17 trusts writable, derived booking flags

Evidence:

- `src/features/travel-booking/types.ts:257-297` exposes `needsRoomBooking`, go/return `Needs*`, and `needsRentBooking` as writable DTO fields.
- `src/lib/acc/travel-booking/request-service.ts:420-460` persists those values directly.
- Submit validation at `src/lib/acc/travel-booking/request-service.ts:827-909` checks stored booleans/IDs but does not prove selected options exist, are active, or imply the posted flags.
- Manager approval at `src/lib/acc/travel-booking/approval.ts:75-115` trusts the flags and can auto-complete without Admin booking.

Required fix and tests:

- Remove derived behavior flags from writable input. Load active option rows and derive/snapshot all required flags server-side during save/submit.
- Reject nonexistent/inactive reason, accommodation, vehicle, rent, and province IDs.
- A tampered `false` flag with a booking-required option must still enter Admin; inactive/nonexistent IDs return 400.

### P1-10: Stored connection secrets can be sent to attacker-selected destinations

Evidence:

- `src/app/api/settings/connections/[id]/test/route.ts:27-49` lets IT/System Admin override host and username while omitting password.
- `src/lib/db/db-connection.ts:381-416` then decrypts the saved password and uses it with those overrides.
- `src/app/api/settings/bc-connections/[id]/route.ts:39-69` permits destination changes while omitted secrets remain stored.
- `src/lib/bc/bc-auth.ts:30-85,151-160` sends client secrets/passwords/refresh tokens/bearer tokens to caller-configured URLs; `resolveBcTestUrl` at `:106-139` returns arbitrary non-BC URLs unchanged.

Required fix and tests:

- A stored secret may only be reused with its immutable stored destination and identity. Changing host/URL/tenant/client/username requires re-entering the relevant secret.
- Add server-side allowlists for approved SQL networks and HTTPS OAuth/BC destinations. Protect against redirects, private/link-local addresses where inappropriate, and DNS rebinding.
- Test that destination changes without a new secret fail before any socket/fetch; approved unchanged endpoints still work.

### P1-11: Workflow route SQL references columns absent from both schemas

Evidence:

- `src/app/api/forms/[formId]/workflow/steps/route.ts:100-109` inserts `OfficeFormWorkflows.CreatedBy`.
- The same route at `:206-212,264-267` writes `OfficeFormWorkflowSteps.UpdatedAt`.
- Those columns are absent from `migrations/002_fast_form_tables.sql:125-160` and `migrations/059_portal_form_baseline.sql:638-660`; no later migration adds them.

Required fix and tests:

- The smaller fix is to remove the unused column writes if no code consumes the metadata. If audit metadata is required, create a new ordered, idempotent migration; do not edit an applied migration as the only fix.
- From a disposable schema created using the supported migration path, first workflow creation plus step POST/PUT/DELETE must succeed and persist the intended state.

## P2 — reliability, retention, and policy findings

### P2-1: Generic form email processing can lose, duplicate, or falsely acknowledge mail

Evidence:

- Queue helpers are fire-and-forget from `src/app/api/forms/submissions/[submissionId]/submit/route.ts:70-81` and `src/features/forms/workflow-engine.ts:190-193,256-271,356-372`.
- `src/app/api/forms/email/process/route.ts:25-72` selects Queued rows without an atomic lease/claim and marks Sent after sending.
- `src/lib/graph.ts:84-88` returns successfully when `GRAPH_MAIL_FROM` is missing, so the processor can mark an unsent message Sent.

Required fix and tests:

- Use a transactional outbox for workflow mutations, an atomic update/output claim with lease/recovery, and a stable idempotency key.
- Missing sender configuration must throw and retain a retryable/non-Sent state.
- Parallel processors and crash/retry tests must prove one logical notification with no false Sent acknowledgment.

### P2-2: Request deletion loses the only pointer to SharePoint objects

Evidence:

- AP-17 deletion selects only `StoragePath` in `src/lib/acc/travel-booking/request-service.ts:556-573` and later calls local `deleteFile` at `:750-752,791-793`, even for SharePoint uploads.
- AP-1 `deleteDraft` at `src/lib/acc/request-service.ts:809-835` removes DB rows without storage cleanup; item deletion at `:861-887` sends SharePoint item IDs to local deletion.

Required fix and tests:

- Retain both `StorageBackend` and `StoragePath`, dispatch to the correct backend, and persist a retryable cleanup/outbox record before deleting the only pointer.
- Test every draft/item/group delete with local and SharePoint fakes. A remote failure must leave enough durable state to retry and audit sensitive-file retention.

### P2-3: AP-17 completion can race booking/file mutation

Evidence:

- `src/lib/acc/travel-booking/admin-service.ts:223` reads and validates children before its completion transaction, while booking save/delete paths at `:130-202` run independently.

Required fix and tests:

- Lock/claim the parent and validate required booking/file children inside the same transaction. Condition every child mutation on the parent still being `ManagerApproved` at the Admin step.
- Barrier tests must synchronize completion with delete/update; only one commits, and any Completed request retains all required evidence.

### P2-4: Detailed database health is public

Evidence:

- `src/lib/auth.config.ts:69-75` exempts every `/api/health*` path from authentication.
- `src/app/api/health/db/route.ts:8-33` returns MSSQL host, port, username, database name, and raw driver error text.

Required fix and tests:

- Keep public liveness generic. Redact detailed readiness, or protect it with an internal probe secret/network and/or System Admin role. Log diagnostic detail server-side.
- An unauthenticated response must contain no configured topology, username, database, or driver message.

### P2-5: Resolve the AP-17 admin-as-manager policy explicitly

Evidence:

- AP-17 approve/reject/return routes describe the action as manager-only but permit any IT/System Admin in production, e.g. `src/app/api/request/travel-booking/requests/[id]/approve/route.ts:43-55`, repeated in reject/return.
- AP-1's shared manager guard in `src/lib/acc/manager-auth.ts:43-62` deliberately does not grant by application role.

Required decision:

- Default to removing the AP-17 role bypass unless the product owner confirms delegated admin action is required. If it is required, use a distinct audited “act on behalf” operation that records the real actor and reason; do not impersonate the assigned manager silently.

## Implementation order

1. Add test harnesses and failing tests for P0 items; apply immediate route-level containment.
2. Centralize actor context and parent ACLs for generic forms and AP-1/AP-17. Route handlers must not invent their own weaker policy.
3. Convert state changes to service-layer transactions with conditional claims, current-cycle identity, and affected-row checks.
4. Introduce durable outbox/operation records for ERP, email, and storage cleanup. Keep remote I/O outside long DB locks while retaining idempotent/reconcilable state.
5. Fix server-derived validation and DTO trust boundaries.
6. Resolve schema/policy items, update `CLAUDE.md`, then run the full gate.

Use these response semantics consistently: `400` malformed/invalid business input, `401` unauthenticated, `403` unauthorized (or a consistent non-enumerating `404`), `409` stale/concurrent/already processed, `413` too large, and `502/503` upstream/service unavailable. Unauthorized and stale paths must not mutate DB, storage, mail, or ERP state.

## Required verification matrix

At minimum, cover:

- Actors: owner, requester, assigned manager, in-scope AccApprover, out-of-scope AccApprover, IT Admin, System Admin, unrelated Staff, missing internal ID.
- Environments: Production and UAT; tester cookie on/off; active/inactive/non-tester; direct Production/UAT IDs.
- States: Draft, Submitted, InReview/Manager, Account, Returned, Rejected, Approved/Completed, Cancelled, stale/already-actioned.
- Inputs: null/empty/zero/negative/NaN-like IDs, unknown child IDs, wrong-parent IDs, inactive settings, Unicode/long filenames, path separators, MIME mismatch, HTML/SVG, zero-byte, too many, and oversized files/JSON.
- Failures: DB before/after claim, storage before/after DB insert, BC success followed by DB failure, email sender missing, concurrent submit/action/send/process/delete/complete.

## Completion gate

Run fresh and inspect the complete output:

```powershell
npm test
npx tsc --noEmit --incremental false
npm run build
git diff --check
git status --short
```

Do not run `npm run check:alignment` or any migration against a configured database without explicit confirmation that the target is disposable/safe.

Before reporting completion, provide:

- a table mapping every finding ID to the fixing commit/files and regression test name;
- exact test/build counts and exit codes;
- any intentionally deferred finding with owner, reason, containment, and follow-up;
- confirmation that no secrets, generated `.next` files, or unrelated user changes entered the diff.

The work is not complete while any P0 finding is merely hidden in the UI, any external side effect can be duplicated after retry, or any authorization decision relies only on a list filter, client-provided flag, cookie, Host header, or guessed numeric ID.
