import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { isErpInterfaceBrandCode } from "@/lib/acc/erp-interface-brands";
import { listFormBrands } from "@/lib/acc/settings-service";
import {
  loadReimburseErpGroups,
  saveReimburseErpGroup,
  removeReimburseErpMember,
  type ReimburseErpGroupSaveMember,
} from "@/lib/acc/reimburse/erp-interface-settings-service";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * AP-4's own Business Central posting configuration, grouped by interface
 * target the way `erp-interface-settings-service.ts` (SDD Task 6) now shapes
 * it — one card per target (PCTH / KSI / PCMY / UNO) holding the claim brands
 * mapped into it. This route is SDD Task 7: it moved off the old flat,
 * one-card-per-claim-brand API onto the grouped one, and both the old
 * `loadReimburseErpInterfaceSettings` / `saveReimburseErpInterfaceSettings`
 * functions and the boxed comment marking them for deletion are gone from the
 * service file along with this route's old shape.
 *
 * **Admin-only on every method, not `requireReimburseSettingsTab`.** AP-4's
 * `erpInterface` tab is deliberately excluded from `GRANTABLE_REIMBURSE_TABS`
 * — see that module's docblock. `gl-accounts` / `bank-accounts` /
 * `journal-batches` / `branch-codes` are tab-gated on AP-1 but not
 * brand-scoped, so a brand-scoped grant holder there could set another
 * brand's posting configuration (CLAUDE.md, "Do not grant `erpInterface` to a
 * non-admin yet"). AP-4's own config carries the identical gap — nothing here
 * checks `AccApproverInterfaceBrand` or any AP-4 counterpart of it — so this
 * route stays `requireRole` outright rather than opening the same hole to a
 * non-admin who only happens to hold the AP-4 grant.
 *
 * **The brand allow-list comes from `listFormBrands("AP-4")`, resolved here,
 * never taken off the request body.** `saveReimburseErpGroup`'s own docblock
 * says outright that it does not call `assertClaimBrandAllowed` and hands
 * that obligation to this route — a POST naming a brand AP-4 has never been
 * granted must not create a row.
 *
 * **Removal is the DELETE endpoint's job, not a diff computed inside POST.**
 * `saveReimburseErpGroup` writes only the members it is handed and never
 * removes the ones it is not (see that function's own docblock) — pairing it
 * with a removal pass is left to the caller. This route does *not* load the
 * group's previous membership and diff it against the posted one to decide
 * which brands to un-map: `DELETE ?brandCode=` below is a standalone
 * operation, and the settings screen (SDD Task 8) is the one that calls it,
 * once per brand a person actually removed, alongside — not instead of — a
 * POST that saves the members still in the group. Two reasons this is the
 * simpler and safer pairing rather than a diff inside POST: first, a diff
 * would need POST to re-read the group's current membership before writing
 * it, turning a straightforward save into a read-then-write with no
 * transaction spanning the two; second, "which brands left" is exactly what
 * the screen already knows from its own edit state (it is the one that added
 * or removed a row), so recomputing the same fact server-side from a fresh
 * read is redundant and can only disagree with what the person on screen just
 * did. `DELETE` failing independently of `POST` is also the safer partial-
 * failure shape: a removal that fails leaves the brand still mapped rather
 * than silently dropped by a save that partially succeeded.
 *
 * **An empty `members` list is refused outright, not silently accepted.**
 * `saveReimburseErpGroup`'s own docblock says a group with no members saves
 * nothing at all, including its journal batch — the batch is fanned out per
 * member, so there is nowhere to put it with none. Accepting such a POST
 * would look like a successful save that did nothing, so it is a 400 here
 * instead, naming the reason. (This is the stronger of the two options SDD
 * Task 7's brief allowed — refusing at the route rather than only disabling
 * the control on Task 8's screen — because a control removed from a page is
 * not a rule.)
 */

const SETTINGS_ROLES = ["IT Admin", "System Admin"] as const;

/** GET — one card per interface target, plus the unassigned claim brands. */
export async function GET() {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;
  try {
    const data = await loadReimburseErpGroups();
    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("[api/request/reimburse/settings/erp-interface] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST — save one target's group: the shared Journal Batch plus every
 * member's bank account, branch code and Fix Dept, all keyed on that
 * member's own claim brand. Does not remove a brand from the group — see the
 * module docblock for why that is `DELETE`'s job.
 */
export async function POST(req: NextRequest) {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      targetCode?: string;
      journalBatchName?: string | null;
      members?: {
        brandCode?: string;
        bankAccountNo?: string;
        branchCode?: string | null;
        deptAsBranch?: boolean;
        fixedErpDeptCode?: string | null;
      }[];
    };

    const targetCode = (body.targetCode ?? "").trim().toUpperCase();
    if (!targetCode) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์ปลายทาง" }, { status: 400 });
    }
    if (!isErpInterfaceBrandCode(targetCode)) {
      return NextResponse.json({ ok: false, error: "Company ปลายทางไม่ถูกต้อง" }, { status: 400 });
    }

    const membersInput = Array.isArray(body.members) ? body.members : [];
    // A group with no members can save nothing — see the module docblock.
    if (membersInput.length === 0) {
      return NextResponse.json(
        { ok: false, error: "กรุณาเพิ่มแบรนด์เบิกอย่างน้อย 1 แบรนด์ก่อนบันทึก" },
        { status: 400 },
      );
    }

    const members: ReimburseErpGroupSaveMember[] = membersInput.map((m) => ({
      brandCode: (m.brandCode ?? "").trim().toUpperCase(),
      bankAccountNo: (m.bankAccountNo ?? "").trim(),
      branchCode: (m.branchCode ?? "").trim() || null,
      deptAsBranch: !!m.deptAsBranch,
      fixedErpDeptCode: (m.fixedErpDeptCode ?? "").trim() || null,
    }));

    // Never trust the body for which brands AP-4 may configure — the same
    // rows the panel's own GET reads, so a brand that has never been granted
    // to AP-4 (or whose grant was since revoked and never re-added) cannot be
    // written here either, whatever the body names.
    const claimable = await listFormBrands(AP4_FORM_CODE);
    const allowedBrandCodes = new Set(claimable.map((b) => b.brandCode.toUpperCase()));

    // Pass 1: every member's brandCode must be one AP-4 may claim against —
    // checked for the whole group before pass 2, per the brief's own order.
    for (const member of members) {
      if (!member.brandCode || !allowedBrandCodes.has(member.brandCode)) {
        return NextResponse.json(
          { ok: false, error: "แบรนด์นี้ไม่ได้อยู่ในสิทธิ์ของ AP-4" },
          { status: 400 },
        );
      }
    }

    // Pass 2: every member needs a bank account.
    for (const member of members) {
      if (!member.bankAccountNo) {
        return NextResponse.json({ ok: false, error: "กรุณาเลือก Bank Account" }, { status: 400 });
      }
    }

    const journalBatchName = (body.journalBatchName ?? "").trim() || null;

    await saveReimburseErpGroup(
      { targetCode, journalBatchName, members },
      Number(session.user.id),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reimburse/settings/erp-interface] POST", err);
    const msg = err instanceof Error ? err.message : "บันทึกไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

/**
 * DELETE — remove one claim brand from its group entirely (`?brandCode=`).
 * Standalone, not paired automatically with any POST — see the module
 * docblock for why the caller (Task 8's screen) is the one that calls this
 * once per brand actually removed.
 */
export async function DELETE(req: NextRequest) {
  const session = await requireRole([...SETTINGS_ROLES]);
  if (session instanceof Response) return session;
  try {
    const brandCode = req.nextUrl.searchParams.get("brandCode")?.trim();
    if (!brandCode) {
      return NextResponse.json({ ok: false, error: "กรุณาระบุแบรนด์เบิก" }, { status: 400 });
    }
    await removeReimburseErpMember(brandCode, Number(session.user.id));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/reimburse/settings/erp-interface] DELETE", err);
    const msg = err instanceof Error ? err.message : "ลบไม่สำเร็จ";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
