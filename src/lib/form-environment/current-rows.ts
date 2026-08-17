import type { FormEnvironmentValue } from "./service";

/**
 * A row from a merged read: it knows its form and which database answered.
 * `environment` is absent on single-pool reads.
 */
export interface EnvironmentTaggedRow {
  formCode?: string | null;
  environment?: FormEnvironmentValue;
}

/**
 * Keep only the rows whose database still matches their form's flag.
 *
 * Merging both databases shows a person everything with their name on it, from
 * whichever database it happens to live in. That includes rows a form left
 * behind when it was flagged the other way — test requests loitering in a
 * production list, or real ones surfacing mid-test. Filtering by each form's
 * current flag makes the list agree with what the form is doing today.
 *
 * Nothing is deleted: flag the form back and its rows return.
 *
 * Rows with no `environment` tag come from a single-pool read and are kept as
 * they are; a form with no flag row is Production, matching the rest of the
 * system.
 *
 * Pure: the caller supplies the flags.
 */
export function keepRowsInCurrentEnvironment<T extends EnvironmentTaggedRow>(
  rows: T[],
  flags: Record<string, FormEnvironmentValue>,
): T[] {
  return rows.filter((row) => {
    if (!row.environment) return true;
    const code = (row.formCode ?? "").trim();
    const current = flags[code] ?? "Production";
    return row.environment === current;
  });
}
