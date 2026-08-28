import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { attachmentResponseHeaders } from "@/lib/acc/attachment-guard";
import { downloadFileFromSharePoint } from "@/lib/sharepoint";
import { downloadFile } from "@/lib/storage";
import { deleteStoredFiles } from "@/lib/acc/stored-file";
import { AP2_FORM_CODE } from "@/features/advance/constants";
import { getAdvanceFile, deleteAdvanceFileRow } from "@/lib/adv/advance-file-service";

/* ── /api/request/advance/files/[fileId] ──
   One AP-2 attachment: GET streams it, DELETE removes it.

   Both authorize on the file's **parent request**, never on the file id — the
   same rule AP-4's route states. A numeric file id is a small sequential
   integer shared across every form in `AccRequestFile`, so guessing one is not
   a control: until 2026-08-28 this route ran `requireAuth()` and then streamed
   the bytes, which made every AP-2 attachment readable by any signed-in user.

   `getAdvanceFile` already pins `RefType`, and `authorizeAccRequest` is pinned
   again by `AP2_FORM_CODE`, so a file whose parent is not an AP-2 request 404s
   here rather than being served out of whichever database the
   `/api/request/advance/**` prefix happens to resolve to. */

const NOT_FOUND = () => NextResponse.json({ ok: false, error: "not found" }, { status: 404 });

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/* ── GET /api/request/advance/files/[fileId] — stream the attachment ── */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ fileId: string }> }) {
  const session = await requireAuth();
  if (session instanceof Response) return session;
  const { fileId: raw } = await params;
  const fileId = parseId(raw);
  if (fileId == null) return NOT_FOUND();

  const file = await getAdvanceFile(fileId);
  if (!file) return NOT_FOUND();
  // An orphaned row (parent already deleted) is unreadable rather than unowned —
  // there is nothing left to authorize against.
  if (file.requestId == null) return NOT_FOUND();

  const gate = await authorizeAccRequest(session, Number(file.requestId), "read", AP2_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const buffer = file.storageBackend === "sharepoint"
      ? await downloadFileFromSharePoint(file.storagePath)
      : await downloadFile(file.storagePath);
    // The type is re-derived from the bytes, never echoed from the stored
    // `ContentType` — rows written before the upload guard carry whatever the
    // browser declared. Only real raster images stay inline; everything else is
    // a forced download under `nosniff` and a `default-src 'none'; sandbox` CSP.
    return new NextResponse(new Uint8Array(buffer), {
      headers: attachmentResponseHeaders({ bytes: buffer, fileName: file.fileName }),
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
  const { fileId: raw } = await params;
  const fileId = parseId(raw);
  if (fileId == null) return NOT_FOUND();

  const file = await getAdvanceFile(fileId);
  if (!file) return NOT_FOUND();
  if (file.requestId == null) return NOT_FOUND();

  // "mutate" is creator-only and Draft/Returned-only — the same pair of
  // conditions this route checked by hand, now decided in one place and pinned
  // to AP-2 so an id belonging to another form cannot be reached through it.
  const gate = await authorizeAccRequest(session, Number(file.requestId), "mutate", AP2_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    await deleteAdvanceFileRow(fileId);
    // Row first, bytes second, and dispatched on the backend: a Graph driveItem
    // id handed to `fs.unlink` silently misses and orphans the object.
    await deleteStoredFiles(
      [{ storagePath: file.storagePath, storageBackend: file.storageBackend }],
      `AP-2 attachment ${fileId} deleted from request ${file.requestId}`,
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[advance/files/[fileId]] DELETE", e);
    return NextResponse.json({ ok: false, error: "ลบไฟล์ไม่สำเร็จ" }, { status: 500 });
  }
}
