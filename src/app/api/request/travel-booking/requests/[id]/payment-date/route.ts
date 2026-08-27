import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { uatActorGate } from "@/lib/acc/travel-booking/uat-gate";
import { canAccessBookingArea } from "@/lib/acc/booking-access";
import { buildAccActor } from "@/lib/acc/actor-context";
import { getAccPool, sql } from "@/lib/acc/pool";
import { payoutMonthOptions, payoutDateForMonth } from "@/lib/acc/travel-booking/payout-months";
import { AP17_FORM_CODE } from "@/features/travel-booking/constants";

/**
 * POST /api/request/travel-booking/requests/[id]/payment-date
 * Body: `{ ym: "YYYY-MM" }`
 *
 * A **month** is posted, not a date: AP-17 pays at a month's end and the server
 * derives the day (`payoutDateForMonth`), so a client cannot write the 3rd of
 * anything.
 *
 * `ym` is checked by **membership** of `payoutMonthOptions(new Date())`, not a
 * regex — that is also what enforces "current month forward" (AP-1's
 * correction case does not apply here: the figure is not signed yet).
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

  try {
    const body = (await req.json().catch(() => ({}))) as { ym?: unknown };
    const ym = typeof body.ym === "string" ? body.ym.trim() : "";

    const validOptions = payoutMonthOptions(new Date());
    const option = validOptions.find((o) => o.ym === ym);
    if (!option) {
      return NextResponse.json(
        { ok: false, error: "เดือนที่เลือกไม่อยู่ในช่วงที่กำหนด (เดือนปัจจุบันเป็นต้นไป)" },
        { status: 400 },
      );
    }

    const paymentDate = payoutDateForMonth(ym) ?? option.date;
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);

    const pool = await getAccPool();
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
          { ok: false, error: "ไม่พบคำขอ หรือคำขอไม่ได้อยู่ในขั้นตอนที่บัญชีแก้ไขเดือนจ่ายได้" },
          { status: 400 },
        );
      }

      await tx
        .request()
        .input("rid", sql.Int, id)
        .input("by", sql.Int, actor.userId)
        .input("note", sql.NVarChar, `แก้ไขเดือนจ่ายเป็น ${option.label} (${paymentDate})`)
        .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
                VALUES (@rid, @by, 'payment_date_edited', @note)`);

      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }

    return NextResponse.json({ ok: true, data: { id, ym, paymentDate } });
  } catch (e) {
    // Reached only for a genuine failure now — the expected "wrong state"
    // refusal above returns its own 400 without throwing.
    console.error(
      "[api/request/travel-booking/requests/[id]/payment-date] POST",
      e instanceof Error ? e.message : e,
    );
    return NextResponse.json({ ok: false, error: "แก้ไขเดือนจ่ายไม่สำเร็จ" }, { status: 500 });
  }
}
