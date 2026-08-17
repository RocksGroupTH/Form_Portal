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
 * Keep only the rows whose database matches where their form resolves for the
 * viewer looking at the list.
 *
 * Merging both databases shows a person everything with their name on it, from
 * whichever database it happens to live in. That includes the half that is not
 * theirs to see right now — test requests loitering in an ordinary user's list,
 * or production ones surfacing while a tester is in UAT mode. Filtering by what
 * each form resolves to for this viewer makes the list agree with the database
 * they are actually working in.
 *
 * Nothing is deleted: the other half returns for whoever it belongs to.
 *
 * Rows with no `environment` tag come from a single-pool read and are kept as
 * they are; a form absent from the map is Production, matching the rest of the
 * system.
 *
 * Pure: the caller supplies the map, normally from
 * `resolveViewerEnvironmentMap()`.
 */
export function keepRowsInCurrentEnvironment<T extends EnvironmentTaggedRow>(
  rows: T[],
  resolved: Record<string, FormEnvironmentValue>,
): T[] {
  return rows.filter((row) => {
    if (!row.environment) return true;
    const code = (row.formCode ?? "").trim();
    const current = resolved[code] ?? "Production";
    return row.environment === current;
  });
}
