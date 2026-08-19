/**
 * Discarding an AP-4 draft, and the objects that go with it.
 *
 * AP-4 shipped without a delete, and the consequence is worse than a missing
 * button: an abandoned `Draft` becomes permanently unreachable. `listMyRequestRows`
 * excludes `Draft`, and `requests/drafts` answers `TOP 1 … ORDER BY UpdatedAt DESC`,
 * so once "เริ่มคำขอใหม่" has opened a newer one the older draft is in no list,
 * in no prompt and has no affordance of any kind — while its receipts sit under
 * `_DRAFT/{id}` in SharePoint for good.
 *
 * Its own module rather than an addition to `./request-service.ts`, which is
 * frozen for this task. Nothing is duplicated by the split: the delete needs
 * none of that file's row mapping or requester resolution.
 */

import { getAccPool, sql } from "@/lib/acc/pool";
import { deleteStoredFiles, type StoredFileRef } from "@/lib/acc/stored-file";
import { AccConflictError } from "@/lib/acc/request-errors";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

export const DELETE_NOT_EDITABLE =
  "คำขอนี้ถูกส่งไปแล้วหรือถูกแก้ไขโดยผู้อื่น — ลบไม่ได้ กรุณาโหลดหน้านี้ใหม่";

/**
 * Permanently remove a `Draft` or `Returned` AP-4 request the caller created,
 * with its items, rule acknowledgements, approvals, activity log, attachment
 * rows and the stored bytes behind them.
 *
 * The state is **claimed, not read**: one conditional `UPDATE` naming the id,
 * the form, the creator and the two deletable statuses, checked on
 * `rowsAffected`. That both proves the row is deletable and takes the exclusive
 * lock that holds it that way for the rest of the transaction — a plain
 * `SELECT` then `DELETE` (which is what AP-1's `deleteDraft` does) can race a
 * submit landing in between and delete a request that has just entered the
 * approval chain.
 *
 * `AccReimburse`, `AccReimburseItem` and `AccReimburseRuleAck` all cascade from
 * `AccRequest` (migrations 088 and 089) and are still deleted by name. Relying
 * on the cascade would make this correct only for as long as nobody adds a child
 * table without one, and the failure mode is an orphan nobody looks for.
 *
 * Deliberately **not** behind `assertFormWritable()`. That guard asks "is this
 * database still taking new work", and its call sites are each form's save and
 * each form's submit — nothing else. Discarding a draft is not new work, AP-1's
 * `deleteDraft` is not gated either, and gating it here would strand the draft
 * in exactly the situation this function exists to fix: a form switched off with
 * somebody's abandoned claim still holding SharePoint objects.
 */
export async function deleteReimburseDraft(id: number, userId: number): Promise<void> {
  const pool = await getAccPool();
  const tx = pool.transaction();
  let storedFiles: StoredFileRef[] = [];

  await tx.begin();
  try {
    const claim = await tx
      .request()
      .input("id", sql.Int, id)
      .input("form", sql.NVarChar, AP4_FORM_CODE)
      .input("uid", sql.Int, userId)
      .query(
        `UPDATE [dbo].[AccRequest]
         SET UpdatedAt = SYSDATETIME()
         WHERE Id = @id
           AND FormCode = @form
           AND CreatedBy = @uid
           AND Status IN ('Draft', 'Returned')`,
      );

    if (claim.rowsAffected[0] !== 1) {
      // One message for "no such AP-4 request of yours" and another for "yours,
      // but past the point of deleting" would need a second read to tell apart,
      // and the second read is the race this claim exists to avoid. The route
      // has already answered the ownership question through `authorizeAccRequest`,
      // so anything reaching here and failing is a state change under the click.
      // 409, not 400: reloading is the fix and retrying can never be.
      throw new AccConflictError(DELETE_NOT_EDITABLE);
    }

    // Read where the bytes are before the rows recording it go. After the
    // DELETE below there is nothing left that knows.
    const filesRes = await tx
      .request()
      .input("id", sql.Int, id)
      .query(
        `SELECT StoragePath, StorageBackend FROM [dbo].[AccRequestFile] WHERE RequestId = @id`,
      );
    storedFiles = (
      filesRes.recordset as { StoragePath: string; StorageBackend: string | null }[]
    ).map((r) => ({ storagePath: r.StoragePath, storageBackend: r.StorageBackend }));

    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccRequestFile] WHERE RequestId = @id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccReimburseRuleAck] WHERE RequestId = @id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccReimburseItem] WHERE RequestId = @id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccReimburse] WHERE RequestId = @id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccApproval] WHERE RequestId = @id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccActivityLog] WHERE RequestId = @id`);
    await tx
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM [dbo].[AccRequest] WHERE Id = @id`);

    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  // After the commit: the draft is gone either way, and a storage failure must
  // not resurrect it or turn a successful delete into a 500. Reported, not
  // swallowed — `deleteStoredFiles` dispatches on the backend, so a SharePoint
  // driveItem id is never handed to `fs.unlink`.
  await deleteStoredFiles(storedFiles, `AP-4 deleteDraft request ${id}`);
}
