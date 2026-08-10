import { NextRequest, NextResponse } from "next/server";
import { getFormPool, sql } from "@/lib/db/mssql";
import { requireAuth } from "@/lib/api-auth";
import { downloadFile } from "@/lib/storage";

/* ── GET /api/forms/files/[fileId] ── */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { fileId } = await params;

  try {
    const pool = await getFormPool();
    const result = await pool
      .request()
      .input("id", sql.Int, Number(fileId))
      .query(
        `SELECT * FROM OfficeFormFiles WHERE Id = @id AND IsActive = 1`,
      );

    if (result.recordset.length === 0) {
      return NextResponse.json(
        { ok: false, error: "File not found" },
        { status: 404 },
      );
    }

    const file = result.recordset[0];
    const buffer = await downloadFile(file.StoragePath);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.ContentType,
        "Content-Disposition": `inline; filename="${file.FileName}"`,
      },
    });
  } catch (err) {
    console.error("GET /api/forms/files/[fileId] error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}
