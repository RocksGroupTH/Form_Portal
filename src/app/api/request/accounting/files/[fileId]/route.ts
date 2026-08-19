import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";

/* ── GET /api/request/accounting/files/[fileId] ──
   Streams one AP-1 attachment. Two things were missing and are now here:

   - the file id was never joined to its parent request, so any numeric id was
     downloadable by any authenticated session — receipts and, on the AP-17 side,
     national-ID scans, all behind a small sequential integer;
   - the stored `ContentType` was echoed back with `Content-Disposition: inline`,
     so an upload declaring `image/svg+xml` (which the old `startsWith("image/")`
     gate accepted) executed on this origin. The bytes now decide the type, and
     only real raster images stay inline. */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { fileId } = await params;
  const id = Number(fileId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  try {
    const pool = await getAccPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        `SELECT Id, RequestId, StoragePath, StorageBackend, ContentType, FileName
         FROM [dbo].[AccRequestFile] WHERE Id = @id`,
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

    // An orphaned row (parent already deleted) is unreadable rather than
    // unowned — there is nothing left to authorize against.
    if (file.RequestId == null) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }
    const gate = await authorizeAccRequest(session, Number(file.RequestId), "read");
    if (gate instanceof Response) return gate;

    const buffer =
      file.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(file.StoragePath)
        : await downloadFile(file.StoragePath);

    return new Response(new Uint8Array(buffer), {
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: file.FileName }),
    });
  } catch (err) {
    console.error("GET /api/request/accounting/files/[fileId] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
