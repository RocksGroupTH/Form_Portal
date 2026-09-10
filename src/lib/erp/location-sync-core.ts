/**
 * Pure shaping for the Location sync — no IO, no server-only imports, so it can
 * be unit-tested. `location-sync.ts` wraps this with the BC call and the writes.
 */

/** Shape returned by RPCCodexStore_CodexGetLocations. */
export interface CodexLocationRow {
  code?: string | null;
  name?: string | null;
  branch?: string | null;
  bu?: string | null;
  department?: string | null;
}

export interface NormalizedLocation {
  code: string;
  displayName: string | null;
  branchCode: string | null;
  buCode: string | null;
  departmentCode: string | null;
  rawJson: string;
}

/** Trimmed, or null — never an empty string. See `normalizeLocationRow`. */
function clean(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s === "" ? null : s;
}

/**
 * One BC row as it will be stored, or null when it cannot be.
 *
 * A row with no Location code identifies nothing — there is no key to merge it
 * on — so it is dropped rather than written under an empty one.
 *
 * Blank fields become NULL rather than "". The BU lookup treats a missing BU as
 * "no answer" and lets the codeunit fall back to its own default; an empty
 * string would read as an answer and send a blank dimension instead.
 */
export function normalizeLocationRow(raw: CodexLocationRow): NormalizedLocation | null {
  const code = clean(raw.code);
  if (!code) return null;
  return {
    code,
    displayName: clean(raw.name),
    branchCode: clean(raw.branch),
    buCode: clean(raw.bu),
    departmentCode: clean(raw.department),
    // Kept so a field BC starts returning later can be read out of history
    // instead of needing a re-sync to discover it.
    rawJson: JSON.stringify(raw),
  };
}
