# Per-form ERP environment — design

**Date:** 2026-08-17
**Status:** approved, ready for an implementation plan
**Supersedes:** the §8 claim in `2026-08-14-per-form-environment-design.md` (see "What the earlier design got wrong")

## Problem

Per-form routing decides which *database* a form's requests live in. It does not
decide which *Business Central* instance those requests are pushed to. Today
that is a separate, app-wide switch, so a form flagged UAT still posts journals
into the real ERP.

Two switches with the same vocabulary ("UAT") is also a trap for whoever
operates the portal: flipping AP-1 to UAT in Settings looks like it covers ERP,
and it does not.

The decision: **Form Environment becomes the only switch.** The global ERP
toggle and its navbar chip are removed.

## Current behaviour (verified, 2026-08-17)

`resolveEffectiveErpEnvironment(role, host)` in `src/lib/acc/erp-environment.ts`:

1. `canUseErpSandboxEnvironment(role, host)` — System Admin **and** host in
   `ERP_SANDBOX_ALLOWED_HOSTS` (`localhost:3020`, `127.0.0.1:3020`), else
   `Production`.
2. otherwise `getGlobalErpInterfaceEnvironment()` → `getAppSetting()` →
   `Fast_Core.dbo.AppSetting['ERP_INTERFACE_ENV']`.

Consumers: `resolveErpTargetProfile` / `resolveAllErpTargetProfiles`
(`erp-target-profile.ts`), which pick the BC connection and target settings for
the environment; the navbar chip and the accounting banner via
`GET /api/request/accounting/erp-environment`; the ERP Interface settings page.

Live values read from the databases while writing this spec:

| Row | Value | Read by |
|---|---|---|
| `Fast_Core.AppSetting.ERP_INTERFACE_ENV` | `Sandbox` | `getGlobalErpInterfaceEnvironment` — the only path in use |
| `Rocks_Portal_Form.AccSetting.ERP_INTERFACE_ENV` | `Production` | **nobody** |
| `Rocks_Portal_Form_UAT.AccSetting.ERP_INTERFACE_ENV` | `Sandbox` | **nobody** |

### What the earlier design got wrong

`2026-08-14-per-form-environment-design.md` §8 states that a UAT-flagged form
reaches BC Sandbox for free, because `AccSetting.ERP_INTERFACE_ENV` is
`Sandbox` in the UAT database and is read through the form's own pool. No code
reads `AccSetting.ERP_INTERFACE_ENV` — `getAppSetting` reads `Fast_Core`'s
`AppSetting` table, a different table in a different database. The rows exist
and are inert. `ENVIRONMENT_SPECIFIC_KEYS` in `settings-service.ts` guards a
value nothing consumes.

## The rule

```
ERP environment for a request = classifyPath(request path) is flagged UAT
                                  ? "Sandbox"
                                  : "Production"
```

`resolveEffectiveErpEnvironment()` becomes argument-free:

```ts
export async function resolveEffectiveErpEnvironment(): Promise<ErpBcEnvironment> {
  const formEnvironment = await resolveFormEnvironment();
  return formEnvironment === "UAT" ? "Sandbox" : "Production";
}
```

`resolveFormEnvironment()` already returns `Production` when there is no request
scope (scripts, `apply-sql`, the background email drain) and for paths it
classifies as `BOTH` or `null`, so those callers keep today's behaviour.

## ERP Prep follows AP-1

`/api/request/accounting/erp-prep/send` is the only path that posts to Business
Central. It is currently classified `BOTH`, which `resolveFormEnvironment` maps
to `Production`, and `listErpPrepRows()` reads a single pool. Without a change
here, a UAT-flagged form's approved requests can never be pushed to Sandbox —
the queue would not even see them.

`ROUTE_RULES` therefore reclassifies the prefix `/api/request/accounting/erp-prep`
from `BOTH` to `AP-1`, with a comment explaining that it is not an aggregate:
the queue's rows, the send, and the BC target must all come from one database.

Accepted consequence: while AP-1 is flagged UAT, the ERP Prep queue is the UAT
queue, and real payments cannot be processed through it. AP-17 rows that reach
the prep queue follow AP-1's flag rather than their own; this matches today's
behaviour, where they follow a single global switch.

## Changes

### Delete

| Thing | Why |
|---|---|
| `src/components/layout/ErpEnvironmentNavBadge.tsx` and both usages in `Navbar.tsx` | the switch being removed |
| `getGlobalErpInterfaceEnvironment`, `setGlobalErpInterfaceEnvironment`, `ERP_INTERFACE_ENV_KEY`, `normalizeErpBcEnvironment` | no callers once the switch is gone |
| the `body.environment` branch of `POST /api/settings/erp-interface` | write path of the removed switch |
| `toggleEnvironment` and its state in `useErpInterfaceEnvironment` | same |
| the Production/UAT toggle inside `ErpInterfaceEnvironmentSettings.tsx` | same — the rest of the page (per-brand BC connection and target settings per environment) stays |

`Fast_Core.AppSetting.ERP_INTERFACE_ENV` and both `AccSetting.ERP_INTERFACE_ENV`
rows are left in place, unread. No migration: deleting rows buys nothing and a
migration that touches settings tables is a worse risk than a dead row.

### Change

| File | Change |
|---|---|
| `src/lib/acc/erp-environment.ts` | the rule above; `resolveEffectiveErpEnvironment()` loses `role`/`host` |
| `src/lib/form-environment/classify-path.ts` | erp-prep prefix `BOTH` → `AP-1` |
| `src/lib/acc/erp-target-profile.ts` | `resolveErpTargetProfile(code)` and `resolveAllErpTargetProfiles()` lose `role`/`host`, which they only forwarded |
| `src/lib/acc/erp-journal-context.ts` | `loadErpJournalBuildContext()` loses `role`/`host`; `canUseSandbox` in `ErpJournalBuildContext` is replaced by `erpEnvironment === "Sandbox"` at its use sites; the cache key includes the resolved environment |
| `src/lib/acc/erp-interface-send.ts` | `SendErpPersonGroupInput` / `SendErpInterfaceBatchInput` drop `role`/`host` |
| `src/app/api/request/accounting/erp-prep/send/route.ts`, `src/app/api/settings/erp-interface/route.ts`, `src/app/api/request/accounting/erp-environment/route.ts` | follow the signature changes |
| `src/lib/acc/erp-environment-shared.ts` | `ErpEnvironmentInfo` reduces to `{ effectiveEnvironment }` |
| `src/features/accounting/components/ErpEnvironmentBanner.tsx` | drop the `canUseSandbox` condition so every user on a UAT-flagged form sees it; reword — the current copy promises "ผู้ใช้อื่นจะยังคงใช้ Production เสมอ", which stops being true |
| `src/lib/constants.ts` | ERP Interface Environment card description no longer says "toggle" |
| `src/lib/acc/settings-service.ts` | comment on `ENVIRONMENT_SPECIFIC_KEYS` — the guard stays, the claim that the value drives Sandbox goes |
| `CLAUDE.md` | the ERP section and the `ERP_SANDBOX_ALLOWED_HOSTS` note |

### Keep

`ERP_SANDBOX_ALLOWED_HOSTS` and `isErpSandboxHostAllowed` stay: they still gate
the `devHostOnly` cards in `REQUEST_CARDS` and `manager-auth.ts`. Only their
role in choosing an ERP environment is removed.

## Risk

Sandbox is currently unreachable outside `localhost:3020` no matter what anyone
clicks. After this change, flagging a form UAT on the deployed host points that
form's ERP interface at Sandbox for everyone.

That is the point of a per-form switch, and it is the price of having one switch
instead of two. What stands between a mistake and the ERP: the Form Environment
page is System Admin only, the UAT pill and detail banner mark the data, and the
accounting pages carry the Sandbox banner.

## Testing

- `classify-path.test.ts`: erp-prep is `AP-1`, not `BOTH` — update the aggregate
  case and add an explicit one. Written first, watched to fail.
- No new unit test for `resolveEffectiveErpEnvironment`: it is one branch over
  `resolveFormEnvironment()`, which is already covered, and the rest is I/O.
- `npx tsc --noEmit` carries most of the weight here — the signature changes
  ripple through five files, and the compiler finds every one.

## Manual verification

On `localhost:3020` as System Admin, with AP-1 flagged UAT:

1. ERP Prep lists rows from `Rocks_Portal_Form_UAT` (id ≥ 900000), not production.
2. The send dialog names a UAT/Sandbox target.
3. The Sandbox banner shows on the accounting pages, and the navbar chip is gone.

Flip AP-1 back to Production and repeat: production rows, production target, no
banner.

## Out of scope

- Working the Production and UAT ERP queues side by side (approach A in the
  discussion — an environment selector on the ERP Prep page). Reachable later
  without undoing any of this.
- Letting AP-17 reach ERP on its own flag.
- Removing the inert `ERP_INTERFACE_ENV` rows.
