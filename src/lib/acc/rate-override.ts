import { getAccPool, sql } from "@/lib/acc/pool";
import { AccConflictError } from "@/lib/acc/request-errors";
import type { Actor } from "@/lib/acc/approval-engine";
import {
  planRateOverride,
  RATE_OVERRIDE_REFUSAL_TEXT,
  RATE_OVERRIDE_WRONG_STEP_TEXT,
} from "@/lib/acc/rate-override-policy";

/**
 * Accounting corrects a foreign claim's exchange rate — the pool half, shared
 * unchanged by AP-1 and AP-17.
 *
 * **One implementation, because the two forms differ in exactly one bound
 * value.** Both park a request awaiting accounting at
 * `Status='ManagerApproved'` / `CurrentStepCode='ACCOUNT'`; only `FormCode`
 * tells them apart, and it is a parameter. What the two forms genuinely do
 * differ about — whether `AccRequest.TotalAmount` is rewritten — is decided by
 * the row's own `ForeignAmount`, not by a form branch: see `planRateOverride`.
 *
 * **The form pin is not decoration.** Every `Acc*` form writes to
 * `[dbo].[AccRequest]`, and AP-4 parks a claim on the very same
 * (ManagerApproved, ACCOUNT) tuple. Without `FormCode=@form` an AP-1 accountant
 * could rewrite an AP-4 claim's total through AP-1's URL. Same reasoning as
 * `approval-engine.ts`, and the same consequence for removing it.
 */

/** What the caller gets back, and what the queue re-renders from. */
export interface RateOverrideResult {
  id: number;
  currency: string;
  /** The rate this replaces. Null only where an earlier save left none. */
  previousRate: number | null;
  rate: number;
  foreignAmount: number | null;
  /** Baht, always. Unchanged where the request carries no `ForeignAmount`. */
  totalAmount: number | null;
  /** False for a request whose `TotalAmount` is deliberately left alone. */
  totalRewritten: boolean;
}

function n(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/** `1234.5` → `"1,234.50"`, for the audit note alone. */
function money(v: number): string {
  const fixed = v.toFixed(2);
  const dot = fixed.indexOf(".");
  const whole = fixed.slice(0, dot).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return whole + fixed.slice(dot);
}

/**
 * Apply the correction, or throw.
 *
 * The read takes `UPDLOCK` and repeats the step predicate the UPDATE then
 * repeats again, inside one transaction. It is a read-then-write only in shape:
 * the lock is what stops an `approveAccount` landing between the two and a
 * correction being written over a claim that has since been signed off and
 * possibly already queued for Business Central. The house rule — claim with a
 * conditional UPDATE and check `rowsAffected` — is kept at the write; the read
 * exists because `ForeignAmount` is needed to compute the new total and cannot
 * be recomputed in SQL without duplicating `toBaht`'s rounding.
 *
 * The `AccActivityLog` row is written in the same transaction as the rewrite,
 * so a corrected rate can never exist without the line recording who corrected
 * it and from what. Unlike the brand-currency case this event has a request, so
 * `AccActivityLog` — whose `RequestId` is `int NOT NULL` with
 * `FK_AccActivity_Request` — is the right table and needs no new one.
 */
export async function applyRateOverride(
  requestId: number,
  formCode: string,
  actor: Actor,
  postedRate: unknown,
): Promise<RateOverrideResult> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const read = await tx
      .request()
      .input("id", sql.Int, requestId)
      .input("form", sql.NVarChar, formCode)
      .query(`SELECT Currency, ExchangeRate, ForeignAmount, TotalAmount
              FROM [dbo].[AccRequest] WITH (UPDLOCK, ROWLOCK)
              WHERE Id=@id AND FormCode=@form
                AND Status='ManagerApproved' AND CurrentStepCode='ACCOUNT'`);
    const row = read.recordset[0] as
      | { Currency: string | null; ExchangeRate: unknown; ForeignAmount: unknown; TotalAmount: unknown }
      | undefined;
    if (!row) {
      await tx.rollback();
      throw new AccConflictError(RATE_OVERRIDE_WRONG_STEP_TEXT);
    }

    const currency = ((row.Currency ?? "") as string).trim().toUpperCase();
    const previousRate = n(row.ExchangeRate);
    const foreignAmount = n(row.ForeignAmount);
    const previousTotal = n(row.TotalAmount);

    const decision = planRateOverride({ currency, foreignAmount }, postedRate);
    if (!decision.ok) {
      await tx.rollback();
      throw new Error(RATE_OVERRIDE_REFUSAL_TEXT[decision.reason]);
    }
    const { rate, totalAmount } = decision.plan;

    // `TotalAmount=COALESCE(@total, TotalAmount)` rather than two spellings of
    // the statement: a null @total is "leave it", which is AP-17's case, and a
    // bound parameter keeps the whole write parameterised.
    const upd = await tx
      .request()
      .input("id", sql.Int, requestId)
      .input("form", sql.NVarChar, formCode)
      .input("rate", sql.Decimal(18, 6), rate)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .query(`UPDATE [dbo].[AccRequest]
              SET ExchangeRate=@rate, TotalAmount=COALESCE(@total, TotalAmount), UpdatedAt=SYSDATETIME()
              WHERE Id=@id AND FormCode=@form
                AND Status='ManagerApproved' AND CurrentStepCode='ACCOUNT'`);
    if ((upd.rowsAffected[0] ?? 0) === 0) {
      await tx.rollback();
      throw new AccConflictError(RATE_OVERRIDE_WRONG_STEP_TEXT);
    }

    const from = previousRate === null ? "—" : previousRate.toFixed(6);
    const totalPart =
      totalAmount === null
        ? " (ยอดรวมของคำขอเป็นเงินบาทอยู่แล้ว จึงไม่เปลี่ยน)"
        : ` — ยอดรวม ${previousTotal === null ? "—" : money(previousTotal)} → ${money(totalAmount)} บาท`;
    const note =
      `แก้อัตราอ้างอิง ${currency}: ${from} → ${rate.toFixed(6)} บาท/1 ${currency}${totalPart}` +
      ` — โดย ${actor.email ?? "(ไม่ทราบอีเมล)"}`;

    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .input("note", sql.NVarChar, note.slice(0, 2000))
      .input("meta", sql.NVarChar, JSON.stringify({
        currency,
        oldRate: previousRate,
        newRate: rate,
        oldTotalAmount: previousTotal,
        newTotalAmount: totalAmount === null ? previousTotal : totalAmount,
        foreignAmount,
        byEmail: actor.email ?? null,
        byStaffId: actor.staffId ?? null,
      }))
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
              VALUES (@rid, @by, 'exchange_rate_overridden', @note, @meta)`);

    await tx.commit();

    return {
      id: requestId,
      currency,
      previousRate,
      rate,
      foreignAmount,
      totalAmount: totalAmount === null ? previousTotal : totalAmount,
      totalRewritten: totalAmount !== null,
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}
