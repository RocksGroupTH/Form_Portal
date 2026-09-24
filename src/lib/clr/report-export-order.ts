/**
 * Which order the AP-3 report exports write their columns in, given the order
 * the reader dragged them into on screen.
 *
 * The reader's order lives in `localStorage` (see `makeColumnPrefs`), so this
 * function's input is untrusted: a stale value, a hand-edited URL, or a column
 * a newer build added and this one has not heard of. It never throws and never
 * changes WHICH columns the file has — it only permutes them. Everything the
 * reader did not name is appended in the default order, so the worst a bad
 * input can do is "the default order".
 *
 * ## Why this is not just `screenOrder`
 *
 * The Control export is not the Control screen. `adjustment` is one signed
 * column on screen and two columns in the file (โอนคืนบริษัท / เบิกเพิ่ม);
 * `pvDocNo` packs the payment date into a sub-line on screen and is two columns
 * in the file. `requesterPosition` and `refundTransferDate` are on screen and
 * not in the file at all. The file's column SET is deliberately its own — see
 * `docs/superpowers/specs/2026-09-24-ap3-report-columns-and-adc-link-design.md`
 * §1.2 — and only the order follows the reader.
 */

/** Export column keys, in the order the file has always written them. */
export const CONTROL_EXPORT_ORDER = [
  "submittedAt", "requestNo", "staffId", "advanceRequestNo", "requesterFullName",
  "requesterDepartmentName", "advanceAmount", "expenseOf", "actualTotal",
  "refundToCompany", "extraToEmployee", "pvDocNo", "paymentDate",
  "managerApproved", "accountActioned", "pendingOn", "overallStatus",
] as const;

export const DETAIL_EXPORT_ORDER = [
  "requestNo", "requestDate", "lineNo", "staffId", "requesterFullName", "expenseOf",
  "branchCode", "expenseDate", "docNo", "glAccountNo", "glAccountName", "description",
  "amountBeforeVat", "vatAmount", "totalInclVat", "whtAmount", "netAmount",
  "taxId", "payeeName", "payeeAddress", "advanceRequestNo",
] as const;

export type ControlExportKey = (typeof CONTROL_EXPORT_ORDER)[number];
export type DetailExportKey = (typeof DETAIL_EXPORT_ORDER)[number];

/**
 * Screen column key -> the export columns it owns, in the order they appear in
 * the file. A screen column absent from this map owns none: it is on screen and
 * not in the file.
 */
const CONTROL_OWNS: Record<string, readonly ControlExportKey[]> = {
  submittedAt: ["submittedAt"],
  requestNo: ["requestNo"],
  staffId: ["staffId"],
  advanceRequestNo: ["advanceRequestNo"],
  requesterFullName: ["requesterFullName"],
  requesterDepartmentName: ["requesterDepartmentName"],
  advanceAmount: ["advanceAmount"],
  expenseOf: ["expenseOf"],
  actualTotal: ["actualTotal"],
  adjustment: ["refundToCompany", "extraToEmployee"],
  pvDocNo: ["pvDocNo", "paymentDate"],
  managerApproved: ["managerApproved"],
  accountActioned: ["accountActioned"],
  pendingOn: ["pendingOn"],
  overallStatus: ["overallStatus"],
};

const DETAIL_OWNS: Record<string, readonly DetailExportKey[]> = Object.fromEntries(
  DETAIL_EXPORT_ORDER.map((k) => [k, [k] as readonly DetailExportKey[]]),
);

function order<K extends string>(
  screenOrder: readonly string[],
  owns: Record<string, readonly K[]>,
  fallback: readonly K[],
): K[] {
  const out: K[] = [];
  const seen = new Set<K>();
  const take = (k: K) => {
    if (seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const screenKey of screenOrder) for (const k of owns[screenKey] ?? []) take(k);
  for (const k of fallback) take(k);
  return out;
}

export function controlExportOrder(screenOrder: readonly string[]): ControlExportKey[] {
  return order(screenOrder, CONTROL_OWNS, CONTROL_EXPORT_ORDER);
}

export function detailExportOrder(screenOrder: readonly string[]): DetailExportKey[] {
  return order(screenOrder, DETAIL_OWNS, DETAIL_EXPORT_ORDER);
}
