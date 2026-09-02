/**
 * Pure orchestration for AP-2 vendor matching — no IO, no server-only guard.
 * Unit-tested in vendor-match-service.test.ts via fake fetchCandidates / askLlm.
 *
 * vendor-match-service.ts (server-only) wraps this with real DB / Haiku IO.
 */
import {
  normalizePayeeName,
  rankCandidates,
  decideMatch,
  type VendorCandidate,
} from "@/lib/adv/vendor-match-normalize";

export type VendorMatchStatus = "pending" | "suggested" | "confirmed" | "none";
export type VendorMatchConfidence = "high" | "medium" | "low";

export interface VendorMatchResult {
  status: Exclude<VendorMatchStatus, "confirmed">;   // matcher never auto-confirms
  vendorNo: string | null;
  vendorName: string | null;
  confidence: VendorMatchConfidence | null;
  reason: string | null;
}

export interface LlmPick { vendorNo: string; confidence: VendorMatchConfidence; reason: string }
export type FetchCandidates = (payeeName: string) => Promise<VendorCandidate[]>;
export type AskLlm = (payeeName: string, candidates: VendorCandidate[]) => Promise<LlmPick | null>;
/** What the Home Page lookup found: the one vendor, nothing, or too many. */
export type EmployeeCodeLookup =
  | { kind: "found"; vendor: VendorCandidate }
  | { kind: "none" }
  | { kind: "ambiguous" };

export type FindVendorByCode = (staffId: number) => Promise<EmployeeCodeLookup>;

/**
 * The employee-code match, with its IO injected so it can be tested.
 *
 * Returns null only where the name matcher should take over: a non-employee
 * payee, a missing staff id, or **no** vendor carrying the code — which is
 * almost every vendor until accounting fills the Home Page field in, so the
 * fall-through is what keeps matching working at all today.
 *
 * `ambiguous` is different and must NOT fall through: two vendors sharing a
 * staff code is a data error, and guessing at the name instead would hide it
 * behind a confident-looking suggestion. It resolves to `none` so the officer
 * picks by hand, with a reason that says what to fix.
 *
 * Never returns `confirmed` — the officer still confirms.
 */
export async function runEmployeeCodeMatch(
  payeeType: string | null | undefined,
  staffId: number | null | undefined,
  findByCode: FindVendorByCode,
): Promise<VendorMatchResult | null> {
  if (payeeType !== "employee" || staffId == null) return null;
  const hit = await findByCode(staffId);
  if (hit.kind === "none") return null;
  if (hit.kind === "ambiguous") {
    return {
      status: "none",
      vendorNo: null,
      vendorName: null,
      confidence: null,
      reason: `มี vendor มากกว่าหนึ่งใบที่ระบุรหัสพนักงาน ${staffId} ใน Home Page — เลือก vendor เอง แล้วแจ้งบัญชีให้แก้ข้อมูลใน ERP`,
    };
  }
  return {
    status: "suggested",
    vendorNo: hit.vendor.vendorNo,
    vendorName: hit.vendor.displayName,
    confidence: "high",
    reason: `จับคู่จากรหัสพนักงาน ${staffId} (Home Page)`,
  };
}

/** Pure-ish orchestration (IO injected) — token-economical branching. */
export async function runVendorMatch(
  payeeName: string,
  fetchCandidates: FetchCandidates,
  askLlm: AskLlm,
): Promise<VendorMatchResult> {
  const normalized = normalizePayeeName(payeeName);
  const raw = await fetchCandidates(payeeName); // intentionally raw — SQL LIKE matches original casing/punctuation
  const candidates = rankCandidates(normalized, raw);
  const decision = decideMatch(normalized, candidates);

  if (decision.mode === "none") {
    return { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  if (decision.mode === "exact") {
    return { status: "suggested", vendorNo: decision.vendorNo, vendorName: decision.displayName,
      confidence: "high", reason: "ชื่อตรงกับ vendor" };
  }
  // ambiguous → Haiku
  let pick: LlmPick | null;
  try {
    pick = await askLlm(payeeName, candidates);
  } catch {
    return { status: "pending", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  if (!pick) {
    return { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  const chosen = candidates.find((c) => c.vendorNo === pick!.vendorNo);
  if (!chosen) {
    return { status: "none", vendorNo: null, vendorName: null, confidence: null, reason: null };
  }
  return { status: "suggested", vendorNo: chosen.vendorNo, vendorName: chosen.displayName,
    confidence: pick.confidence, reason: (pick.reason ?? "").slice(0, 500) }; // VendorMatchReason is NVARCHAR(500) — migration 119
}
