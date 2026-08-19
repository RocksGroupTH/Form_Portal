import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";
import { deleteStoredFiles } from "@/lib/acc/stored-file";
import { AP4_FORM_CODE, REIMBURSE_FILE_REFTYPES } from "@/features/reimburse/constants";

/* ── /api/request/reimburse/files/[fileId] ──
   One AP-4 attachment: GET streams it, DELETE removes it.

   Both authorize on the file's **parent request**, never on the file id: a
   numeric file id is a small sequential integer and guessing one is not a
   control. The lookup is pinned to AP-4 as well, so a file id belonging to
   another form 404s here rather than being served out of whichever database
   `/api/request/reimburse/**` happens to resolve to. */

interface AccFileRow {
  Id: number;
  RequestId: number | null;
  RefType: string | null;
  StoragePath: string;
  StorageBackend: string;
  FileName: string;
}

async function loadFile(fileId: number): Promise<AccFileRow | null> {
  const pool = await getAccPool();
  const res = await pool
    .request()
    .input("id", sql.Int, fileId)
    .query(
      `SELECT Id, RequestId, RefType, StoragePath, StorageBackend, FileName
       FROM [dbo].[AccRequestFile] WHERE Id = @id`,
    );
  return (res.recordset[0] as AccFileRow | undefined) ?? null;
}

const NOT_FOUND = () => NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { fileId } = await params;
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND();

  try {
    const file = await loadFile(id);
    if (!file) return NOT_FOUND();

    // An orphaned row (parent already deleted) is unreadable rather than
    // unowned — there is nothing left to authorize against.
    if (file.RequestId == null) return NOT_FOUND();

    const gate = await authorizeAccRequest(session, Number(file.RequestId), "read", AP4_FORM_CODE);
    if (gate instanceof Response) return gate;

    const buffer =
      file.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(file.StoragePath)
        : await downloadFile(file.StoragePath);

    // The type is re-derived from the bytes here, never echoed from the stored
    // `ContentType`; only real raster images are served inline. A workbook
    // sniffs as a spreadsheet and downloads.
    return new Response(new Uint8Array(buffer), {
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: file.FileName }),
    });
  } catch (err) {
    console.error("GET /api/request/reimburse/files/[fileId] error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { fileId } = await params;
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) return NOT_FOUND();

  try {
    const file = await loadFile(id);
    if (!file) return NOT_FOUND();
    if (file.RequestId == null) return NOT_FOUND();

    // "mutate" is creator-only and Draft/Returned-only, so a submitted request
    // cannot have its evidence removed from under the approvers.
    const requestId = Number(file.RequestId);
    const gate = await authorizeAccRequest(session, requestId, "mutate", AP4_FORM_CODE);
    if (gate instanceof Response) return gate;

    const pool = await getAccPool();

    // The workbook is also a pointer. Clearing it first means the request never
    // shows a file that has been deleted, and — since `getReimburseRequest`
    // reads the workbook through `ExcelFileId` — never satisfies the submit
    // gate with one either.
    if (file.RefType === REIMBURSE_FILE_REFTYPES.EXCEL) {
      await pool
        .request()
        .input("rid", sql.Int, requestId)
        .input("fid", sql.Int, id)
        .query(
          `UPDATE [dbo].[AccReimburse] SET ExcelFileId = NULL
           WHERE RequestId = @rid AND ExcelFileId = @fid`,
        );
    }

    await pool
      .request()
      .input("id", sql.Int, id)
      .query(`DELETE FROM AccRequestFile WHERE Id = @id`);

    // Row first, bytes second, and dispatched on the backend: a Graph driveItem
    // id handed to `fs.unlink` silently misses and orphans the object. What
    // cannot be removed is logged rather than swallowed.
    await deleteStoredFiles(
      [{ storagePath: file.StoragePath, storageBackend: file.StorageBackend }],
      `AP-4 attachment ${id} deleted from request ${requestId}`,
    );

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/request/reimburse/files/[fileId] error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
