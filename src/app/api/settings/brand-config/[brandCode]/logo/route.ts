import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listBrandRegistry, saveBrandSetting } from "@/lib/brand-registry";
import { checkAttachment, checkAttachmentBatch } from "@/lib/acc/attachment-guard";

/**
 * A brand's logo: upload one, or remove the one that is there.
 *
 * The bytes go into `Rocks_Portal_Form.dbo.BrandSetting` rather than onto disk
 * because `.AutoDeploy.bat` runs `git reset --hard origin/master` on every
 * release — an uploaded file under `public/` would survive until the next
 * deploy and no longer.
 *
 * **Images only, decided from the bytes.** `checkAttachment` with
 * `allowedKinds: ["image"]` is the same guard AP-17's ID-card slot uses, and
 * for the same reason: this file is rendered `inline` in an `<img>` on every
 * page that shows a brand, so a PDF or an SVG has no business here — an SVG in
 * particular is the classic stored-XSS carrier. `file.type` is a claim, not
 * evidence.
 */

async function assertKnownBrand(code: string): Promise<boolean> {
  const brands = await listBrandRegistry();
  return brands.some((b) => b.code === code);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ brandCode: string }> },
) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { brandCode } = await params;
  const code = decodeURIComponent(brandCode).trim().toUpperCase();
  if (!code || !(await assertKnownBrand(code))) {
    return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ ok: false, error: "No file provided" }, { status: 400 });
    }

    const batchRejection = checkAttachmentBatch([file]);
    if (batchRejection) {
      return NextResponse.json({ ok: false, error: batchRejection.error }, { status: batchRejection.status });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const check = checkAttachment({
      fileName: file.name,
      declaredType: file.type,
      bytes,
      allowedKinds: ["image"],
    });
    if (!check.ok) {
      return NextResponse.json({ ok: false, error: check.error }, { status: check.status });
    }

    await saveBrandSetting(
      code,
      {
        logo: {
          bytes,
          // The sniffed type, not the declared one.
          contentType: check.type.contentType,
          fileName: file.name.slice(0, 260),
        },
      },
      Number(session.user?.id ?? 0),
    );

    return NextResponse.json({ ok: true, data: { brandCode: code } });
  } catch (err) {
    console.error("[api/settings/brand-config/logo] POST", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "อัปโหลดโลโก้ไม่สำเร็จ" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ brandCode: string }> },
) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;

  const { brandCode } = await params;
  const code = decodeURIComponent(brandCode).trim().toUpperCase();
  if (!code || !(await assertKnownBrand(code))) {
    return NextResponse.json({ ok: false, error: "Invalid brand" }, { status: 400 });
  }

  try {
    // `null` clears; `undefined` would have left the logo alone.
    await saveBrandSetting(code, { logo: null }, Number(session.user?.id ?? 0));
    return NextResponse.json({ ok: true, data: { brandCode: code } });
  } catch (err) {
    console.error("[api/settings/brand-config/logo] DELETE", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "ลบโลโก้ไม่สำเร็จ" }, { status: 500 });
  }
}
