/** Pure helpers for AP-2 vendor matching — no IO, unit-tested. */

export interface VendorCandidate {
  vendorNo: string;
  displayName: string | null;
}

const TH_SUFFIXES = ["บริษัท", "จำกัด", "มหาชน", "หจก", "ห้างหุ้นส่วนจำกัด", "ห้างหุ้นส่วน"];
const EN_SUFFIXES = ["co ltd", "co", "ltd", "limited", "company", "corporation", "corp", "inc", "plc"];

/** Lower-case, strip punctuation, collapse spaces, drop common company suffixes. */
export function normalizePayeeName(raw: string | null | undefined): string {
  let s = (raw ?? "").toLowerCase();
  s = s.replace(/[.,()"'`/\\-]+/g, " ");          // punctuation → space
  s = s.replace(/\s+/g, " ").trim();
  // Collapse runs of space-separated single characters into one token (e.g. "a c m e" → "acme")
  s = s.replace(/\b(\S)\s(?=(\S\s)*\S\b)/g, (_, c) => c);
  s = s.replace(/\s+/g, " ").trim();
  for (const suf of TH_SUFFIXES) s = s.split(suf).join(" ");
  for (const suf of EN_SUFFIXES) {
    s = s.replace(new RegExp(`(^|\\s)${suf}(\\s|$)`, "g"), " ");
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Sort candidates: exact normalized match first, then by normalized-substring, then name. */
export function rankCandidates(normalizedPayee: string, candidates: VendorCandidate[]): VendorCandidate[] {
  const score = (c: VendorCandidate): number => {
    const n = normalizePayeeName(c.displayName);
    if (n && n === normalizedPayee) return 0;
    if (n && (n.includes(normalizedPayee) || normalizedPayee.includes(n))) return 1;
    return 2;
  };
  return [...candidates].sort((a, b) => {
    const s = score(a) - score(b);
    if (s !== 0) return s;
    return (a.displayName ?? a.vendorNo).localeCompare(b.displayName ?? b.vendorNo);
  });
}

export type MatchDecision =
  | { mode: "none" }
  | { mode: "exact"; vendorNo: string; displayName: string | null }
  | { mode: "ambiguous" };

/**
 * Decide without the LLM where possible (token economy):
 *  - 0 candidates → none
 *  - exactly one candidate AND it is normalized-equal → exact
 *  - otherwise → ambiguous (caller asks Haiku)
 */
export function decideMatch(normalizedPayee: string, candidates: VendorCandidate[]): MatchDecision {
  if (candidates.length === 0) return { mode: "none" };
  if (candidates.length === 1) {
    const c = candidates[0];
    if (normalizePayeeName(c.displayName) === normalizedPayee && normalizedPayee.length > 0) {
      return { mode: "exact", vendorNo: c.vendorNo, displayName: c.displayName };
    }
    return { mode: "ambiguous" };
  }
  return { mode: "ambiguous" };
}
