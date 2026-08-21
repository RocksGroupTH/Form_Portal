# Form Portal

Internal request and forms portal for Rocks Group — travel expense reimbursement
(AP-1) and travel booking (AP-17), with a Microsoft Entra ID sign-in, a shared
approval backbone and a Dynamics 365 Business Central posting path.

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · MSSQL.

> Cloned from the **Rocks Fast** codebase with Fast Intelligence and Locations
> removed. The two apps still share live infrastructure — read
> [CLAUDE.md → Shared with Rocks Fast](CLAUDE.md#shared-with-rocks-fast) before
> operating on SharePoint, Fast_Core or attachment storage.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in credentials
npm run dev                  # http://localhost:3081
```

Sign-in needs `http://localhost:3081/api/auth/callback/microsoft-entra-id`
registered on the Entra app registration. `trustHost: true` means NextAuth
builds `redirect_uri` from the incoming `Host` header, so a port change without
a matching registration fails with `AADSTS50011` before any app code runs.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3081 |
| `npm run build` / `npm start` | Production build / serve on 3081 |
| `npm test` | Unit suite — `scripts/run-tests.ts` **discovers** `src/**/*.test.ts` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run apply-sql -- --db <name> --file <path>` | Apply one migration |
| `npm run check:alignment` | Assert the 21 dual-written master tables match across Production and UAT |

`npm test` discovers its own files — adding a test needs no registration step.
If `tsc` reports phantom `TS2307` errors from `.next/types`, delete `.next` and
re-run; a stale build directory outlives a branch switch.

## Layout

```
src/app/          Routes — (auth), (dashboard), api/
src/features/     Feature UI — accounting (AP-1), travel-booking (AP-17), home, settings
src/components/   Shared ui/ primitives and layout/ chrome
src/lib/          Domain logic — acc/, db/, team-member/, erp/, bc/, hr/, form-environment/
src/env.ts        Type-safe environment schema — a key absent from it is read by nothing
migrations/       Numbered SQL. Every file names its target database in its header
scripts/          apply-sql, run-tests, seed, and one-off checks/ verifiers
docs/             Design specs, plans, archived reviews, and the UI guide
```

Unit tests live beside the code they cover as `*.test.ts`.

## Databases

Six databases, one isolated pool each — never the global `sql.connect()`.

| Database | Holds |
|---|---|
| `Rocks_Portal_Form` | This app's own data: forms, requests, approvals, files, `Acc*` tables, **and `TeamMember` identity** |
| `Rocks_Portal_Form_UAT` | The UAT twin, served to configured testers |
| `Fast_Core` | Shared config, brand/connection settings, plus this app's `FormEnvironment` and `UatTester` |
| `Fast_Data` | `TravelProvince`, the AP-17 province lookup — the only table this app still reads here, since the Business Central sync tables moved to `Rocks_ERP_Data` (migrations 101/102). The database also holds Rocks Fast's Intelligence tables, which this app never touches. (The department map moved out of `Fast_Core`, not out of here — migrations 099/100.) |
| `Rocks_ERP_Data` | Business Central sync mirror — `ErpAccounts`, `ErpDimensionValue`, `ErpGeneralJournalBatch`, `ErpBankAccountCard`, `ErpSyncLog` (migrations 101/102). `Fast_Data` keeps a synonym per table for the two sibling apps |
| `Rocks_Portal_HR` | Employee master and manager chain |

`Fast_Form` belongs to the Rocks Fast sibling — this app must not touch it, and a
query naming `[Fast_Core].[dbo].[TeamMember]` is reading the sibling's roster.

Production and UAT run **side by side in one deployment**: ordinary users get
`Rocks_Portal_Form`, configured testers in UAT mode get the `_UAT` twin, at the
same time on the same server. The resolution rules are exact and load-bearing —
see [CLAUDE.md → Parallel Production and UAT](CLAUDE.md#parallel-production-and-uat).

Standing up a fresh form database takes migration `059` **and** `066`, in that
order, or nobody can sign in at all.

## Conventions

Parameterized SQL only. `requireAuth()` proves *a* session — any route reaching a
record by id also calls `authorizeAccRequest()`. Attachments are admitted by
magic bytes, never `File.type`. State transitions claim with a conditional
`UPDATE … WHERE <expected state>` and check `rowsAffected`. CSS uses
`var(--token)`, never raw hex.

The full set, and the reasoning behind each, is in
[CLAUDE.md → Conventions](CLAUDE.md#conventions).

## Documentation

| Where | What |
|---|---|
| [CLAUDE.md](CLAUDE.md) | The developer guide — architecture, auth, UAT, conventions, deployment. Start here. |
| [docs/UI-GUIDE.md](docs/UI-GUIDE.md) | The Sky design system, portable to other Rocks Group apps |
| [docs/](docs/README.md) | Design specs, implementation plans, archived reviews |

## Deployment

Live at **https://form.portal.rocksgroup.com**, behind Cloudflare → IIS/ARR →
`next start`. Liveness probe: `GET /api/health`.

**The ARR proxy must have `reverseRewriteHostInResponseHeaders="false"`.** On
its default (`true`) it rewrites the host of every `Location` header to the
public host, including the one that starts Microsoft sign-in — so sign-in breaks
in a way that looks like an app fault but reproduces nowhere except behind the
proxy. Details, the measured evidence and the fix are in
[CLAUDE.md → Deployment](CLAUDE.md#deployment), along with the rest of the
checklist and the ordering constraints on the parallel-UAT migrations.
