import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { getAccPool, sql } from "@/lib/adv/pool";
import { downloadFileFromSharePoint, deleteFileFromSharePoint } from "@/lib/sharepoint";
import { downloadFile, deleteFile } from "@/lib/storage";
import { getAdvanceFile, deleteAdvanceFileRow } from "@/lib/adv/advance-file-service";

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/* ── GET /api/request/advance/files/[fileId] — stream the attachment ── */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { fileId: raw } = await params;
  const fileId = parseId(raw);
  if (fileId == null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const file = await getAdvanceFile(fileId);
  if (!file) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  try {
    const buffer = file.storageBackend === "sharepoint"
      ? await downloadFileFromSharePoint(file.storagePath)
      : await downloadFile(file.storagePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, max-age=60",
      },
    });
  } catch (e) {
    console.error("[advance/files/[fileId]] GET", e);
    return NextResponse.json({ ok: false, error: "ดาวน์โหลดไฟล์ไม่สำเร็จ" }, { status: 502 });
  }
}

/* ── DELETE /api/request/advance/files/[fileId] — owner-only, Draft/Returned ── */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const userId = Number(session.user.id);
  const { fileId: raw } = await params;
  const fileId = parseId(raw);
  if (fileId == null) return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });

  const file = await getAdvanceFile(fileId);
  if (!file) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

  const pool = await getAccPool();
  const rc = await pool.request().input("rid", sql.Int, file.requestId)
    .query(`SELECT Status, CreatedBy FROM [dbo].[AccRequest] WHERE Id=@rid`);
  const row = rc.recordset[0] as { Status: string; CreatedBy: number | null } | undefined;
  if (!row || row.CreatedBy !== userId) {
    return NextResponse.json({ ok: false, error: "ลบได้เฉพาะเจ้าของคำขอ" }, { status: 403 });
  }
  if (row.Status !== "Draft" && row.Status !== "Returned") {
    return NextResponse.json({ ok: false, error: "ลบไฟล์ได้เฉพาะฉบับร่าง" }, { status: 400 });
  }

  try {
    if (file.storageBackend === "sharepoint") await deleteFileFromSharePoint(file.storagePath).catch(() => {});
    else await deleteFile(file.storagePath).catch(() => {});
    await deleteAdvanceFileRow(fileId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[advance/files/[fileId]] DELETE", e);
    return NextResponse.json({ ok: false, error: "ลบไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
