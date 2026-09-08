import "server-only";
import { getAccPool, sql } from "@/lib/adv/pool";
import { getRequest } from "@/lib/adv/advance-request-service";
import {
  listVendors, findSelectableVendor, isVendorSelectable, findVendorByEmployeeCode,
} from "@/lib/adv/advance-erp-master-service";
import { resolveAdvanceInterfaceCompany } from "@/lib/adv/advance-erp-context";
import {
  runRequesterCodeMatch,
  type VendorMatchResult,
  type VendorMatchStatus,
  type VendorMatchConfidence,
} from "@/lib/adv/vendor-match-core";

// Re-export the types so callers can import from one place.
export type { VendorMatchResult, VendorMatchStatus, VendorMatchConfidence };

/** Thrown for user-facing vendor-confirm validation failures (safe to show the client). */
export class VendorConfirmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorConfirmError";
  }
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
    // in BC), force re-selection; otherwise return the confirmed pick. This
    // re-check matters more now that a match confirms itself — a vendor blocked
    // in BC after the fact is caught here rather than at the send.
    if (a.matchedVendorNo && (await isVendorSelectable(company, a.matchedVendorNo))) {
      return { status: "confirmed", vendorNo: a.matchedVendorNo, vendorName: a.matchedVendorName,
        confidence: a.vendorMatchConfidence, reason: a.vendorMatchReason };
    }
    await resetMatchToPending(requestId);
    // fall through to re-run matching below
  } else if (st === "suggested" || st === "none") {
    return { status: st, vendorNo: a.matchedVendorNo, vendorName: a.matchedVendorName,
      confidence: a.vendorMatchConfidence, reason: a.vendorMatchReason };
  }
  // Always the requester's vendor, whoever the money is transferred to — the
  // advance is owed by the person who took it, and AP-3 credits this same
  // vendor back when they clear it. `a.payeeName` no longer takes part.
  const result = await runRequesterCodeMatch(
    req.staffId,
    (id) => findVendorByEmployeeCode(company, id),
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
