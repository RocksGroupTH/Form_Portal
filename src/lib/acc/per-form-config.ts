/**
 * The default/override rule for the brand-keyed ERP configuration tables.
 *
 * `FormCode NULL` is the default and answers every form. A row naming a form
 * overrides the default for that form alone. Most configuration is the same
 * for every form, so a new form needs no rows at all until somebody wants it
 * to differ.
 *
 * This lives in one place on purpose. Seven hand-written copies of the same
 * ORDER BY is how one of them loses the `IS NULL` arm and silently reads
 * another form's configuration — and a wrong read here decides where money
 * posts. Imports nothing, so the rule is unit-tested without a database.
 */

/** Bind `@formCode` alongside `@brandCode`. Both arms, always. */
export function perFormPredicate(alias?: string): string {
  const col = alias ? `${alias}.FormCode` : "FormCode";
  return `(${col} = @formCode OR ${col} IS NULL)`;
}

/**
 * @deprecated Use `perFormPredicate()`. Kept so an unaliased caller reads the
 * same either way; a joined query must call the function with its alias.
 */
export const PER_FORM_PREDICATE = perFormPredicate();

/** Form-specific rows sort before the default. */
export function perFormOrderBy(alias?: string): string {
  const col = alias ? `${alias}.FormCode` : "FormCode";
  return `CASE WHEN ${col} IS NULL THEN 1 ELSE 0 END`;
}

/**
 * Pick the row that answers for `formCode`: its own if it has one, else the
 * default. Returns null when neither exists — never another form's row.
 */
export function pickForForm<T extends { formCode: string | null }>(
  rows: T[],
  formCode: string,
): T | null {
  let fallback: T | null = null;
  for (const row of rows) {
    if (row.formCode === formCode) return row;
    if (row.formCode === null && fallback === null) fallback = row;
  }
  return fallback;
}

/**
 * `pickForForm` applied per natural key — the list form of the same rule.
 *
 * A list read returns several rows per brand (one per account, batch or branch
 * code), so the pick happens once per *natural key*: the table's unique index
 * minus `FormCode`. `keyOf` names that key. A form's own row replaces the
 * default with the same key; defaults it does not override still answer.
 *
 * Reducing is not optional. `perFormOrderBy` sorts, it does not pick, so a
 * caller that applies the predicate and stops gets the override *and* the
 * default for the same key — and whichever the consumer happens to read first
 * wins. Grouping is order-independent; the output keeps each key's first
 * appearance, so the caller's business ORDER BY survives.
 */
export function pickAllForForm<T extends { formCode: string | null }>(
  rows: T[],
  formCode: string,
  keyOf: (row: T) => string,
): T[] {
  const groups = new Map<string, T[]>();
  const order: string[] = [];
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(row);
    } else {
      groups.set(key, [row]);
      order.push(key);
    }
  }

  const out: T[] = [];
  for (const key of order) {
    const picked = pickForForm(groups.get(key) as T[], formCode);
    if (picked) out.push(picked);
  }
  return out;
}

/** The shared rows — what an editor shows when it is editing the default. */
export function defaultsOnly<T extends { formCode: string | null }>(rows: T[]): T[] {
  const out: T[] = [];
  for (const row of rows) if (row.formCode === null) out.push(row);
  return out;
}

/**
 * The SQL that bounds a *write* to one form's rows.
 *
 * `FormCode = @formCode` never matches NULL, so an editor saving the default
 * needs `FormCode IS NULL` instead. Getting this wrong is not a failed write,
 * it is an UPDATE or DELETE that sweeps the default and every override for the
 * brand together.
 */
export function perFormWriteMatch(formCode: string | null, alias?: string): string {
  const col = alias ? `${alias}.FormCode` : "FormCode";
  return formCode === null ? `${col} IS NULL` : `${col} = @formCode`;
}
