/**
 * AP-3 (เคลียร์คืนเงินทดรองจ่าย / Clear Advance) constants.
 *
 * AP-3 clears an approved AP-2 advance. It reuses the shared request header
 * (AccRequest) but owns its own detail + approval tables (AccClearAdvance*),
 * because its approval chain (Manager → Account) is not one the shared
 * AccApproval CHECK constraint allows. It had a third step, head accounting,
 * until the CR of 2026-09-11 removed it.
 */

export const AP3_FORM_CODE = "AP-3";

/** AccSequence prefix → running no. like "ADC26-00001" (RPC-ADCyy-xxxx). */
export const AP3_SEQUENCE_PREFIX = "ADC";

/** Phase 1 locks the currency to THB. */
export const AP3_DEFAULT_CURRENCY = "THB";

/** Fixed approval chain, in order. */
export const CLR_STEP_CODES = ["MANAGER", "ACCOUNT"] as const;
export type ClrStepCode = (typeof CLR_STEP_CODES)[number];

/**
 * A step the chain no longer has, kept because requests already went through it.
 *
 * Head accounting approved after the account officer until 2026-09-11, when the
 * CR removed it. Nothing writes a `HEAD` row any more, but 29 of them exist and
 * their requests still have to be able to say so.
 */
export const CLR_RETIRED_STEP_CODES = ["HEAD"] as const;
export type ClrRetiredStepCode = (typeof CLR_RETIRED_STEP_CODES)[number];

/** Every step code the data can hold — the chain plus what it used to be. */
export type ClrAnyStepCode = ClrStepCode | ClrRetiredStepCode;

/** The steps in the order they happened, the retired ones in their old place. */
export const CLR_HISTORICAL_STEP_ORDER = [...CLR_STEP_CODES, ...CLR_RETIRED_STEP_CODES] as const;

export const CLR_STEP_LABEL_TH: Record<ClrAnyStepCode, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี (Account Office)",
  HEAD: "หัวหน้าบัญชี (Head Accounting)",
};

/**
 * The next step after each step (null = finished → request Approved).
 *
 * This, not the database, is what enforces the chain: both AP-3 CHECK
 * constraints still accept `HEAD` and are deliberately left that way, because
 * narrowing them would fail against the rows already written under the old
 * chain.
 */
export const CLR_NEXT_STEP: Record<ClrStepCode, ClrStepCode | null> = {
  MANAGER: "ACCOUNT",
  ACCOUNT: null,
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
