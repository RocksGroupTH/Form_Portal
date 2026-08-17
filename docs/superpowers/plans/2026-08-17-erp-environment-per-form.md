# Per-form ERP Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a form's Form Environment flag the only thing that decides which Business Central instance its journals are posted to, and delete the app-wide ERP toggle.

**Architecture:** `resolveEffectiveErpEnvironment()` stops consulting the signed-in user's role, the request host, and `Fast_Core.AppSetting`, and instead maps the current route's form environment: UAT → `Sandbox`, everything else → `Production`. Because the only path that posts to BC is the ERP Prep queue, its route prefix is reclassified from `BOTH` to `AP-1` so the rows it reads, the send, and the BC target all come from one database. Every UI surface built for the deleted toggle — the navbar chip, the settings toggle, and the fields in `ErpEnvironmentInfo` that fed them — goes with it.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, MSSQL (`mssql`), `node:test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-08-17-erp-environment-per-form-design.md`

## Global Constraints

- Parameterized SQL only; never string-concatenate values into a query.
- API responses are `{ ok: true, data }` or `{ ok: false, error }`.
- CSS uses `var(--token)`; no raw hex. Icons from `lucide-react`. Toasts via `sonner`.
- ES5 target: use `Array.from()`, never `[...set]` / `[...map.values()]`.
- Dates display with local getters (`getFullYear()`, `getMonth()`); never `toISOString()`.
- In-page copy is Thai; identifiers, comments, and commit messages are English.
- `npx tsc --noEmit` and `npm test` must both pass before every commit.
- Do not delete `ERP_SANDBOX_ALLOWED_HOSTS` or `isErpSandboxHostAllowed` — `manager-auth.ts` and the `devHostOnly` cards in `REQUEST_CARDS` still use them.
- Do not delete `getRequestHost` — the approve/reject/return routes still call it.
- Leave the `ERP_INTERFACE_ENV` rows in `Fast_Core.AppSetting` and both `AccSetting` tables in place. No migration.

**Task order matters.** Each task must leave `npx tsc --noEmit` clean, which means consumers are removed before the things they consume. Do not reorder.

---

### Task 1: ERP Prep routes follow AP-1

**Files:**
- Modify: `src/lib/form-environment/classify-path.ts:39-47`
- Test: `src/lib/form-environment/classify-path.test.ts:28-36`

**Interfaces:**
- Consumes: nothing
- Produces: `classifyPath("/api/request/accounting/erp-prep/send") === "AP-1"`

- [ ] **Step 1: Write the failing test**

In `src/lib/form-environment/classify-path.test.ts`, delete these two lines from the
`"aggregate endpoints span both databases"` test:

```ts
  assert.equal(classifyPath("/api/request/accounting/erp-prep"), "BOTH");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/send"), "BOTH");
```

Then add this test directly below that one:

```ts
test("ERP prep is not an aggregate — it follows AP-1", () => {
  // The prep queue reads rows, builds a journal from them and posts it to
  // Business Central. Reading a merged list and sending from one pool would
  // post whichever half the pool happened to hold.
  assert.equal(classifyPath("/api/request/accounting/erp-prep"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/send"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/journal-context"), "AP-1");
  assert.equal(classifyPath("/api/request/accounting/erp-prep/42"), "AP-1");
  assert.equal(classifyPath("/request/accounting/erp-prep"), "AP-1");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Expected values to be strictly equal: 'BOTH' !== 'AP-1'`

- [ ] **Step 3: Change the rule**

In `src/lib/form-environment/classify-path.ts`, inside `ROUTE_RULES`, delete this line
from the aggregate block:

```ts
  { prefix: "/api/request/accounting/erp-prep", result: "BOTH" },
```

and add this immediately after the aggregate block, above the settings rule:

```ts
  // ERP prep is not an aggregate. It is the only path that posts to Business
  // Central, and the send reads its rows from one pool — so the queue, the
  // journal and the BC target have to agree on a database. It follows AP-1,
  // whose travel-expense claims are what the queue is made of.
  { prefix: "/api/request/accounting/erp-prep", result: "AP-1" },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, all tests green

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/form-environment/classify-path.ts src/lib/form-environment/classify-path.test.ts
git commit -m "fix(env): ERP prep follows AP-1 instead of reading both databases"
```

---

### Task 2: Resolve the ERP environment from the form

**Files:**
- Modify: `src/lib/acc/erp-environment.ts:53-63`
- Modify: `src/lib/acc/erp-target-profile.ts:116-124` and `:140-146`
- Modify: `src/lib/acc/erp-journal-context.ts:30-32`, `:131-158`, `:214-224`
- Modify: `src/lib/acc/erp-journal-builder.ts:54`
- Modify: `src/lib/acc/erp-interface-send.ts:20-33`, `:177`, `:185`, `:285`, `:293`
- Modify: `src/app/api/request/accounting/erp-prep/send/route.ts:33-38`
- Modify: `src/app/api/request/accounting/erp-prep/journal-context/route.ts:21-22`
- Modify: `src/app/api/request/accounting/erp-environment/route.ts:25-28`
- Modify: `src/app/api/settings/erp-interface/route.ts:33-37` and `:110-115`
- Modify: `src/features/accounting/components/ErpPrepQueue.tsx:262`

**Interfaces:**
- Consumes: `resolveFormEnvironment(): Promise<"Production" | "UAT">` from `@/lib/form-environment` (Task 3 of the 2026-08-14 plan, already shipped)
- Produces:
  - `resolveEffectiveErpEnvironment(): Promise<ErpBcEnvironment>` — no parameters
  - `resolveErpTargetProfile(interfaceBrandCode: string): Promise<ErpTargetProfile | null>`
  - `resolveAllErpTargetProfiles(): Promise<ErpTargetProfile[]>`
  - `loadErpJournalBuildContext(): Promise<ErpJournalBuildContext>` — no parameters, and the type no longer has `canUseSandbox`
  - `SendErpPersonGroupInput` / `SendErpInterfaceBatchInput` without `role` and `host`

- [ ] **Step 1: Rewrite the resolver**

In `src/lib/acc/erp-environment.ts`, add this import at the top:

```ts
import { resolveFormEnvironment } from "@/lib/form-environment";
```

Then replace `resolveEffectiveErpEnvironment` (the whole function, including its comment):

```ts
/**
 * Which Business Central instance this request targets.
 *
 * One switch decides it: the form's own environment. A form flagged UAT at
 * Settings → Form Environment reads and writes the UAT database, and its
 * journals go to BC Sandbox. There is deliberately no separate ERP toggle —
 * two switches sharing the word "UAT" is how a test request ends up in the
 * real ERP.
 *
 * Code with no request scope — scripts, the background email drain — resolves
 * to Production, exactly as its database does.
 */
export async function resolveEffectiveErpEnvironment(): Promise<ErpBcEnvironment> {
  const formEnvironment = await resolveFormEnvironment();
  return formEnvironment === "UAT" ? "Sandbox" : "Production";
}
```

Leave `getGlobalErpInterfaceEnvironment`, `setGlobalErpInterfaceEnvironment`,
`canUseErpSandboxEnvironment`, `normalizeErpBcEnvironment` and `ERP_INTERFACE_ENV_KEY`
alone for now — routes and UI still reference them until Task 5.

- [ ] **Step 2: Drop role/host from the target profile resolvers**

In `src/lib/acc/erp-target-profile.ts`, change both exported resolvers:

```ts
export async function resolveErpTargetProfile(
  interfaceBrandCode: string,
): Promise<ErpTargetProfile | null> {
  const code = interfaceBrandCode.trim().toUpperCase();
  if (!isErpInterfaceBrandCode(code)) return null;

  const environment = await resolveEffectiveErpEnvironment();
```

```ts
export async function resolveAllErpTargetProfiles(): Promise<ErpTargetProfile[]> {
  const brandIds = ERP_INTERFACE_BRANDS.map((b) => b.id);
  const environment = await resolveEffectiveErpEnvironment();
```

The rest of both function bodies is unchanged.

- [ ] **Step 3: Drop role/host from the journal build context and key the cache by environment**

In `src/lib/acc/erp-journal-context.ts`, replace the cache-key helper:

```ts
function journalContextCacheKey(environment: ErpBcEnvironment): string {
  return `${JOURNAL_CONTEXT_CACHE_PREFIX}${environment}`;
}
```

Add the type import if it is not already there:

```ts
import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";
```

Change the loader's signature and the order of work — the environment has to be
resolved before the cache can be read, because it is now part of the key:

```ts
export async function loadErpJournalBuildContext(): Promise<ErpJournalBuildContext> {
  const erpEnvironment = await resolveEffectiveErpEnvironment();
  const cacheKey = journalContextCacheKey(erpEnvironment);
  const cached = getAccCached<ErpJournalBuildContext>(cacheKey, JOURNAL_CONTEXT_CACHE_TTL_MS);
  if (cached) return cached;

  const [
    descriptionTemplate,
    erpPage,
    glRows,
    bankRows,
    branchRows,
    journalRows,
    profiles,
    erpDepartmentsByTarget,
  ] = await Promise.all([
    getErpJournalDescriptionTemplate(),
    getBrandErpConfigPage(),
    listBrandAccounts("gl"),
    listBrandAccounts("bank"),
    listBrandBranches(),
    listBrandJournalBatches(),
    resolveAllErpTargetProfiles(),
    listErpDepartmentsForBrands(ERP_INTERFACE_BRANDS.map((b) => b.id)),
  ]);
```

Note `resolveEffectiveErpEnvironment` and `resolveAllErpTargetProfiles` have left the
`Promise.all` array — `erpEnvironment` is resolved above it, and the destructuring list
loses its `erpEnvironment` entry.

Then in the object built near the end of the function, delete this line:

```ts
    canUseSandbox: canUseErpSandboxEnvironment(role, host),
```

and remove the now-unused `canUseErpSandboxEnvironment` import from this file.

- [ ] **Step 4: Remove `canUseSandbox` from the context type**

In `src/lib/acc/erp-journal-builder.ts`, delete this line from the
`ErpJournalBuildContext` interface (around line 54):

```ts
  canUseSandbox: boolean;
```

In `src/features/accounting/components/ErpPrepQueue.tsx`, delete the matching line from
`applyJournalContext` (around line 262):

```ts
      canUseSandbox: data.canUseSandbox ?? false,
```

- [ ] **Step 5: Drop role/host from the send inputs**

In `src/lib/acc/erp-interface-send.ts`, both input interfaces lose two fields:

```ts
export interface SendErpPersonGroupInput {
  interfaceTarget: string;
  personGroupKey: string;
  userId: number;
}

export interface SendErpInterfaceBatchInput {
  interfaceTarget: string;
  userId: number;
}
```

Then update the four call sites inside this file:

```ts
  const profile = await resolveErpTargetProfile(target);
```
(twice — in `sendErpPersonGroup` around line 177 and in the batch function around line 285)

```ts
  const ctx = await loadErpJournalBuildContext();
```
(twice — around lines 185 and 293)

- [ ] **Step 6: Update the four API routes**

`src/app/api/request/accounting/erp-prep/send/route.ts` — drop the host lookup and the
two fields:

```ts
    const data = await sendErpInterfaceBatch({
      interfaceTarget,
      userId: Number(session.user.id),
    });
```

Remove the now-unused `getRequestHost` import and the `const host = await getRequestHost();` line.

`src/app/api/request/accounting/erp-prep/journal-context/route.ts` — same treatment:

```ts
    const ctx = await loadErpJournalBuildContext();
```

Remove its `getRequestHost` import and `host` line.

`src/app/api/request/accounting/erp-environment/route.ts` — the payload keeps its shape
for now (Task 6 trims it); only the resolver call changes:

```ts
      resolveEffectiveErpEnvironment(),
```

`src/app/api/settings/erp-interface/route.ts` — two places, in the GET and in the POST
response block:

```ts
        resolveEffectiveErpEnvironment(),
        resolveAllErpTargetProfiles(),
```

Leave `getGlobalErpInterfaceEnvironment()` and `sandboxHostAllowed` in both payloads —
Task 5 removes them together with the toggle that reads them.

- [ ] **Step 7: Typecheck and commit**

The compiler is the test here: every dropped parameter has to be dropped at its call
site, and `tsc` finds each one.

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/erp-environment.ts src/lib/acc/erp-target-profile.ts src/lib/acc/erp-journal-context.ts src/lib/acc/erp-journal-builder.ts src/lib/acc/erp-interface-send.ts src/app/api/request/accounting/erp-prep/send/route.ts src/app/api/request/accounting/erp-prep/journal-context/route.ts src/app/api/request/accounting/erp-environment/route.ts src/app/api/settings/erp-interface/route.ts src/features/accounting/components/ErpPrepQueue.tsx
git commit -m "feat(env): resolve the ERP environment from the form, not the host"
```

---

### Task 3: Delete the navbar ERP chip

**Files:**
- Delete: `src/components/layout/ErpEnvironmentNavBadge.tsx`
- Modify: `src/components/layout/Navbar.tsx:13`, `:184`, `:248`

**Interfaces:**
- Consumes: nothing
- Produces: nothing — this removes the last caller of `toggleEnvironment` and `env.canConfigure`

- [ ] **Step 1: Remove the two usages**

In `src/components/layout/Navbar.tsx`, delete the import on line 13:

```tsx
import { ErpEnvironmentNavBadge } from "@/components/layout/ErpEnvironmentNavBadge";
```

and both render sites — the desktop one (around line 184):

```tsx
          <ErpEnvironmentNavBadge />
```

and the mobile one (around line 248):

```tsx
          <ErpEnvironmentNavBadge compact />
```

- [ ] **Step 2: Delete the component**

```bash
git rm src/components/layout/ErpEnvironmentNavBadge.tsx
```

- [ ] **Step 3: Verify nothing else references it**

Run: `grep -rn "ErpEnvironmentNavBadge" src`
Expected: no output

- [ ] **Step 4: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/components/layout/Navbar.tsx
git commit -m "feat(env): remove the ERP environment chip from the navbar"
```

---

### Task 4: Remove the global toggle from the settings page and the API

**Files:**
- Modify: `src/components/settings/ErpInterfaceEnvironmentSettings.tsx` — the "สภาพแวดล้อมที่ใช้งาน" section (around lines 460-535), the `EnvironmentToggle` component (around lines 130-170), `setEnvironment` (around lines 403-425), and the `globalEnv` / `isSandbox` / `envSaving` state
- Modify: `src/app/api/settings/erp-interface/route.ts` — the `body.environment` branch (around lines 79-85) and both response payloads
- Modify: `src/lib/acc/erp-environment.ts` — delete the now-dead exports
- Modify: `src/lib/constants.ts` — the `erp-interface` card description

**Interfaces:**
- Consumes: nothing
- Produces: `POST /api/settings/erp-interface` no longer accepts an `environment` field; `GET` and `POST` payloads no longer carry `globalEnvironment`, `sandboxHostAllowed` or `canUseSandbox`

- [ ] **Step 1: Strip the settings page section**

In `src/components/settings/ErpInterfaceEnvironmentSettings.tsx`:

1. Delete the whole `{/* Section 1 — Global environment */}` `<section>` — from the
   comment down to its closing `</section>`, including the "กำลังใช้" chip, the
   `EnvironmentToggle`, and both advisory panels below it.
2. Delete the `EnvironmentToggle` component definition and the `setEnvironment` handler.
3. Delete the state and derived values that only fed them: `envSaving`, `globalEnv`,
   `isSandbox`, `sandboxHostAllowed`.
4. Delete `globalEnvironment`, `sandboxHostAllowed` and `canUseSandbox` from the
   component's settings type (around lines 54-56).
5. Remove imports left unused — `erpEnvironmentShortLabel`, `ErpBcEnvironment`, and
   `AlertTriangle` if the advisory panels were its only users. Let `tsc` tell you.

Keep "Section 2 — UAT mapping" and everything after it: per-brand UAT company and BC
connection are still how a Sandbox target is configured.

Add this line under the page's existing subtitle so the page still explains itself:

```tsx
        <p className="text-[12px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
          ฟอร์มที่ตั้งเป็น UAT ที่ Settings → Form Environment จะใช้การตั้งค่า UAT ด้านล่างนี้
        </p>
```

- [ ] **Step 2: Strip the API**

In `src/app/api/settings/erp-interface/route.ts`:

1. Delete the `if (body.environment !== undefined) { ... }` branch from `POST`.
2. In both the GET and POST response payloads, delete `globalEnvironment`,
   `sandboxHostAllowed` and `canUseSandbox`, and drop `getGlobalErpInterfaceEnvironment()`
   from both `Promise.all` arrays along with the `storedEnvironment` destructuring slot.
3. Remove imports that go unused: `getGlobalErpInterfaceEnvironment`,
   `setGlobalErpInterfaceEnvironment`, `normalizeErpBcEnvironment`,
   `canUseErpSandboxEnvironment`, `isErpSandboxHostAllowed`, and `ErpBcEnvironment` if
   nothing else in the file needs it.

Keep `effectiveEnvironment` in both payloads — the page shows which environment is live.

- [ ] **Step 3: Delete the dead exports**

In `src/lib/acc/erp-environment.ts`, delete `getGlobalErpInterfaceEnvironment`,
`setGlobalErpInterfaceEnvironment`, `normalizeErpBcEnvironment`,
`canUseErpSandboxEnvironment`, `ERP_INTERFACE_ENV_KEY`, `VALID_ENVIRONMENTS`, and the
`getAppSetting` / `setAppSetting` / `isSystemAdminRole` imports they used.

What must remain in this file: `resolveEffectiveErpEnvironment`, `getRequestHost`, and
the re-exports of `ErpBcEnvironment`, `erpEnvironmentLabel` and `isErpSandboxHostAllowed`.

- [ ] **Step 4: Verify nothing references the deleted exports**

Run: `grep -rn "getGlobalErpInterfaceEnvironment\|setGlobalErpInterfaceEnvironment\|ERP_INTERFACE_ENV_KEY\|canUseErpSandboxEnvironment\|normalizeErpBcEnvironment" src`
Expected: no output

- [ ] **Step 5: Fix the settings card description**

In `src/lib/constants.ts`, the `erp-interface` entry in `SETTINGS_CARDS`:

```ts
  {
    id: "erp-interface",
    label: "ERP Interface Environment",
    icon: "FlaskConical",
    desc: "ตั้งค่า BC company และ connection ของฝั่ง UAT (Sandbox) — ฟอร์มไหนใช้ UAT กำหนดที่ Form Environment",
    href: "/settings/erp-interface",
    systemAdminOnly: true,
  },
```

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/components/settings/ErpInterfaceEnvironmentSettings.tsx src/app/api/settings/erp-interface/route.ts src/lib/acc/erp-environment.ts src/lib/constants.ts
git commit -m "feat(env): remove the global ERP environment toggle"
```

---

### Task 5: Trim `ErpEnvironmentInfo` and widen the Sandbox banner

**Files:**
- Modify: `src/lib/acc/erp-environment-shared.ts:11-19`
- Modify: `src/app/api/request/accounting/erp-environment/route.ts`
- Modify: `src/features/accounting/hooks/useErpInterfaceEnvironment.ts`
- Modify: `src/features/accounting/components/ErpEnvironmentBanner.tsx`

**Interfaces:**
- Consumes: `resolveEffectiveErpEnvironment()` (Task 2)
- Produces: `ErpEnvironmentInfo = { effectiveEnvironment: ErpBcEnvironment }`; the hook returns `{ env, loading, ready, error, mutate, isSandbox }`

- [ ] **Step 1: Shrink the payload type**

In `src/lib/acc/erp-environment-shared.ts`, replace the interface:

```ts
export interface ErpEnvironmentInfo {
  /**
   * Which Business Central instance this route targets. Follows the form's
   * Form Environment flag — there is no per-user or per-host component to it
   * any more, so there is nothing else to report.
   */
  effectiveEnvironment: ErpBcEnvironment;
}
```

- [ ] **Step 2: Shrink the endpoint**

Replace the body of `GET` in `src/app/api/request/accounting/erp-environment/route.ts`:

```ts
export async function GET() {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  try {
    const data: ErpEnvironmentInfo = {
      effectiveEnvironment: await resolveEffectiveErpEnvironment(),
    };
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/accounting/erp-environment] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
```

Its imports reduce to `NextResponse`, `requireAuth`, `resolveEffectiveErpEnvironment`
and the `ErpEnvironmentInfo` type.

- [ ] **Step 3: Shrink the hook**

In `src/features/accounting/hooks/useErpInterfaceEnvironment.ts`:

```ts
const DEFAULT: ErpEnvironmentInfo = {
  effectiveEnvironment: "Production",
};
```

Delete `setEnvironment`, `toggleEnvironment`, the `toggling` state, the `SETTINGS_API`
constant, and the `toast` / `globalMutate` / `ErpBcEnvironment` / `erpEnvironmentLabel`
imports they used. The fetch itself is unchanged except for one thing: drop the
`devHost` gate so the banner works on every host.

```ts
  const { status } = useSession();
  const shouldFetch = status === "authenticated";
```

Remove the `useErpSandboxDevHost` import. The return becomes:

```ts
  return {
    env,
    loading: isLoading,
    ready,
    error,
    mutate,
    isSandbox: env.effectiveEnvironment === "Sandbox",
  };
```

- [ ] **Step 4: Widen and reword the banner**

Replace the guard and the copy in
`src/features/accounting/components/ErpEnvironmentBanner.tsx`:

```tsx
/**
 * Shown on accounting pages whose form is flagged UAT — their journals go to
 * BC Sandbox. Everyone sees it, not just System Admin: the environment is a
 * property of the form now, not of who is looking at it.
 */
export function ErpEnvironmentBanner() {
  const { env, ready } = useErpInterfaceEnvironment();

  if (!ready || env.effectiveEnvironment !== "Sandbox") {
    return null;
  }
```

and the two lines of copy inside it:

```tsx
        <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
          โหมด {erpEnvironmentLabel("Sandbox")}
        </p>
        <p className="text-[12px] m-0 mt-0.5" style={{ color: "var(--text-secondary)" }}>
          ฟอร์มนี้ถูกตั้งเป็น UAT — เอกสารที่ส่งจะเข้า Business Central Sandbox ไม่ใช่ตัวจริง
        </p>
```

- [ ] **Step 5: Verify no consumer of the removed fields survives**

Run: `grep -rn "canUseSandbox\|sandboxHostAllowed\|canConfigure\|globalEnvironment\|toggleEnvironment" src`
Expected: no output

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit && npm test
git add src/lib/acc/erp-environment-shared.ts src/app/api/request/accounting/erp-environment/route.ts src/features/accounting/hooks/useErpInterfaceEnvironment.ts src/features/accounting/components/ErpEnvironmentBanner.tsx
git commit -m "feat(env): reduce the ERP environment payload to what the form decides"
```

---

### Task 6: Documentation and end-to-end verification

**Files:**
- Modify: `CLAUDE.md` — the "Per-form Production/UAT routing" section, the Business Central section, and the `ERP_SANDBOX_ALLOWED_HOSTS` bullets under "Shared with Rocks Fast" and "Deployment"
- Modify: `src/lib/acc/settings-service.ts:225-232` — the `ENVIRONMENT_SPECIFIC_KEYS` comment
- Modify: `docs/superpowers/specs/2026-08-14-per-form-environment-design.md` — the §8 row of its self-review table

- [ ] **Step 1: Correct the `ENVIRONMENT_SPECIFIC_KEYS` comment**

In `src/lib/acc/settings-service.ts`, replace the comment above
`ENVIRONMENT_SPECIFIC_KEYS`:

```ts
/**
 * Keys that are per-database by design and must never be dual-written.
 *
 * ERP_INTERFACE_ENV is a leftover: nothing reads AccSetting's copy any more —
 * the BC environment comes from the form's Form Environment flag
 * (src/lib/acc/erp-environment.ts). The guard stays so a stale value cannot
 * start propagating between the two databases if something reads it again.
 */
```

- [ ] **Step 2: Update CLAUDE.md**

In the "Per-form Production/UAT routing" section, replace the ERP bullet (the one that
currently says `AccSetting.ERP_INTERFACE_ENV` is what makes a UAT form reach Sandbox)
with:

```markdown
- **Business Central follows the same flag**: `resolveEffectiveErpEnvironment()` (`src/lib/acc/erp-environment.ts`) maps the form's environment to the BC instance — UAT → Sandbox, otherwise Production. There is no separate ERP toggle; the navbar chip and the global `AppSetting` switch that used to own this were removed on 2026-08-17. Which BC company and connection Sandbox uses is configured at Settings → ERP Interface Environment.
- **ERP Prep is classified `AP-1`, not `BOTH`**: it is the only path that posts to BC, and the send reads its rows from a single pool. While AP-1 is flagged UAT the prep queue is the UAT queue, and real payments cannot be processed through it.
```

In the Business Central section, replace "ERP Interface Environment (Production/UAT
toggle, System Admin only, gated to dev hosts by `ERP_SANDBOX_ALLOWED_HOSTS`)" with
"ERP Interface Environment (per-brand Sandbox company and connection, System Admin
only — which forms use it is set at Settings → Form Environment)".

In both `ERP_SANDBOX_ALLOWED_HOSTS` bullets ("Shared with Rocks Fast" and "Deployment"),
delete the claim that the list gates the ERP UAT toggle; it now gates only the
`devHostOnly` management cards and `manager-auth.ts`.

- [ ] **Step 3: Mark the superseded design row**

In `docs/superpowers/specs/2026-08-14-per-form-environment-design.md`, in the self-review
table, replace the §8 row's text with:

```markdown
| §8 UAT forms reach Sandbox Business Central | **Superseded 2026-08-17** — the claim that `AccSetting.ERP_INTERFACE_ENV` delivers this was wrong; nothing read that row. See `2026-08-17-erp-environment-per-form-design.md` |
```

- [ ] **Step 4: Build**

```bash
npx tsc --noEmit && npm test && npm run build
```

Expected: typecheck clean, all tests pass, build compiles. Stop any running `next dev`
first — a build and a dev server share `.next` and the dev server's workers can die.

- [ ] **Step 5: Verify against the running app**

Start the dev server (`npm run dev`) and sign in as a System Admin on
`http://localhost:3020`.

1. Settings → Form Environment: flag **AP-1** as UAT.
2. Open Request → Accounting → ERP Prep. Expected: the Sandbox banner is shown; rows are
   the UAT database's (ids ≥ 900000) — an empty queue is a valid answer if UAT has no
   approved requests, in which case confirm the emptiness against production having rows.
3. Open the send dialog for a target. Expected: the target meta reads `UAT`.
4. Confirm the navbar no longer shows an ERP chip anywhere.
5. Settings → ERP Interface Environment: the Production/UAT toggle is gone; per-brand UAT
   mapping still saves.
6. Flag AP-1 back to Production and repeat 2-3. Expected: production rows, `PROD` target
   meta, no banner.

Record what you actually saw; do not claim a step passed that you could not run.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md src/lib/acc/settings-service.ts docs/superpowers/specs/2026-08-14-per-form-environment-design.md
git commit -m "docs: the ERP environment now follows the form's flag"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| The rule — `resolveEffectiveErpEnvironment()` from `resolveFormEnvironment()` | Task 2, Step 1 |
| ERP Prep follows AP-1 | Task 1 |
| Delete the navbar chip | Task 3 |
| Delete `getGlobalErpInterfaceEnvironment` / `setGlobal…` / `ERP_INTERFACE_ENV_KEY` / `normalizeErpBcEnvironment` | Task 4, Step 3 |
| Delete the `body.environment` branch of `POST /api/settings/erp-interface` | Task 4, Step 2 |
| Delete `toggleEnvironment` from the hook | Task 5, Step 3 |
| Delete the toggle from the settings page, keep the rest | Task 4, Step 1 |
| Signature ripple (`role`/`host`) across profiles, journal context, send, routes | Task 2, Steps 2-6 |
| `canUseSandbox` replaced in `ErpJournalBuildContext` | Task 2, Steps 3-4 |
| `ErpEnvironmentInfo` reduced to `effectiveEnvironment` | Task 5, Steps 1-2 |
| Banner shown to everyone, reworded | Task 5, Step 4 |
| Journal context cache keyed by environment | Task 2, Step 3 |
| Card description, `settings-service` comment, CLAUDE.md | Task 4 Step 5, Task 6 Steps 1-2 |
| Keep `ERP_SANDBOX_ALLOWED_HOSTS`, `isErpSandboxHostAllowed`, `getRequestHost` | Global Constraints; enforced by Task 4 Step 3's "what must remain" |
| Leave the inert `ERP_INTERFACE_ENV` rows | Global Constraints |
| Testing: classify-path test, `tsc` as the ripple check | Task 1 Steps 1-4, Task 2 Step 7 |
| Manual verification | Task 6, Step 5 |

**Type consistency:** `resolveEffectiveErpEnvironment(): Promise<ErpBcEnvironment>`,
`resolveErpTargetProfile(code: string)`, `resolveAllErpTargetProfiles()`,
`loadErpJournalBuildContext()` and the two send-input interfaces are declared once in
Task 2's Interfaces block and used with those exact shapes in Tasks 4 and 5.
`ErpEnvironmentInfo` is `{ effectiveEnvironment }` from Task 5 onward, which is what the
hook's `DEFAULT` and the endpoint both build.

**Ordering:** consumers are removed before their dependencies — the chip (Task 3) before
the hook fields it read (Task 5), the settings toggle (Task 4) before the payload fields
it read (Task 5), and every dropped parameter within the single atomic Task 2. Each task
ends on a green `tsc`.

**Placeholder scan:** no TBD/TODO, no "add error handling", no "similar to Task N". Every
code step carries the code.
