/**
 * AP-3 (เคลียร์คืนเงินทดรองจ่าย / Clear Advance) constants.
 *
 * AP-3 clears an approved AP-2 advance. It reuses the shared request header
 * (AccRequest) but owns its own detail + approval tables (AccClearAdvance*),
 * because its approval chain has three steps (Manager → Account → Head) which
 * the shared AccApproval CHECK constraint does not allow.
 */

export const AP3_FORM_CODE = "AP-3";

/** AccSequence prefix → running no. like "ADC26-00001" (RPC-ADCyy-xxxx). */
export const AP3_SEQUENCE_PREFIX = "ADC";

/** Phase 1 locks the currency to THB. */
export const AP3_DEFAULT_CURRENCY = "THB";

/** Fixed 3-step approval chain, in order. */
export const CLR_STEP_CODES = ["MANAGER", "ACCOUNT", "HEAD"] as const;
export type ClrStepCode = (typeof CLR_STEP_CODES)[number];

export const CLR_STEP_LABEL_TH: Record<ClrStepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี (Account Office)",
  HEAD: "หัวหน้าบัญชี (Head Accounting)",
};

/** The next step after each step (null = finished → request Approved). */
export const CLR_NEXT_STEP: Record<ClrStepCode, ClrStepCode | null> = {
  MANAGER: "ACCOUNT",
  ACCOUNT: "HEAD",
  HEAD: null,
};

/**
 * "เป็นค่าใช้จ่ายของ" is derived from the selected brand (no separate field).
 * These brand codes are the home company (Rocks PC) — their expenses use the
 * G/L account chosen per line. Every OTHER brand is treated as a different
 * company and its lines are forced to 110723001 (จ่ายแทนบ.อื่น / Advance - Other).
 */
export const ROCKS_PC_BRAND_CODES = ["PCTH", "ROCKS"] as const;

/** True when a brand books to its own G/L (Rocks PC), false → force 110723001. */
export function isRocksPcBrand(brandCode: string | null | undefined): boolean {
  if (!brandCode) return false;
  const code = brandCode.trim().toUpperCase();
  return (ROCKS_PC_BRAND_CODES as readonly string[]).includes(code);
}

/** AP-3.1 rule: non-home brand → every line's G/L is forced to this account. */
export const FORCE_GL_NON_ROCKS_PC = "110723001";
