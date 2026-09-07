/**
 * Pure orchestration for AP-2 vendor matching — no IO, no server-only guard.
 * Unit-tested in vendor-match-service.test.ts via a fake lookup.
 *
 * vendor-match-service.ts (server-only) wraps this with the real DB lookup.
 */
/** A vendor the matcher can land on. */
export interface VendorCandidate {
  vendorNo: string;
  displayName: string | null;
}

export type VendorMatchStatus = "pending" | "suggested" | "confirmed" | "none";
export type VendorMatchConfidence = "high" | "medium" | "low";

export interface VendorMatchResult {
  status: Exclude<VendorMatchStatus, "confirmed">;   // matcher never auto-confirms
  vendorNo: string | null;
  vendorName: string | null;
  confidence: VendorMatchConfidence | null;
  reason: string | null;
}

/** What the Home Page lookup found: the one vendor, nothing, or too many. */
export type EmployeeCodeLookup =
  | { kind: "found"; vendor: VendorCandidate }
  | { kind: "none" }
  | { kind: "ambiguous" };

export type FindVendorByCode = (staffId: number) => Promise<EmployeeCodeLookup>;

/**
 * The vendor for an advance, found from the **requester's** staff code on a
 * vendor's Home Page. IO injected so it can be tested.
 *
 * This runs for every request, whoever the money is transferred to (decision:
 * user, 2026-09-07). The advance is owed by the person who took it: the company
 * debits *their* subledger account and they are the one who clears it in AP-3,
 * which credits the same vendor back. Paying a คู่ค้า on their behalf changes
 * where the transfer lands, not who owes the money — so the payee's name no
 * longer decides the vendor, and the LLM name matcher it fed is gone.
 *
 * **Never guesses.** Every case that is not exactly one vendor carrying the code
 * resolves to `none` with a reason saying what to do, and the officer picks by
 * hand: no staff id, no vendor carrying it, or more than one — the last being a
 * data error in BC that a guess would hide behind a confident suggestion.
 *
 * This is strict on purpose, and it is not free: only 1 of PCTH's 106 ADV
 * vendors carries a code today, so nearly every request arrives unmatched until
 * accounting fills the field in. That was the choice — a blank the officer
 * fills beats a plausible wrong vendor in the subledger.
 *
 * Never returns `confirmed` — the officer still confirms.
 */
export async function runRequesterCodeMatch(
  staffId: number | null | undefined,
  findByCode: FindVendorByCode,
): Promise<VendorMatchResult> {
  const noStaffId: VendorMatchResult = {
    status: "none", vendorNo: null, vendorName: null, confidence: null,
    reason: "ไม่พบรหัสพนักงานของผู้ขอ — เลือก vendor เอง",
  };
  if (staffId == null) return noStaffId;

  const hit = await findByCode(staffId);
  if (hit.kind === "none") {
    return {
      status: "none", vendorNo: null, vendorName: null, confidence: null,
      reason: `ยังไม่มี vendor ใบใดระบุรหัสพนักงาน ${staffId} ใน Home Page — เลือก vendor เอง แล้วแจ้งบัญชีให้กรอกใน ERP`,
    };
  }
  if (hit.kind === "ambiguous") {
    return {
      status: "none", vendorNo: null, vendorName: null, confidence: null,
      reason: `มี vendor มากกว่าหนึ่งใบที่ระบุรหัสพนักงาน ${staffId} ใน Home Page — เลือก vendor เอง แล้วแจ้งบัญชีให้แก้ข้อมูลใน ERP`,
    };
  }
  return {
    status: "suggested",
    vendorNo: hit.vendor.vendorNo,
    vendorName: hit.vendor.displayName,
    confidence: "high",
    reason: `จับคู่จากรหัสพนักงานผู้ขอ ${staffId} (Home Page)`,
  };
}

