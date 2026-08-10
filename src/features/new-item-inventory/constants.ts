/**
 * New Item Inventory — shared constants.
 * Single source of truth for step codes, item types, statuses, and step routing.
 */

/* ── Item types ── */

export const ITEM_TYPE = {
  RM: "RM",
  FIXED_ASSET: "FIXED_ASSET",
} as const;

export type ItemType = (typeof ITEM_TYPE)[keyof typeof ITEM_TYPE];

export const ITEM_TYPE_LABEL: Record<ItemType, string> = {
  RM: "สินค้าหมุนเวียน RM (Code 2-8)",
  FIXED_ASSET: "สินทรัพย์ถาวร (9*)",
};

/* ── Request status ── */

export const REQUEST_STATUS = {
  Draft: "Draft",
  Submitted: "Submitted",
  InReview: "InReview",
  Approved: "Approved",
  Returned: "Returned",
  Rejected: "Rejected",
  BcSynced: "BcSynced",
  Complete: "Complete",
} as const;

export type RequestStatus = (typeof REQUEST_STATUS)[keyof typeof REQUEST_STATUS];

/* ── Approval step codes ── */

export const STEP_CODE = {
  PCM_MGR: "PCM_MGR",
  PLAN_MGR: "PLAN_MGR",
  SR_SCM: "SR_SCM",
  COSTING_ACC: "COSTING_ACC",
  ASSIST_AP: "ASSIST_AP",
  SALES_PL: "SALES_PL",
} as const;

export type StepCode = (typeof STEP_CODE)[keyof typeof STEP_CODE];

export const STEP_LABEL: Record<StepCode, string> = {
  PCM_MGR: "PCM Manager",
  PLAN_MGR: "Planning Manager",
  SR_SCM: "Senior Supply Chain Manager / Director",
  COSTING_ACC: "Costing ACC",
  ASSIST_AP: "Assist AP",
  SALES_PL: "Sales Price List",
};

/** All step codes in canonical workflow order. */
export const STEP_ORDER: StepCode[] = [
  "PCM_MGR",
  "PLAN_MGR",
  "SR_SCM",
  "COSTING_ACC",
  "ASSIST_AP",
  "SALES_PL",
];

/**
 * The ordered set of approval steps that apply to a given item type.
 * Fixed Asset items skip Planning Manager and Sales Price List.
 */
export function stepsForItemType(itemType: ItemType): StepCode[] {
  if (itemType === ITEM_TYPE.FIXED_ASSET) {
    return ["PCM_MGR", "SR_SCM", "COSTING_ACC", "ASSIST_AP"];
  }
  return ["PCM_MGR", "PLAN_MGR", "SR_SCM", "COSTING_ACC", "ASSIST_AP", "SALES_PL"];
}

/* ── Request number ── */

export const REQUEST_NO_PREFIX = "NII";
