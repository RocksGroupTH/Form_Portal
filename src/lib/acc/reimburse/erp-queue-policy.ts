/**
 * AP-4 — which approved claims belong in the ERP queue, and whether they are
 * ready to post.
 *
 * Deliberately free of any import that reaches a pool: `./brand-scope` is the
 * only import this file has ever needed to add, and it also imports nothing
 * (see its own docblock) — the property worth keeping is "never reaches
 * `@/env`", not "literally zero import statements". So this module stays
 * testable without a database. Every function is total over plain values.
 *
 * ## Why FormCode matters
 *
 * `AccRequest` is shared by every Acc* form, and AP-1 and AP-3 park their
 * approved claims at exactly the same status as AP-4 — `Status='Approved'`.
 * Without a FormCode filter, a claim from AP-1 or AP-3 would leak into AP-4's
 * ERP queue. AP-1's own `erp-prep-service.ts` comment spells out what happens:
 * a journal is built from nothing — zero line items — and posted to Business
 * Central. FormCode is the only discriminator that stops that.
 *
 * ## Why readiness reads lines
 *
 * `AccReimburseItem.Category` holds the G/L account. It is written by an AI
 * document read, correctable by an accountant, and validated only for length —
 * it may be null or blank. So "ready to post" is a property of the lines, not
 * of the claim's status.
 *
 * ## Brand scope, in this accumulator too
 *
 * `listReimburseErpQueue` (`./erp-queue-service.ts`) loads the caller's scope
 * and the claim-brand→target map once each and hands both to
 * `accumulateErpQueueRows` below — the same shape `queue-policy.ts`'s sibling
 * accumulator uses, and the same reason: a WHERE clause is only as trustworthy
 * as SQL text can be, and this file's own row-loop history above already says
 * why that is not very. Sight is not the control — `approval-service.ts`'s
 * `requireApproverScopeFor` is — but a claim nobody may send should not be
 * the one an accountant sees "ready to post" beside.
 */

import { canActOnTarget } from "./brand-scope";

export type ErpReadiness = { ready: boolean; issues: string[] };

/**
 * One row of AP-4's Interface ERP queue.
 *
 * It lives here rather than beside the query for the reason `ReimburseQueueRow`
 * lives in `queue-policy.ts`: the shape is what the predicate and the readiness
 * rule are about, and a screen that renders it must be typeable without
 * dragging a pool import into the browser bundle.
 *
 * `formCode` and `status` are carried deliberately, not for display. They are
 * what the query re-derives `belongsInErpQueue` from — the row check that has
 * teeth, as opposed to the WHERE clause a later edit can rearrange while
 * leaving its pinned text intact. Dropping them from this type is how that
 * defence gets removed by accident.
 *
 * The ERP columns come straight off `AccRequest` and every one of them is
 * nullable: nothing has been sent, so `erpStatus` is null on every row this
 * queue currently shows. `readiness` is not a column — it is `erpReadiness`
 * over the claim's lines, so the screen can say *why* a claim is not ready
 * rather than only that it is not.
 */
export interface ReimburseErpQueueRow {
  id: number;
  requestNo: string;
  brandCode: string;
  requesterName: string;
  formCode: string;
  status: string;
  submittedAt: string | null;
  paymentDate: string | null;
  totalAmount: number;
  itemCount: number;
  erpStatus: string | null;
  erpDocumentNo: string | null;
  erpEnvironment: string | null;
  erpSentAt: string | null;
  erpError: string | null;
  readiness: ErpReadiness;
}

/**
 * Only an APPROVED AP-4 claim is in the ERP queue.
 *
 * An allow-list, not a catch-all: unknown statuses are OUT. The only status
 * that returns true is "Approved", and only for FormCode "AP-4".
 */
export function belongsInErpQueue(formCode: string, status: string): boolean {
  return formCode === "AP-4" && status === "Approved";
}

/**
 * Whether a claim is ready to post, and if not, which lines are missing their
 * G/L account.
 *
 * A claim is ready only when EVERY line has a non-null, non-blank category.
 * An empty array — a claim with no lines at all — is not ready, because a
 * journal built from nothing and posted to Business Central is the AP-1
 * failure this module exists to prevent.
 *
 * Both bad lines are named, not just the first: the accountant fixes them and
 * comes back, and discovering a second problem is a waste of a round trip.
 * Lines are numbered as a human counts them (1, 2, 3...), not as a programmer
 * counts arrays.
 *
 * **This checks PRESENCE, not that the value is a real `ErpAccounts.AccountNo`.**
 * Migration 117 added `Category` to hold free text such as `'AP-4.2'`, and it
 * was only later repurposed to hold a G/L account code (`ExpenseAccountPicker.tsx`
 * renders the legacy free-text case specially, for exactly this reason). A
 * claim carrying one of those legacy strings passes this check and is
 * reported "ready" by the screen that renders it — the label there says
 * `มีผังบัญชีครบ` ("every line has a G/L account entered"), which is literally
 * what this function verifies, and stops short of claiming the value is
 * correct. Validating against the ERP mirror (`Rocks_ERP_Data.ErpAccounts`)
 * is a join this module deliberately does not make — it belongs with the
 * send, in `erp-queue-service.ts`, which already opens the pool this would
 * need.
 */
/**
 * The brand's Interface ERP settings, as far as readiness reads them.
 *
 * The same four values `ReimburseJournalConfig` carries — kept as a separate
 * shape rather than imported, so this file stays reachable from a test: the
 * payload module is pure, but importing it would tie this policy to a module
 * that may not always be.
 */
export interface ErpConfigCheck {
  bankAccountNo: string | null;
  journalBatchName: string | null;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
}

/** One line, as far as readiness reads it. */
export interface ErpReadinessItem {
  category: string | null;
  amount: number | null;
  vatAmount?: number | null;
  whtAmount?: number | null;
}

const filled = (v: string | null | undefined): boolean => (v ?? "").trim() !== "";

/**
 * Is this claim complete enough for a journal to be built from it?
 *
 * **Every check here mirrors something `buildReimburseJournalPayload` THROWS
 * on**, and that correspondence is the point: the builder keeps all of its own
 * refusals, so this is a screen rather than a gate, and a claim that reads
 * "ready" here and then fails to build means the two have drifted.
 *
 * **`config` is required and nullable rather than optional.** Absent, a caller
 * that forgot it would silently lose four checks and every row would read
 * green; `null` says the brand's settings could not be resolved at all — an
 * unmapped brand, or a failed load — and is reported as its own issue.
 *
 * The VAT and withholding accounts are demanded only by a claim that actually
 * carries VAT or withholds, exactly as the builder demands them, so a brand
 * that has never needed either is not held up by settings it will never use.
 */
export function erpReadiness(
  items: readonly ErpReadinessItem[],
  config: ErpConfigCheck | null,
): ErpReadiness {
  // Refused rather than allowed: a claim with no lines reaching a journal
  // builder is the AP-1 failure quoted above, in its purest form.
  if (items.length === 0) {
    return {
      ready: false,
      issues: ["ไม่มีรายการที่จะบันทึก"],
    };
  }

  const issues: string[] = [];

  for (let i = 0; i < items.length; i++) {
    const category = items[i].category;
    // Line numbers as a human counts them, and EVERY bad line is named:
    // reporting only the first means a second round trip to find the second.
    if (!filled(category)) {
      issues.push(`บรรทัดที่ ${i + 1} ยังไม่ได้เลือกผังบัญชี`);
    }
  }

  const hasVat = items.some((it) => Number(it.vatAmount ?? 0) > 0);
  const hasWht = items.some((it) => Number(it.whtAmount ?? 0) > 0);

  if (!config) {
    issues.push("ยังไม่ได้ตั้งค่า Interface ERP ของแบรนด์นี้");
  } else {
    if (!filled(config.bankAccountNo)) issues.push("ยังไม่ได้ตั้งค่า Bank Account ของแบรนด์นี้");
    if (!filled(config.journalBatchName)) issues.push("ยังไม่ได้ตั้งค่า Journal Batch ของแบรนด์นี้");
    if (hasVat && !filled(config.vatInputGlAccountNo)) {
      issues.push("มี VAT แต่ยังไม่ได้ตั้งค่าบัญชีภาษีซื้อของแบรนด์นี้");
    }
    if (hasWht && !filled(config.whtPayableGlAccountNo)) {
      issues.push("มีภาษีหัก ณ ที่จ่ายแต่ยังไม่ได้ตั้งค่าบัญชีภาษีหัก ณ ที่จ่ายค้างจ่าย");
    }
  }

  // The builder refuses a claim whose bank line would be 0 or negative: a
  // payment document that moves no money is one somebody has to find and
  // reverse. `amount` is the line total INCLUDING VAT, which is what the net
  // is taken from.
  const net = items.reduce(
    (sum, it) => sum + Number(it.amount ?? 0) - Number(it.whtAmount ?? 0),
    0,
  );
  if (Math.round(net * 100) / 100 <= 0) {
    issues.push("ยอดจ่ายสุทธิของใบนี้ไม่มากกว่า 0 — ตรวจยอดหัก ณ ที่จ่าย");
  }

  return {
    ready: issues.length === 0,
    issues,
  };
}

/* ── The accumulator — the second, real layer against a leaked AP-1/AP-3 row ──
 *
 * `erp-queue-service.ts`'s query is the first, cheap layer (`WHERE
 * req.FormCode = @form AND req.Status = 'Approved'`), and it is trusted only
 * as far as SQL text can be trusted — `queue-service.ts`'s own docblock records
 * three rounds of a WHERE clause quietly widening while a text guard's pinned
 * substrings stayed intact. `belongsInErpQueue` above is what re-derives the
 * predicate from the row instead of the SQL, but on its own that only helps if
 * whatever calls it actually hands it the row's own values — a caller that
 * writes `const status = "Approved";` instead of reading `x.Status` satisfies
 * every check `belongsInErpQueue` could ever run, and still lists a claim still
 * parked at `(ManagerApproved, ACCOUNT)` under a header saying it is approved
 * and waiting to post. That caller is `accumulateErpQueueRows`, so it has to
 * live somewhere a test can hand it a row shaped exactly like that and watch it
 * get dropped — which is why it lives HERE rather than in `erp-queue-service.ts`
 * itself: that file's first import (`getAccPool`) reaches `@/lib/db/mssql` →
 * `@/env`, which validates the whole environment at import and throws outside a
 * configured machine, so nothing that imports it can be exercised with a plain
 * array in `erp-queue-service.test.ts`. `team-member/service.test.ts` documents
 * the identical split for `service.ts` vs. `mapping.ts`; this is the same
 * shape, applied to a newer table.
 */

/** `TotalAmount` etc. arrive from `mssql` typed loosely; coerce rather than trust. */
function num(v: unknown): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(v: unknown): string | null {
  return v instanceof Date ? v.toISOString() : null;
}

/** Date column -> YYYY-MM-DD using local getters — the server runs Thai wall time. */
function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** One claim, accumulated across its joined item rows before `erpReadiness` runs over `items`. */
interface AccumulatedRow {
  id: number;
  requestNo: string;
  brandCode: string;
  requesterName: string;
  formCode: string;
  status: string;
  submittedAt: string | null;
  paymentDate: string | null;
  totalAmount: number;
  erpStatus: string | null;
  erpDocumentNo: string | null;
  erpEnvironment: string | null;
  erpSentAt: string | null;
  erpError: string | null;
  items: ErpReadinessItem[];
}

/**
 * Turns `erp-queue-service.ts`'s raw joined recordset into
 * `ReimburseErpQueueRow[]` — the WHOLE mapping loop: the row-level
 * `belongsInErpQueue` gate, the `Map`+`order` flatten that fans one claim's
 * joined item rows back into one row, the `ItemId != null` guard that tells
 * "no items" apart from "one item with a NULL category", `itemCount`, and the
 * final `erpReadiness` call.
 *
 * `formCode` and `status` are read off each raw row (`x.FormCode`,
 * `x.Status`) rather than assumed, exactly as `queue-service.ts`'s loop reads
 * `r.FormCode` — see the section header above for why a rebinding here is the
 * actual hole a SQL-text guard cannot see. A row `belongsInErpQueue` refuses
 * is dropped before it can contribute anything, including a phantom item to
 * another claim's count.
 *
 * The join fans one claim out to one row per item (or one row with every item
 * column NULL, for a claim with none), so results are accumulated into a
 * `Map` keyed on `Id` and only flattened back to `ReimburseErpQueueRow[]` at
 * the end — `order` preserves the caller's own row order (in practice
 * `req.Id DESC`), which the `Map` alone would not.
 *
 * `scope` and `claimTargets` are both **required**, with no default — see the
 * module header and `queue-policy.ts`'s identical parameter for
 * `accumulateAccountQueueRows`. `scope === null` (no active roster row at
 * all) answers zero rows; a claim whose `BrandCode` resolves to no target in
 * `claimTargets` is out of every scope. Checked once per claim id, on the
 * FIRST row for that id — `BrandCode` cannot change across a claim's own
 * joined item rows, so re-checking on every one would be redundant, but the
 * check has to happen before `byId.set(id, acc)` or a later item row for an
 * out-of-scope claim would find nothing in the map and start a fresh entry.
 */
export function accumulateErpQueueRows(
  recordset: readonly Record<string, unknown>[],
  scope: readonly string[] | null,
  claimTargets: ReadonlyMap<string, string>,
  /**
   * Claim brand (upper-case) → that brand's Interface ERP settings.
   *
   * A brand absent from the map reads `null`, which `erpReadiness` reports as
   * "not configured" rather than passing over — the fail-safe direction, since
   * a green row on a claim that cannot be built is the expensive mistake.
   */
  configByBrand: ReadonlyMap<string, ErpConfigCheck>,
): ReimburseErpQueueRow[] {
  // Never convert `null` to `[]` here — see the docblock above.
  if (scope === null) return [];

  const byId = new Map<number, AccumulatedRow>();
  const order: number[] = [];

  for (const x of recordset) {
    const id = x.Id as number;
    const formCode = (x.FormCode as string | null) ?? "";
    const status = (x.Status as string | null) ?? "";
    if (!belongsInErpQueue(formCode, status)) continue;

    if (!byId.has(id)) {
      const brandCode = (x.BrandCode as string | null) ?? "";
      const target = claimTargets.get(brandCode.trim().toUpperCase()) ?? null;
      if (!canActOnTarget(scope, target)) continue;
    }

    let acc = byId.get(id);
    if (!acc) {
      acc = {
        id,
        requestNo: (x.RequestNo as string | null) ?? "",
        brandCode: (x.BrandCode as string | null) ?? "",
        requesterName: (x.RequesterFullName as string | null) ?? "",
        formCode,
        status,
        submittedAt: isoOrNull(x.SubmittedAt),
        paymentDate: x.PaymentDate ? toYmd(x.PaymentDate as Date) : null,
        totalAmount: num(x.TotalAmount),
        erpStatus: (x.ErpInterfaceStatus as string | null) ?? null,
        erpDocumentNo: (x.ErpDocumentNo as string | null) ?? null,
        erpEnvironment: (x.ErpInterfaceEnvironment as string | null) ?? null,
        erpSentAt: isoOrNull(x.ErpInterfaceSentAt),
        erpError: (x.ErpInterfaceError as string | null) ?? null,
        items: [],
      };
      byId.set(id, acc);
      order.push(id);
    }

    // A claim with no items at all joins to one row with ItemId NULL — do not
    // count that as a line with a missing category (see erp-queue-service.ts's
    // own header for why the distinction matters).
    if (x.ItemId != null) {
      acc.items.push({
        category: (x.ItemCategory as string | null) ?? null,
        amount: numOrNull(x.ItemAmount),
        // Both read from the row, never assumed: whether the brand needs a
        // VAT-input or a withholding account configured is a property of what
        // is actually on the claim.
        vatAmount: numOrNull(x.ItemVatAmount),
        whtAmount: numOrNull(x.ItemWhtAmount),
      });
    }
  }

  return order.map((id) => {
    const acc = byId.get(id)!;
    return {
      id: acc.id,
      requestNo: acc.requestNo,
      brandCode: acc.brandCode,
      requesterName: acc.requesterName,
      formCode: acc.formCode,
      status: acc.status,
      submittedAt: acc.submittedAt,
      paymentDate: acc.paymentDate,
      totalAmount: acc.totalAmount,
      itemCount: acc.items.length,
      erpStatus: acc.erpStatus,
      erpDocumentNo: acc.erpDocumentNo,
      erpEnvironment: acc.erpEnvironment,
      erpSentAt: acc.erpSentAt,
      erpError: acc.erpError,
      readiness: erpReadiness(
        acc.items,
        configByBrand.get((acc.brandCode ?? "").trim().toUpperCase()) ?? null,
      ),
    };
  });
}

/**
 * How many DISTINCT claims on this queue have a `BrandCode` resolving to no
 * Interface target at all — the ERP queue's counterpart to
 * `countUnmappedBrandRows` (`./queue-policy.ts`), and the same operational
 * problem: `ROCKS`, which migration 092 really does seed for AP-4, has no
 * `AccBrandErpInterface` row, so a claim under it is out of EVERY approver's
 * scope and vanishes from this list for everybody with nothing on screen to
 * say why.
 *
 * **Distinct claims, not recordset rows.** This queue LEFT JOINs
 * `AccReimburseItem`, so one claim with three lines arrives as three rows and
 * a plain row count would report three unmapped claims where there is one.
 * The account queue's counterpart needs no such de-duplication because its
 * items are joined by `COUNT(*)` subquery rather than fanned out — the two
 * functions are deliberately not shared for exactly this reason.
 *
 * **Independent of `scope`.** `canActOnTarget` refuses a `null` target for
 * anyone, so this answers the same for whoever asks.
 */
export function countUnmappedErpBrandClaims(
  recordset: readonly Record<string, unknown>[],
  claimTargets: ReadonlyMap<string, string>,
): number {
  const seen = new Set<number>();
  for (const x of recordset) {
    const formCode = (x.FormCode as string | null) ?? "";
    const status = (x.Status as string | null) ?? "";
    if (!belongsInErpQueue(formCode, status)) continue;

    const brandCode = (x.BrandCode as string | null) ?? "";
    const target = claimTargets.get(brandCode.trim().toUpperCase()) ?? null;
    if (target !== null) continue;

    const id = x.Id as number;
    if (seen.has(id)) continue;
    seen.add(id);
  }
  return seen.size;
}
