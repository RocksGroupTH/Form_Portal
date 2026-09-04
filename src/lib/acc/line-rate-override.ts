import { getAccPool, sql } from "@/lib/acc/pool";
import { RATE_SOURCE_OVERRIDE } from "@/lib/acc/currency";
import { rateAsOfYmd } from "@/lib/acc/currency-display";
import { AccConflictError } from "@/lib/acc/request-errors";
import type { Actor } from "@/lib/acc/approval-engine";
import { computeRequestTotalAmount, computeTotalAmount } from "@/lib/acc/calc";
import { loadTravelDays } from "@/lib/acc/request-service";
import {
  planLineRateOverride,
  LINE_RATE_REFUSAL_TEXT,
  RATE_OVERRIDE_WRONG_STEP_TEXT,
} from "@/lib/acc/rate-override-policy";

/**
 * Accounting corrects the exchange rate on **one AP-1 expense line**, at the
 * ACCOUNT step.
 *
 * ── Why this exists beside `rate-override.ts` ──
 *
 * **Every rate this application records is a published daily quote, never the
 * one the company was actually charged.** Until a `BOT_CURRENCY_RATE` key was
 * registered on 2026-09-04 it was `bot-fx`'s keyless ECB mid-market fallback;
 * since then it is the Bank of Thailand selling rate, which is the right side of
 * the spread but still an official daily figure rather than the company's own
 * dealt rate. Correcting that difference is the only way the figure actually
 * paid reaches the books, which is why the override shipped in the first release
 * rather than being deferred.
 *
 * Migration 129 then moved AP-1's currency from the request to the **line**, and
 * nothing on AP-1's write path records a header currency any more — all three of
 * its `AccRequest` writers clear those columns. So `rate-override.ts`, which
 * reads them, stopped rendering for every AP-1 claim filed since: the panel
 * simply never appeared. This is the same correction rebuilt where the currency
 * now lives.
 *
 * **`rate-override.ts` is not replaced and must not be.** AP-17's booking desk
 * legitimately records one currency for a whole booking, and AP-1 claims filed
 * during migration 125's request-level design still carry a header currency this
 * cannot reach. Both keep working, unchanged, on their own route.
 *
 * ── The rule this must not break ──
 *
 * **`AccTravelExpenseItem.Amount` is Thai baht, always.** The new figure comes
 * from `toBaht(ForeignAmount, rate)` and nowhere else; a null conversion refuses
 * the save rather than leaving the old baht beside a new rate, and nothing here
 * falls back to the unconverted figure. That single invariant is what lets
 * `calc.ts`'s `sum()`, the T-SQL `SUM(i.Amount)` feeding the ERP prep queue an
 * approver reads immediately before pressing Send, the journal builder and the
 * approval queue all carry on knowing nothing about currency.
 *
 * ── The form pin is not decoration ──
 *
 * Every `Acc*` form writes to `[dbo].[AccRequest]`, and AP-4 parks a claim on
 * the very same (ManagerApproved, ACCOUNT) tuple. Without `FormCode=@form` an
 * AP-1 accountant could reach an AP-4 claim through AP-1's URL. Same reasoning
 * as `approval-engine.ts`, and the same consequence for removing it.
 */

/** What the caller gets back, and what the queue re-renders from. */
export interface LineRateOverrideResult {
  requestId: number;
  itemId: number;
  currency: string;
  /** The rate this replaces. Null only where an earlier save left none. */
  previousRate: number | null;
  rate: number;
  /**
   * The provenance this correction just wrote (migration 130): the date of the
   * correction, read back out of the statement that wrote it, and
   * `RATE_SOURCE_OVERRIDE`.
   *
   * Returned rather than left to the caller to guess, because the queue patches
   * its open drawer from this result instead of refetching — and a drawer
   * showing the **new** rate beside the **old** date would state exactly the
   * thing this column exists to make impossible.
   */
  rateAsOf: string | null;
  rateSource: string;
  /** The line's own figure, unchanged — only what it is worth in baht moved. */
  foreignAmount: number;
  /** The line's new `Amount`. Baht. */
  amount: number;
  /** The claim's new `AccRequest.TotalAmount`, recomputed from every line. Baht. */
  totalAmount: number;
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
 * One transaction, and everything that must agree is inside it: the line's new
 * baht, both stored totals recomputed from the lines, and the `AccActivityLog`
 * row naming the line, the old rate and the new one. A corrected rate can never
 * exist without the record of who corrected it and from what, and a corrected
 * line can never exist beside a total that still counts the old figure.
 *
 * The read takes `UPDLOCK` on the request row and repeats the step predicate
 * that both writes then repeat. It is a read-then-write only in shape: the lock
 * is what stops an `approveAccount` landing between them and a correction being
 * written over a claim that has since been signed off and possibly queued for
 * Business Central. The house rule — claim with a conditional UPDATE and check
 * `rowsAffected` — is kept at every write.
 *
 * **The totals are recomputed, not adjusted by a delta.** `computeTotalAmount`
 * is the one definition of what a travel day is worth in this application — it
 * knows that a rate vehicle's `fare` rows do not count and a manual section's
 * `parking` rows do not either — and rebuilding the figure through it is the
 * only way this file cannot drift from `saveDraft`, `submitRequest` and
 * `deleteItem`. `loadTravelDays` is given the transaction, so what it reads is
 * the line as this statement has just left it.
 */
export async function applyLineRateOverride(
  requestId: number,
  itemId: number,
  formCode: string,
  actor: Actor,
  postedRate: unknown,
): Promise<LineRateOverrideResult> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  await tx.begin();
  try {
    const read = await tx
      .request()
      .input("id", sql.Int, requestId)
      .input("item", sql.Int, itemId)
      .input("form", sql.NVarChar, formCode)
      .query(`SELECT i.ItemType, i.Amount, i.Currency, i.ExchangeRate, i.ForeignAmount
              FROM [dbo].[AccTravelExpenseItem] i
              INNER JOIN [dbo].[AccTravelExpense] t ON t.Id = i.TravelExpenseId
              INNER JOIN [dbo].[AccRequest] r WITH (UPDLOCK, ROWLOCK) ON r.Id = t.RequestId
              WHERE i.Id=@item AND r.Id=@id AND r.FormCode=@form
                AND r.Status='ManagerApproved' AND r.CurrentStepCode='ACCOUNT'`);
    const row = read.recordset[0] as
      | { ItemType: string; Amount: unknown; Currency: string | null; ExchangeRate: unknown; ForeignAmount: unknown }
      | undefined;
    if (!row) {
      // Deliberately one answer for two situations. The claim is off the step —
      // somebody else approved it while this drawer was open — or the line is
      // not on it at all. Both are 409 and neither confirms which, and the
      // step is by far the likelier, so it takes the wording.
      await tx.rollback();
      throw new AccConflictError(RATE_OVERRIDE_WRONG_STEP_TEXT);
    }

    const currency = ((row.Currency ?? "") as string).trim().toUpperCase();
    const previousRate = n(row.ExchangeRate);
    const previousAmount = n(row.Amount);
    const foreignAmount = n(row.ForeignAmount);

    const decision = planLineRateOverride({ currency, foreignAmount }, postedRate);
    if (!decision.ok) {
      await tx.rollback();
      throw new Error(LINE_RATE_REFUSAL_TEXT[decision.reason]);
    }
    const { rate, amount, foreignAmount: converted } = decision.plan;

    const upd = await tx
      .request()
      .input("id", sql.Int, requestId)
      .input("item", sql.Int, itemId)
      .input("form", sql.NVarChar, formCode)
      .input("rate", sql.Decimal(18, 6), rate)
      .input("amount", sql.Decimal(18, 2), amount)
      .input("rateSource", sql.NVarChar(20), RATE_SOURCE_OVERRIDE)
      /* The provenance is rewritten with the rate, never left behind (migration
         130). Two different things would go wrong if it were:

         `RateSource` would still read `ECB`, and a hand-entered figure would be
         indistinguishable from a published one — the whole reason that column
         exists, since a corrected rate is one person's number and is not
         reproducible from any feed.

         `RateAsOf` would still name the day the provider published the rate
         this correction just replaced, which is a statement about a figure that
         is no longer in the row. `CAST(SYSDATETIME() AS DATE)` is the server's
         own clock — a Thai wall clock, per the driver's `useUTC: false` — and
         it is the date of the correction, which is the only date this rate has. */
      .query(`UPDATE i SET i.Amount=@amount, i.ExchangeRate=@rate,
                  i.RateAsOf=CAST(SYSDATETIME() AS DATE), i.RateSource=@rateSource
              OUTPUT inserted.RateAsOf AS RateAsOf
              FROM [dbo].[AccTravelExpenseItem] i
              INNER JOIN [dbo].[AccTravelExpense] t ON t.Id = i.TravelExpenseId
              INNER JOIN [dbo].[AccRequest] r ON r.Id = t.RequestId
              WHERE i.Id=@item AND r.Id=@id AND r.FormCode=@form
                AND r.Status='ManagerApproved' AND r.CurrentStepCode='ACCOUNT'`);
    if ((upd.rowsAffected[0] ?? 0) === 0) {
      await tx.rollback();
      throw new AccConflictError(RATE_OVERRIDE_WRONG_STEP_TEXT);
    }
    // The date as the database actually stored it, not one recomputed here.
    // `SYSDATETIME()` is the clock that stamped it and the two could disagree
    // across midnight, which is the one moment a rate date being wrong by a day
    // is least likely to be noticed.
    const rateAsOf = rateAsOfYmd(
      (upd.recordset?.[0]?.RateAsOf as string | Date | null | undefined) ?? null,
    );

    // Read back through the shared loader, so the totals below are built from
    // exactly the day objects `getRequest` would hand any other caller.
    const days = await loadTravelDays(tx, requestId);
    for (const day of days) {
      if (!day.id) continue;
      await tx
        .request()
        .input("teid", sql.Int, day.id)
        .input("total", sql.Decimal(18, 2), computeTotalAmount(day))
        .query(`UPDATE [dbo].[AccTravelExpense] SET TotalAmount=@total WHERE Id=@teid`);
    }
    const totalAmount = computeRequestTotalAmount(days);
    const header = await tx
      .request()
      .input("id", sql.Int, requestId)
      .input("form", sql.NVarChar, formCode)
      .input("total", sql.Decimal(18, 2), totalAmount)
      .query(`UPDATE [dbo].[AccRequest]
              SET TotalAmount=@total, UpdatedAt=SYSDATETIME()
              WHERE Id=@id AND FormCode=@form
                AND Status='ManagerApproved' AND CurrentStepCode='ACCOUNT'`);
    if ((header.rowsAffected[0] ?? 0) === 0) {
      await tx.rollback();
      throw new AccConflictError(RATE_OVERRIDE_WRONG_STEP_TEXT);
    }

    const from = previousRate === null ? "—" : previousRate.toFixed(6);
    const note =
      `แก้อัตราอ้างอิงของรายการ #${itemId} (${row.ItemType}) ${currency}:` +
      ` ${from} → ${rate.toFixed(6)} บาท/1 ${currency}` +
      ` — ยอดรายการ ${previousAmount === null ? "—" : money(previousAmount)} → ${money(amount)} บาท` +
      ` — ยอดรวมคำขอ ${money(totalAmount)} บาท` +
      ` — โดย ${actor.email ?? "(ไม่ทราบอีเมล)"}`;

    await tx
      .request()
      .input("rid", sql.Int, requestId)
      .input("by", sql.Int, actor.userId)
      .input("note", sql.NVarChar, note.slice(0, 2000))
      .input("meta", sql.NVarChar, JSON.stringify({
        itemId,
        itemType: row.ItemType,
        currency,
        oldRate: previousRate,
        newRate: rate,
        newRateAsOf: rateAsOf,
        newRateSource: RATE_SOURCE_OVERRIDE,
        oldAmount: previousAmount,
        newAmount: amount,
        foreignAmount,
        newTotalAmount: totalAmount,
        byEmail: actor.email ?? null,
        byStaffId: actor.staffId ?? null,
      }))
      .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note, MetadataJson)
              VALUES (@rid, @by, 'exchange_rate_overridden', @note, @meta)`);

    await tx.commit();

    return {
      requestId,
      itemId,
      currency,
      previousRate,
      rate,
      rateAsOf,
      rateSource: RATE_SOURCE_OVERRIDE,
      foreignAmount: converted,
      amount,
      totalAmount,
    };
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}
