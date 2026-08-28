import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";
import { AP3_FORM_CODE } from "@/features/clear-advance/constants";

/* ── GET /api/request/clear-advance/files/[fileId] ──
   One AP-3 attachment (receipt, tax invoice, refund-transfer slip).

   It authorizes on the file's **parent request**, never on the file id — the
   same rule AP-4's route states. A numeric file id is a small sequential
   integer shared across every form in `AccRequestFile`, so guessing one is not
   a control: until 2026-08-28 this route ran `requireAuth()` and then streamed
   the bytes, which made every AP-3 attachment readable by any signed-in user.

   `authorizeAccRequest` is pinned by `AP3_FORM_CODE`, so a file whose parent is
   not an AP-3 request 404s here rather than being served out of whichever
   database the `/api/request/clear-advance/**` prefix happens to resolve to. */

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
    const pool = await getAccPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .query(
        `SELECT Id, RequestId, StoragePath, StorageBackend, FileName FROM AccRequestFile WHERE Id = @id`,
      );

    if (result.recordset.length === 0) return NOT_FOUND();

    const file = result.recordset[0] as {
      RequestId: number | null;
      StoragePath: string;
      StorageBackend: string;
      FileName: string;
    };
    // An orphaned row (parent already deleted) is unreadable rather than
    // unowned — there is nothing left to authorize against.
    if (file.RequestId == null) return NOT_FOUND();

    const gate = await authorizeAccRequest(session, Number(file.RequestId), "read", AP3_FORM_CODE);
    if (gate instanceof Response) return gate;

    const buffer =
      file.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(file.StoragePath)
        : await downloadFile(file.StoragePath);

    // The type is re-derived from the bytes, never echoed from the stored
    // `ContentType` — rows written before the upload guard carry whatever the
    // browser declared, and this route served that claim back `inline` with no
    // `nosniff`. Only real raster images stay inline now; everything else is a
    // forced download under `nosniff` and a `default-src 'none'; sandbox` CSP.
    return new Response(new Uint8Array(buffer), {
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: file.FileName }),
    });
  } catch (err) {
    console.error("GET /api/request/clear-advance/files/[fileId] error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
