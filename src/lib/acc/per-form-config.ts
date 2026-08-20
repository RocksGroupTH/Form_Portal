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
export const PER_FORM_PREDICATE = "(FormCode = @formCode OR FormCode IS NULL)";

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

/** The shared rows — what an editor shows when it is editing the default. */
export function defaultsOnly<T extends { formCode: string | null }>(rows: T[]): T[] {
  const out: T[] = [];
  for (const row of rows) if (row.formCode === null) out.push(row);
  return out;
}
