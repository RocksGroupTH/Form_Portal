# AP-2: match an employee payee by staff code, and force numeric bank accounts

**Date:** 2026-08-31
**Branch:** `feat/ap2-employee-code-match`
**Source requirement:** `docs/technical-specification-ap-systems.md` §1.1 (account number), §1.5 (vendor matching)
**Status:** Design approved by the user

## Goal

Two independent AP-2 changes, neither of which touches Business Central:

1. **§1.1** — the คู่ค้า bank-account field accepts digits only.
2. **§1.5** — when the payee is an **employee**, pick the BC vendor by the employee's **staff code** instead of guessing from the name. The user's accounting team will type that code into the Vendor Master's **"Home Page"** field in BC. A **คู่ค้า** payee keeps the existing name matcher untouched.

Out of scope: AP-1, AP-3, AP-17, the on-behalf date bug (§1.4 — needs reproducing first, tracked separately), creating vendor cards from the portal (§1.5 second bullet — deferred by the user).

---

## Why this is possible without an AL change

"Home Page" is a **standard BC Vendor field**, exposed by BC Standard API v2.0 `/vendors` as **`website`**. Three facts make this a portal-only change:

- `ErpVendors.Website` **already exists** (nvarchar) — no migration.
- The portal **already read it**: commit `7f4a289` ("sync vendors from RPCCodexStore in a single BC call") is what removed the Standard-API pull, including `.input("website", …)` and `Website = @website`.
- The helpers it used are still exported: `buildBcApiV2CompanyEntityUrl` and `fetchBcApiV2Collection` in `src/lib/bc/bc-odata.ts`.

The custom RPC `RPCCodexStore_CodexGetVendors` does **not** return a home-page field (`CodexVendorRow` = no/name/searchName/address/city/postCode/phoneNo/contact/vendorPostingGroup/genBusPostingGroup/vatBusPostingGroup/paymentTermsCode/currencyCode/blocked/privacyBlocked/lastDateModified), and asking BC to add one would be an AL change — which this design avoids.

**Current data (verified 2026-08-31):** 181 active vendors in posting group `ADV`; **175 have Thai display names**; **`Website` is empty on every one of them** — nobody has filled Home Page yet. Five already carry a `[10005]`-style code prefix inside the display name; that convention is *not* used by this design.

---

## Design

### 1. Numeric bank account (§1.1)

`src/features/advance/components/AdvanceForm.tsx` renders `payeeBankAccount` only for `payeeType === "vendor"` (an employee payee's account is read from HR and displayed, never typed). Strip every non-digit as the user types and hint the numeric keypad:

```tsx
<input ref={payeeBankAccountRef} className={fieldClass} style={fieldStyle}
  value={payeeBankAccount} disabled={readOnly}
  inputMode="numeric"
  aria-invalid={!!errors.payeeBankAccount}
  aria-describedby={errors.payeeBankAccount ? "err-payeeBankAccount" : undefined}
  onChange={(e) => { setPayeeBankAccount(e.target.value.replace(/\D+/g, "")); clearError("payeeBankAccount"); }} />
```

The existing required-field validation is unchanged. Pasting text with digits in it keeps the digits rather than rejecting the paste.

### 2. Bring Home Page into `ErpVendors`

Add an **enrich pass** to `syncBrandErpVendors` in `src/lib/erp/vendor-sync.ts`, mirroring the shape of the `enrichVendorPostingGroups` pass that already exists. The RPC stays the source of truth for everything it returns (it carries the posting group the ADV filter needs); the Standard API is consulted **only** for `number` + `website`, and the pass **only** writes the `Website` column.

- URL: `buildBcApiV2CompanyEntityUrl(connection.BaseUrl, bcId, "vendors", ERP_VENDOR_SOURCE_ENVIRONMENT)` with `$select=number,website`.
- Fetch with `fetchBcApiV2Collection`, then `UPDATE ErpVendors SET Website = @website WHERE BrandCode = @brand AND VendorNo = @no`.
- **Failure is non-fatal.** The posting-group enrich throws because the ADV filter cannot work without it; Home Page is an optional matching aid, so a failure here is logged and the sync still reports success. A brand whose BC profile is incomplete is skipped the same way.

### 3. Match an employee payee by staff code

New in `src/lib/adv/advance-erp-master-service.ts`:

```ts
/**
 * The selectable ADV vendor whose Home Page holds this staff code.
 *
 * Returns null when nothing matches AND when more than one vendor claims the
 * same code — an ambiguous code must never silently pick one of them; the
 * caller falls back to name matching instead.
 */
export async function findVendorByEmployeeCode(
  company: string,
  staffId: number,
): Promise<{ vendorNo: string; displayName: string | null } | null>;
```

It applies the same selectability rules as `listVendors` (`IsActive = 1`, `IsBlocked = 0 OR NULL`, `VendorPostingGroup = 'ADV'`, matching `BrandCode`) and compares `LTRIM(RTRIM(Website)) = CAST(@staffId AS nvarchar)`. Home Page is agreed to hold a **plain number** (e.g. `10177`), so the comparison is exact after trimming — no prefix parsing.

In `matchAdvanceVendor` (`src/lib/adv/vendor-match-service.ts`), immediately before the existing `runVendorMatch(...)` call:

```ts
// An employee payee is the requester, and their staff code is on the vendor's
// Home Page — an exact key beats guessing at a name (175 of 181 ADV vendors
// carry Thai names). Falls through to the name matcher when there is no code
// on file yet, which is every vendor until accounting fills the field in.
if (a.payeeType === "employee" && req.staffId != null) {
  const byCode = await findVendorByEmployeeCode(company, req.staffId);
  if (byCode) {
    const result: VendorMatchResult = {
      status: "suggested",
      vendorNo: byCode.vendorNo,
      vendorName: byCode.displayName,
      confidence: "high",
      reason: `จับคู่จากรหัสพนักงาน ${req.staffId} (Home Page)`,
    };
    await writeMatch(requestId, result);
    return result;
  }
}
```

`req` and `a` are already in scope there; `company` is already resolved through `resolveAdvanceInterfaceCompany`.

### Three decisions, stated

1. **Always fall back to the name matcher.** Home Page is empty on all 181 vendors today, so without a fallback employee matching would return nothing from the day this ships. The fallback keeps today's behaviour and lets accounting fill the field in gradually.
2. **A code match is `suggested`, never auto-`confirmed`.** The ACC_OFFICER still confirms, and the existing "no confirmed vendor → cannot approve" gate is untouched.
3. **An ambiguous code matches nothing.** Two vendors carrying the same code fall back rather than have one picked arbitrarily.

A code match short-circuits before `askHaiku`, so employee advances stop calling the LLM once their codes are filled in — faster and cheaper. คู่ค้า advances are unaffected.

---

## Error handling

- The enrich pass swallows its own failure (logged, sync still succeeds) — see §2.
- `findVendorByEmployeeCode` returning null is a normal path, not an error: matching continues down the existing route.
- No new user-facing error strings. Everything else keeps the messages it has.

## Testing

- Unit (`src/lib/adv/vendor-match-normalize.test.ts` is pure-helper only, so the new tests go beside the service): the numeric-strip behaviour is a UI concern and is verified manually; the matching branch is covered by asserting `findVendorByEmployeeCode` is preferred over the LLM when it returns a hit, and that a null result falls through to `runVendorMatch`.
- `npm run typecheck` and `npm test` must pass. **Do not run `npm run build`** — it shares `.next` with the running dev server.
- Manual on UAT: set a known staff code (e.g. `10177`) into one PCTH ADV vendor's Home Page in BC, run Sync Vendor, open an employee-payee advance at the ACC_OFFICER step and confirm the badge shows that vendor with the "จับคู่จากรหัสพนักงาน" reason; confirm a คู่ค้า advance still matches by name; confirm an employee whose code is absent still gets a name-based suggestion.

## Files

- Modify: `src/features/advance/components/AdvanceForm.tsx` (numeric account input)
- Modify: `src/lib/erp/vendor-sync.ts` (Home Page enrich pass)
- Modify: `src/lib/adv/advance-erp-master-service.ts` (`findVendorByEmployeeCode`)
- Modify: `src/lib/adv/vendor-match-service.ts` (employee branch before the LLM)

## Follow-ups (not this change)

- §1.4 on-behalf date-lock bug — reproduce first, then fix.
- §1.5 create-a-vendor-card from the portal — deferred by the user; accounting creates the card in BC and fills Home Page there.
- Nothing here helps until accounting starts filling Home Page; consider a report of ADV vendors with an empty Home Page if adoption needs chasing.
