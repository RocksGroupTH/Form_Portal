/**
 * The payee's ภ.ง.ด. type, suggested from their tax id.
 *
 * A Thai 13-digit tax id carries this already: juristic persons are registered
 * by the DBD with a number beginning 0, individuals use a national id beginning
 * 1-8. No DBD call is needed, which is why the requirement's lookup was dropped
 * (spec §5.3a).
 *
 * **It suggests; it never decides.** Some individuals do hold 0-prefixed ids —
 * foreigners issued one by the Revenue Department, two of whom are in our own
 * vendor list — so the requester can change it on the form and accounting can
 * change it again at the ACCOUNT step.
 */
export type PndType = "PND3" | "PND53";

/** The BC vendor each type clears against. Both exist for PCTH, KSI and UNO. */
export const PND_VENDOR_NO: Record<PndType, string> = {
  PND3: "WHT-PND.3",
  PND53: "WHT-PND.53",
};

/** Thai label for one type, for anywhere a person reads it. */
export const PND_LABEL: Record<PndType, string> = {
  PND3: "ภ.ง.ด. 3",
  PND53: "ภ.ง.ด. 53",
};

/**
 * Null means "nothing to suggest", which is not the same as suggesting an
 * individual. Anything that is not exactly thirteen digits — a half-typed id, a
 * registration number from somewhere else, a blank — answers nothing, and the
 * send refuses a clearing whose WHT nobody has typed rather than picking a
 * vendor on this much evidence.
 *
 * Non-digits are stripped, not counted: `01055000000O1` is twelve digits and
 * answers null, instead of reading the leading zero off a string that merely
 * happens to be thirteen characters long.
 */
export function suggestPndType(taxId: string | null | undefined): PndType | null {
  const digits = (taxId ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return null;
  return digits.startsWith("0") ? "PND53" : "PND3";
}

/**
 * Why this clearing may not leave the account step, on the ภ.ง.ด. side.
 *
 * The same two conditions the journal builder refuses on, asked one step
 * earlier. They used to be discovered at send time — after all three approvals,
 * by whoever pressed "ส่งเข้า ERP", who is not the person who can fix it. The
 * account step is where the type is chosen, so it is where the omission belongs.
 *
 * The wording lives here so the screen and the server say the same sentence: a
 * gate that phrases itself twice eventually phrases itself differently.
 *
 * Only withholding that exists is gated. No WHT on any line means no payee rows
 * are expected and none are missing anything.
 */
export function pndBlockReason(
  items: { whtAmount?: number | null }[] | null | undefined,
  payees: { pndType?: PndType | null }[] | null | undefined,
): string | null {
  const total =
    Math.round((items ?? []).reduce((s, it) => s + Number(it.whtAmount ?? 0), 0) * 100) / 100;
  if (!(total > 0)) return null;

  const rows = payees ?? [];
  // Each message names the way out, and they are different ways. Accounting
  // chooses the ภ.ง.ด. type and can do that here; it cannot invent a payee,
  // because the name, tax id and address come off the receipt the requester
  // holds. So a missing payee row goes back, and a missing type does not.
  if (rows.length === 0) {
    return `มีภาษีหัก ณ ที่จ่าย ฿${total.toLocaleString("th-TH", { minimumFractionDigits: 2 })} แต่ไม่มีรายการผู้รับเงิน — ใช้ “ส่งกลับแก้ไข” ให้ผู้ขอเพิ่มผู้รับเงินก่อน`;
  }

  const missing: number[] = [];
  rows.forEach((w, i) => {
    if (!w.pndType) missing.push(i + 1);
  });
  if (missing.length === 0) return null;
  return `ยังไม่ได้ระบุประเภท ภ.ง.ด. ของผู้รับเงินรายที่ ${missing.join(", ")} — เลือกในตาราง “ประเภท ภ.ง.ด. ต่อผู้รับเงิน” ด้านล่างก่อนอนุมัติ`;
}
