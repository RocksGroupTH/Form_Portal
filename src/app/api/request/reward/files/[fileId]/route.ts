import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";
import { AP11_FORM_CODE, REWARD_FILE_REFTYPE } from "@/features/reward/constants";

/* ── GET /api/request/reward/files/[fileId] — stream one AP-11 attachment ── */

/**
 * Two things this route must not do, both of which the equivalent AP-1 route
 * once did and was fixed for:
 *
 * - serve a file id without joining it to its parent request, which makes every
 *   attachment in the database reachable behind a small sequential integer;
 * - echo the stored `ContentType` back with `inline`, which turns an upload
 *   declaring `image/svg+xml` into script execution on this origin.
 *
 * So: the parent is loaded first and run through the object ACL, and
 * `attachmentResponseHeaders` re-sniffs the bytes on the way out.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const id = Number((await params).fileId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  try {
    const pool = await getAccPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("ref", sql.NVarChar, REWARD_FILE_REFTYPE)
      .query(
        `SELECT Id, RequestId, StoragePath, StorageBackend, FileName
           FROM [dbo].[AccRequestFile] WHERE Id = @id AND RefType = @ref`,
      );
    if (result.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const file = result.recordset[0] as {
      RequestId: number | null;
      StoragePath: string;
      StorageBackend: string;
      FileName: string;
    };

    // An orphaned row is unreadable rather than unowned — there is nothing left
    // to authorize against.
    if (file.RequestId == null) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const gate = await authorizeAccRequest(session, Number(file.RequestId), "read", AP11_FORM_CODE);
    if (gate instanceof Response) return gate;

    const buffer =
      file.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(file.StoragePath)
        : await downloadFile(file.StoragePath);

    return new Response(new Uint8Array(buffer), {
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: file.FileName }),
    });
  } catch (err) {
    console.error("[api/request/reward/files/[fileId]] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
