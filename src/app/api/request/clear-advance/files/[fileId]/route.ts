import { NextRequest, NextResponse } from "next/server";
import { getAccPool, sql } from "@/lib/acc/pool";
import { requireAuth } from "@/lib/api-auth";
import { downloadFile } from "@/lib/storage";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";

/* ── GET /api/request/clear-advance/files/[fileId] ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { fileId } = await params;

  try {
    const pool = await getAccPool();
    const result = await pool
      .request()
      .input("id", sql.Int, Number(fileId))
      .query(
        `SELECT Id, StoragePath, StorageBackend, ContentType, FileName FROM AccRequestFile WHERE Id = @id`,
      );

    if (result.recordset.length === 0) {
      return NextResponse.json({ ok: false, error: "File not found" }, { status: 404 });
    }

    const file = result.recordset[0];
    const buffer =
      file.StorageBackend === "sharepoint"
        ? await downloadFileFromSharePoint(file.StoragePath)
        : await downloadFile(file.StoragePath);

    const contentType: string = file.ContentType || "application/octet-stream";

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${file.FileName}"`,
      },
    });
  } catch (err) {
    console.error("GET /api/request/clear-advance/files/[fileId] error:", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
