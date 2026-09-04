/**
 * Recompute `AccRequest.PaymentDate` for every AP-17 request still awaiting the
 * accounting step, under the payout rule in `payout-rule.ts`.
 *
 * **Why this exists.** The rule changed on 2026-09-04: the determining date is
 * now the later of the manager's approval and the trip's return, and a foreign
 * trip pays twice a month. Every row already in the queue carries a date minted
 * by the old approval-date-only rule, and the shape that changes is the common
 * one — AP-17 is approved *before* travel, so "approved on the 6th, returning on
 * the 21st" is normal rather than an edge. Leaving them would make the change
 * look inert on exactly the rows people are looking at.
 *
 * Recomputing and overwriting is the user's decision (2026-09-04), taken over
 * showing the disagreement and offering a correction.
 *
 * **Bounded to `(ManagerApproved, ACCOUNT)`** — the same window the accounting
 * screen may edit. A request already `Completed` has been signed off and its
 * figure is frozen; one that has not reached accounting will be minted by
 * `approveByManager` under the new rule anyway.
 *
 * Every change is one transaction with its own `AccActivityLog` row, so a
 * scheduled payment never moves without a trail.
 *
 *   npx tsx --env-file=.env.local scripts/checks/recompute-ap17-payout.ts [--apply] [--db <name>]
 *
 * Dry run by default: it prints what it would change and writes nothing.
 */
import { getAppPool, sql } from "../../src/lib/db/mssql";
import { payoutDateFor, payoutTripKind, payoutDateLabel } from "../../src/lib/acc/travel-booking/payout-rule";

const args = process.argv.slice(2);
const APPLY = args.indexOf("--apply") !== -1;
const dbIdx = args.indexOf("--db");
const DB = dbIdx !== -1 ? args[dbIdx + 1] : "Rocks_Portal_Form";

function ymd(d: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Row {
  Id: number;
  RequestNo: string | null;
  CountryCode: string | null;
  PaymentDate: Date | null;
  ReturnDate: Date | null;
  ManagerApprovedAt: Date | null;
}

async function main() {
  const pool = await getAppPool(DB);
  console.log(`database: ${DB}   mode: ${APPLY ? "APPLY" : "dry run"}\n`);

  const res = await pool.request().query(`
    SELECT r.Id, r.RequestNo, r.CountryCode, r.PaymentDate, t.ReturnDate,
           (SELECT TOP 1 ap.ActionedAt FROM [dbo].[AccApproval] ap
            WHERE ap.RequestId = r.Id AND ap.StepCode = 'MANAGER' AND ap.Status = 'Approved'
            ORDER BY ap.ActionedAt DESC) AS ManagerApprovedAt
    FROM [dbo].[AccRequest] r
    INNER JOIN [dbo].[AccTravelBooking] t ON t.RequestId = r.Id
    WHERE r.FormCode = 'AP-17' AND r.Status = 'ManagerApproved' AND r.CurrentStepCode = 'ACCOUNT'
    ORDER BY r.Id
  `);
  const rows = res.recordset as Row[];
  console.log(`${rows.length} request(s) at the accounting step\n`);

  let changed = 0;
  let same = 0;
  let skipped = 0;

  for (const r of rows) {
    const kind = payoutTripKind(r.CountryCode);
    const approvalYmd = r.ManagerApprovedAt ? ymd(r.ManagerApprovedAt) : null;
    const returnYmd = r.ReturnDate ? ymd(r.ReturnDate) : null;
    const current = r.PaymentDate ? ymd(r.PaymentDate) : null;
    const next = payoutDateFor(kind, approvalYmd, returnYmd);

    const tag = `${r.RequestNo ?? r.Id} [${kind}]`;
    if (!next) {
      // The rule refuses rather than guessing, and so does this: a row with no
      // manager approval or no return date keeps whatever it holds.
      console.log(`  SKIP  ${tag}  approval=${approvalYmd ?? "-"} return=${returnYmd ?? "-"}`);
      skipped++;
      continue;
    }
    if (next === current) {
      console.log(`  same  ${tag}  ${current}`);
      same++;
      continue;
    }

    console.log(
      `  MOVE  ${tag}  ${current ?? "(none)"} -> ${next}   ` +
        `(approval ${approvalYmd}, return ${returnYmd})`,
    );
    changed++;
    if (!APPLY) continue;

    const tx = pool.transaction();
    await tx.begin();
    try {
      const upd = await tx
        .request()
        .input("id", sql.Int, r.Id)
        .input("pd", sql.Date, next)
        .query(`UPDATE [dbo].[AccRequest] SET PaymentDate=@pd, UpdatedAt=SYSDATETIME()
                WHERE Id=@id AND FormCode='AP-17'
                  AND Status='ManagerApproved' AND CurrentStepCode='ACCOUNT'`);
      if ((upd.rowsAffected[0] ?? 0) === 0) {
        await tx.rollback();
        console.log(`        (moved on while running — left alone)`);
        continue;
      }
      await tx
        .request()
        .input("rid", sql.Int, r.Id)
        .input("note", sql.NVarChar,
          `คำนวณกำหนดจ่ายใหม่ตามกฎใหม่: ${current ? payoutDateLabel(current) ?? current : "(ไม่มี)"}` +
          ` → ${payoutDateLabel(next) ?? next}`)
        .query(`INSERT INTO [dbo].[AccActivityLog] (RequestId, AuthorId, Action, Note)
                VALUES (@rid, NULL, 'payment_date_recomputed', @note)`);
      await tx.commit();
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }

  console.log(
    `\n${changed} to change, ${same} already correct, ${skipped} skipped` +
      (APPLY ? " — applied." : " — dry run, nothing written. Re-run with --apply."),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
