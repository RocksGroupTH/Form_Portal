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

/** Pure-ish orchestration (IO injected) — token-economical branching. */
export async function runVendorMatch(
  payeeName: string,
  fetchCandidates: FetchCandidates,
  askLlm: AskLlm,
): Promise<VendorMatchResult> {
  const normalized = normalizePayeeName(payeeName);
  const raw = await fetchCandidates(payeeName);
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
    confidence: pick.confidence, reason: (pick.reason ?? "").slice(0, 500) };
}
