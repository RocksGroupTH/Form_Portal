import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { requireBookingBrandScope } from "@/lib/acc/travel-booking/require-booking-brand-scope";
import { buildAccActor } from "@/lib/acc/actor-context";
import { getAccPool, sql } from "@/lib/acc/pool";
import { payoutOptions, payoutTripKind} from "@/lib/acc/travel-booking/payout-rule";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * POST /api/request/travel-booking/requests/[id]/payment-date
 * Body: `{ date: "YYYY-MM-DD" }`
 *
 * **A date, not a month.** It used to post `{ ym }` and the server derived that
 * month's last day — a model that cannot express a foreign trip's payout, which
 * falls on the **10th**. A month has two possible payout days now, so the month
 * alone no longer names one.
 *
 * The date is still checked by **membership** of the options this request's own
 * kind generates, never by a regex: the client cannot invent the 3rd of
 * anything, and a domestic request cannot be given a foreign round. The kind is
 * resolved server-side from `AccRequest.CountryCode` — a posted kind would let
 * the caller choose which rule applies to their own payment.
 *
 * The row's CURRENT date is always offered even when it has gone past
 * (`alwaysInclude`), or a row whose stored date is behind today could not be
 * re-saved and its picker would render blank.
 *
 * Refused unless the request is at `ManagerApproved`/`ACCOUNT`, as the UPDATE's
 * own predicate rather than a read-then-write. Once accounting has signed,
 * `Status` is `Completed` and the figure is frozen — the page hides the
 * control and this refuses it, because a control removed from a page is not a
 * rule.
 *
 * The UPDATE and the `AccActivityLog` row are one transaction (mirrors
 * `approveByAccount`, `src/lib/acc/travel-booking/approval.ts`): if the log
 * insert threw after a bare UPDATE had already committed, the date would have
 * changed with no audit row for it, and a route that then answered 400 would
 * leave the client showing a month the database no longer holds. The guarded
 * UPDATE affecting zero rows is an expected outcome and returns its own 400
 * directly, without throwing — only the outer catch, for a genuine failure
 * (connection, transaction, the insert itself), answers 500.
 *
 * `ROUTE_RULES` needs no entry: the `/api/request/travel-booking` prefix
 * already classifies `AP-17`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (Number.isNaN(id)) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  // A UAT record is invisible outside the tester group — the id selected the
  // database, membership decides who may touch what it found.
  const uatGate = await uatActorGate(session);
  if (uatGate) return uatGate;

  if (!(await canAccessBookingArea(session.user.email, session.user.role))) {
    return NextResponse.json({ ok: false, error: "ไม่มีสิทธิ์เข้าถึงคำขอนี้" }, { status: 403 });
  }

  // Being in the area is not the same as being allowed this request's brand. A
  // scoped approver holding the id from a link or a page loaded before the scope
  // was narrowed is refused here, where the queue would merely not have shown it.
  const scoped = await requireBookingBrandScope(session.user, id);
  if (scoped) return scoped;

  try {
    const body = (await req.json().catch(() => ({}))) as { date?: unknown };
    const wanted = typeof body.date === "string" ? body.date.trim() : "";

    const pool = await getAccPool();

    // The kind and the row's current date come from the database, never the
    // body: otherwise a caller could nominate "foreign" for a Thai trip and pay
    // themselves on the 10th.
    const cur = await pool
      .request()
      .input("id", sql.Int, id)
      .input("form", sql.NVarChar, AP17_FORM_CODE)
      .query(`SELECT CountryCode, PaymentDate FROM [dbo].[AccRequest]
              WHERE Id=@id AND FormCode=@form`);
    const row = cur.recordset[0] as
      | { CountryCode: string | null; PaymentDate: Date | null }
      | undefined;
    if (!row) {
      return NextResponse.json({ ok: false, error: "ไม่พบคำขอ" }, { status: 404 });
    }
    const kind = payoutTripKind(row.CountryCode);
    const currentYmd = row.PaymentDate ? ymdOf(row.PaymentDate) : null;

    const validOptions = payoutOptions(kind, ymdOf(new Date()), 12, currentYmd);
    const option = validOptions.find((o) => o.date === wanted);
    if (!option) {
      return NextResponse.json(
        { ok: false, error: "วันที่จ่ายที่เลือกไม่อยู่ในรอบจ่ายของคำขอนี้" },
        { status: 400 },
      );
    }

    const paymentDate = option.date;
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    const tx = pool.transaction();
    await tx.begin();
    try {
      // The status/step is the UPDATE's own predicate — a read-then-write lets
      // an account-approve land in between and a correction be written over a
      // claim that has since been signed off.
      const upd = await tx
        .request()
        .input("id", sql.Int, id)
        .input("pd", sql.Date, paymentDate)
        .input("form", sql.NVarChar, AP17_FORM_CODE)
        .query(`UPDATE [dbo].[AccRequest] SET PaymentDate=@pd, UpdatedAt=SYSDATETIME()
                WHERE Id=@id AND FormCode=@form AND Status='ManagerApproved' AND CurrentStepCode='ACCOUNT'`);

      if ((upd.rowsAffected[0] ?? 0) === 0) {
        await tx.rollback();
        return NextResponse.json(
          { ok: false, error: "ไม่พบคำขอ หรือคำขอไม่ได้อยู่ในขั้นตอนที่บัญชีแก้ไขวันที่จ่ายได้" },
          { status: 400 },
        );
      }

      await tx
        .request()
        .input("rid", sql.Int, id)
        .input("by", sql.Int, actor.userId)
        .input("note", sql.NVarChar, `แก้ไขวันที่จ่ายเป็น ${option.label}`)
        .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
                VALUES (@rid, @by, 'payment_date_edited', @note)`);

      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }

    return NextResponse.json({ ok: true, data: { id, paymentDate, label: option.label } });
  } catch (e) {
    // Reached only for a genuine failure now — the expected "wrong state"
    // refusal above returns its own 400 without throwing.
    console.error(
      "[api/request/travel-booking/requests/[id]/payment-date] POST",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ ok: false, error: "แก้ไขวันที่จ่ายไม่สำเร็จ" }, { status: 500 });
  }
}

/** A `date` column, rendered in local time. Never `toISOString()`, which is UTC. */
function ymdOf(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
