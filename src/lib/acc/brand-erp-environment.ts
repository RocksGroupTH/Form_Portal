import type { ErpBcEnvironment } from "@/lib/acc/erp-environment-shared";

/**
 * **Which Business Central environment a per-brand Interface ERP setting was
 * chosen for — the one place that rule is written.**
 *
 * Four tables carry an `Environment` column since migration 161:
 * `AccBrandJournalBatch`, `AccBrandGlAccount`, `AccBrandBankAccount` and
 * `AccBrandBranchCode`. Every value in them is **the name of an object inside
 * one BC company** — a batch, an account number, a bank card, a BRANCH
 * dimension value — so a value picked from Production's chart may simply not
 * exist in Sandbox, and a journal built from it fails at the moment somebody
 * presses Send.
 *
 * The user asked for the split on 2026-09-23: *"เวลาส่ง interface ERP หรือ
 * Setting ใช้ข้อมูลคนละชุดกัน ข้อมูลไม่เท่ากันอาจจะทำให้ interface ERP ไม่สำเร็จ"*.
 *
 * ## This is the FormCode rule's sibling, and the two are independent axes
 *
 * `per-form-config.ts` owns *which form* a row answers for, with `NULL`
 * meaning "the default, every form". This owns *which BC* it was chosen for,
 * and there is **no default here**: a row is Production's or Sandbox's, never
 * both. Absence cannot mean "either", because the whole point is that the two
 * environments hold different objects.
 *
 * So the two predicates compose rather than overlap — `AND` them, never fold
 * one into the other. A read asks: this environment, and this form or the
 * default.
 *
 * ## Why the predicate is written here rather than typed out per query
 *
 * The same argument `per-form-config.ts` opens with. Hand-writing it is how one
 * copy loses its arm and silently reads the other environment's configuration,
 * and these tables decide the account, the bank and the batch every journal
 * line carries. It is also **not a loud failure**: the wrong row is a real row,
 * so the query succeeds and the journal posts somewhere nobody intended.
 *
 * ## `AccBrandErpInterface` is deliberately NOT one of them
 *
 * Claim brand → interface target says which company a brand's claims post into.
 * That is a decision about the business, not the name of an object inside a
 * company, and it is the same answer in both environments. Giving it an
 * environment would invite two different org charts.
 */

/** The column, so every query and the guard agree on one spelling. */
export const BRAND_ERP_ENVIRONMENT_COLUMN = "Environment";

/**
 * `Environment = @environment`, for a read or a write.
 *
 * **No `IS NULL` arm**, unlike `perFormPredicate`. The column is `NOT NULL`
 * and a row belongs to exactly one environment; an arm admitting NULL would be
 * admitting rows that cannot exist, and would read as though absence meant
 * "answers both" — which is precisely the state this column was added to end.
 *
 * `alias` for a joined query, the same shape `perFormPredicate` takes.
 */
export function brandErpEnvPredicate(alias?: string): string {
  const col = alias ? `${alias}.${BRAND_ERP_ENVIRONMENT_COLUMN}` : BRAND_ERP_ENVIRONMENT_COLUMN;
  return `${col} = @environment`;
}

/**
 * Read an environment off a query parameter or a request body.
 *
 * Three answers, and the third is the point: `undefined` for a caller that did
 * not name one — the service then resolves the request's own environment, which
 * is what every money path does — and **`null` for a value that is not one of
 * the two**, which the routes turn into a 400.
 *
 * Refusing rather than defaulting matters here more than it usually does.
 * Falling back to Production for an unrecognised value would answer the
 * Production half to a screen that asked for Sandbox, with a 200 and a real
 * list of rows: exactly the silent wrong-environment read this column was added
 * to end. The same argument `fx-cache-policy` makes about a date it cannot
 * parse — answering a question about one thing with another thing's answer is
 * worse than answering nothing.
 *
 * Trimmed and case-insensitive on the way in, then returned in the canonical
 * spelling, so `?environment=sandbox` works and what reaches the column does
 * not depend on how the caller typed it.
 */
export function parseErpBcEnvironment(value: unknown): ErpBcEnvironment | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "production") return "Production";
  if (v === "sandbox") return "Sandbox";
  return null;
}

/** The Thai refusal every route answers for a value `parseErpBcEnvironment` rejects. */
export const INVALID_ERP_ENVIRONMENT_ERROR =
  "environment ต้องเป็น Production หรือ Sandbox เท่านั้น";

/**
 * Narrow already-loaded rows to one environment.
 *
 * For the callers that read a brand's whole set and pick in TypeScript —
 * `pickForForm` and friends do the same for the form axis. Comparison is
 * case-insensitive and trimmed because the column has no CHECK: a row written
 * by hand can carry `'production'` or a trailing space, and treating that as a
 * different environment would hide a real setting rather than reject a bad one.
 */
export function rowsForEnvironment<T extends { environment?: string | null }>(
  rows: readonly T[],
  environment: ErpBcEnvironment,
): T[] {
  const want = environment.trim().toLowerCase();
  return rows.filter((r) => (r.environment ?? "").trim().toLowerCase() === want);
}

export type { ErpBcEnvironment };
