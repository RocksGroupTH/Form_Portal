import "server-only";
import { resolveApiKey } from "@/lib/api-keys/service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getRequest } from "@/lib/adv/advance-request-service";
import {
  prefilterVendors, listVendors, findSelectableVendor,
} from "@/lib/adv/advance-erp-master-service";
import type { VendorCandidate } from "@/lib/adv/vendor-match-normalize";
import {
  runVendorMatch,
  type VendorMatchResult,
  type VendorMatchStatus,
  type VendorMatchConfidence,
  type LlmPick,
  type FetchCandidates,
  type AskLlm,
} from "@/lib/adv/vendor-match-core";

// Re-export the pure orchestrator and its types so callers can import from one place.
export { runVendorMatch };
export type { VendorMatchResult, VendorMatchStatus, VendorMatchConfidence, LlmPick, FetchCandidates, AskLlm };

const MODEL = process.env.ANTHROPIC_VENDOR_MATCH_MODEL || "claude-haiku-4-5-20251001"; // Model id — update on Haiku model refresh; mirrors src/lib/clr/ai-receipt.ts

/** Real candidate fetch: coarse SQL prefilter, fall back to a capped full list. */
function makeFetchCandidates(company: string): FetchCandidates {
  return async (payeeName: string) => {
    const pre = await prefilterVendors(company, payeeName, 10);
    if (pre.length > 0) return pre;
    return (await listVendors(company)).slice(0, 10);
  };
}

/** Real Haiku call. Compact prompt/output; returns null on unusable output. */
async function askHaiku(payeeName: string, candidates: VendorCandidate[]): Promise<LlmPick | null> {
  const { value: apiKey } = await resolveApiKey("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("no ANTHROPIC_API_KEY"); // → runVendorMatch treats as pending
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const list = candidates.map((c) => `${c.vendorNo}\t${c.displayName ?? ""}`).join("\n");
  const system = [
    "You match a Thai/English payee name to ONE vendor from a list.",
    "Return ONE JSON object only, no prose: {\"vendorNo\":\"..\",\"confidence\":\"high|medium|low\",\"reason\":\"<=12 words\"}.",
    "If none is a plausible match, return {\"vendorNo\":null,\"confidence\":\"low\",\"reason\":\"no match\"}.",
  ].join("\n");
  const user = `Payee: ${payeeName}\nVendors (VendorNo<TAB>DisplayName):\n${list}`;
  const res = await client.messages.create({
    model: MODEL, max_tokens: 200, system,
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  });
  const textPart = res.content.find((c) => c.type === "text");
  const rawText = textPart && "text" in textPart ? textPart.text : "";
  const m = rawText.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: { vendorNo?: string | null; confidence?: string; reason?: string };
  try {
    j = JSON.parse(m[0]) as { vendorNo?: string | null; confidence?: string; reason?: string };
  } catch {
    return null; // malformed model output → caller maps to "none"
  }
  if (!j.vendorNo) return null;
  const confidence: VendorMatchConfidence =
    j.confidence === "high" || j.confidence === "medium" || j.confidence === "low" ? j.confidence : "low";
  return { vendorNo: String(j.vendorNo).trim(), confidence, reason: String(j.reason ?? "") };
}

async function writeMatch(requestId: number, r: VendorMatchResult): Promise<void> {
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("status", sql.NVarChar, r.status)
    .input("no", sql.NVarChar, r.vendorNo)
    .input("name", sql.NVarChar, r.vendorName)
    .input("conf", sql.NVarChar, r.confidence)
    .input("reason", sql.NVarChar, r.reason)
    .query(`
      UPDATE [dbo].[AccAdvance]
      SET MatchedVendorNo = @no, MatchedVendorName = @name,
          VendorMatchStatus = @status, VendorMatchConfidence = @conf,
          VendorMatchReason = @reason, VendorMatchedAt = SYSDATETIME()
      WHERE RequestId = @rid
        AND (VendorMatchStatus IS NULL OR VendorMatchStatus = 'pending')`);
}

/**
 * Run matching for one advance if it is still pending/NULL, persist and return
 * the result. Idempotent: already-suggested/confirmed rows are returned untouched.
 */
export async function matchAdvanceVendor(requestId: number): Promise<VendorMatchResult | null> {
  const req = await getRequest(requestId);
  if (!req?.advance || !req.brandCode) return null;
  const st = req.advance.vendorMatchStatus;
  if (st === "suggested" || st === "confirmed" || st === "none") {
    return {
      status: st === "confirmed" ? "suggested" : st,   // never widen 'confirmed' back out
      vendorNo: req.advance.matchedVendorNo,
      vendorName: req.advance.matchedVendorName,
      confidence: req.advance.vendorMatchConfidence,
      reason: req.advance.vendorMatchReason,
    };
  }
  const result = await runVendorMatch(
    req.advance.payeeName ?? "",
    makeFetchCandidates(req.brandCode),
    askHaiku,
  );
  await writeMatch(requestId, result);
  return result;
}

/** Officer confirms/overrides. Validates the vendor is still selectable. */
export async function confirmAdvanceVendor(
  requestId: number, company: string, vendorNo: string, userId: number,
): Promise<void> {
  const picked = await findSelectableVendor(company, vendorNo);
  if (!picked) throw new Error("Vendor นี้ถูกระงับหรือไม่มีอยู่แล้ว — เลือกใหม่");
  const pool = await getAccPool();
  await pool.request()
    .input("rid", sql.Int, requestId)
    .input("no", sql.NVarChar, vendorNo)
    .input("name", sql.NVarChar, picked.displayName ?? null)
    .input("by", sql.Int, userId)
    .query(`
      UPDATE [dbo].[AccAdvance]
      SET MatchedVendorNo = @no, MatchedVendorName = @name,
          VendorMatchStatus = 'confirmed', VendorConfirmedBy = @by,
          VendorMatchedAt = SYSDATETIME()
      WHERE RequestId = @rid`);
}
