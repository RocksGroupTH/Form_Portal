import "server-only";
import { resolveApiKey } from "@/lib/api-keys/service";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getRequest } from "@/lib/adv/advance-request-service";
import {
  prefilterVendors, listVendors, findSelectableVendor, isVendorSelectable, findVendorByEmployeeCode,
} from "@/lib/adv/advance-erp-master-service";
import { resolveAdvanceInterfaceCompany } from "@/lib/adv/advance-erp-context";
import type { VendorCandidate } from "@/lib/adv/vendor-match-normalize";
import {
  runVendorMatch,
  runEmployeeCodeMatch,
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

/** Thrown for user-facing vendor-confirm validation failures (safe to show the client). */
export class VendorConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorConfirmError";
  }
}

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

/** Force a row back to 'pending' (bypasses writeMatch's null/pending guard) —
 *  used when a previously-confirmed vendor is no longer selectable in BC. */
async function resetMatchToPending(requestId: number): Promise<void> {
  const pool = await getAccPool();
  await pool.request().input("rid", sql.Int, requestId).query(`
    UPDATE [dbo].[AccAdvance]
    SET MatchedVendorNo = NULL, MatchedVendorName = NULL,
        VendorMatchStatus = 'pending', VendorMatchConfidence = NULL,
        VendorMatchReason = NULL, VendorConfirmedBy = NULL, VendorMatchedAt = SYSDATETIME()
    WHERE RequestId = @rid`);
}

/**
 * Run matching for one advance if it is still pending/NULL, persist and return
 * the result. Idempotent: already-suggested/confirmed rows are returned untouched.
 */
export async function matchAdvanceVendor(requestId: number): Promise<VendorMatchResult | null> {
  const req = await getRequest(requestId);
  if (!req?.advance || !req.brandCode) return null;
  const a = req.advance;
  // ErpVendors is keyed by the BC interface Company (PCTH/KSI/…), not the portal
  // brand (ROCKS/…), so resolve before any vendor lookup.
  const company = await resolveAdvanceInterfaceCompany(req.brandCode);
  const st = a.vendorMatchStatus;
  if (st === "confirmed") {
    // Spec §7: if the confirmed vendor is no longer selectable (blocked/removed
    // in BC), force re-selection; otherwise return the confirmed pick.
    if (a.matchedVendorNo && (await isVendorSelectable(company, a.matchedVendorNo))) {
      return { status: "suggested", vendorNo: a.matchedVendorNo, vendorName: a.matchedVendorName,
        confidence: a.vendorMatchConfidence, reason: a.vendorMatchReason };
    }
    await resetMatchToPending(requestId);
    // fall through to re-run matching below
  } else if (st === "suggested" || st === "none") {
    return { status: st, vendorNo: a.matchedVendorNo, vendorName: a.matchedVendorName,
      confidence: a.vendorMatchConfidence, reason: a.vendorMatchReason };
  }
  // An employee payee IS the requester, and accounting records their staff code
  // on the vendor's Home Page — an exact key beats guessing at a name, and 175
  // of the 181 ADV vendors carry Thai names. Falls through to the name matcher
  // when no code is on file, which is every vendor until accounting fills the
  // field in, so nothing regresses on the day this ships.
  const byCode = await runEmployeeCodeMatch(
    a.payeeType,
    req.staffId,
    (id) => findVendorByEmployeeCode(company, id),
  );
  if (byCode) {
    await writeMatch(requestId, byCode);
    return byCode;
  }

  const result = await runVendorMatch(
    a.payeeName ?? "",
    makeFetchCandidates(company),
    askHaiku,
  );
  await writeMatch(requestId, result);
  return result;
}

/** Officer confirms/overrides. Validates the vendor is still selectable. */
export async function confirmAdvanceVendor(
  requestId: number, company: string, vendorNo: string, userId: number,
): Promise<void> {
  // Callers pass the portal brand; ErpVendors is keyed by the interface Company.
  const co = await resolveAdvanceInterfaceCompany(company);
  const picked = await findSelectableVendor(co, vendorNo);
  if (!picked) throw new VendorConfirmError("Vendor นี้ถูกระงับหรือไม่มีอยู่แล้ว — เลือกใหม่");
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
