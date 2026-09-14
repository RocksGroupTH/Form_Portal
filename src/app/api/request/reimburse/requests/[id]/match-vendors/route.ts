import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { authorizeAccRequest } from "@/lib/acc/request-acl";
import { buildAccActor } from "@/lib/acc/actor-context";
import { getReimburseRequest } from "@/lib/acc/reimburse/request-service";
import { setReimburseItemAccounts } from "@/lib/acc/reimburse/approval-service";
import { matchVendorsForClaim } from "@/lib/acc/reimburse/vendor-match-service";
import { getBrandErpInterfaceMap } from "@/lib/acc/brand-erp-interface-map-service";
import { statusForAccError } from "@/lib/acc/request-errors";
import { AP4_FORM_CODE } from "@/features/reimburse/constants";

/**
 * POST /api/request/reimburse/requests/[id]/match-vendors
 *
 * Find the Business Central vendor card for every line of one claim that has
 * none, from the seller's tax id and name, and record `"none"` on the lines
 * whose seller has no card at all.
 *
 * `suggest-gl` beside it is the model this follows, decision for decision:
 *
 * **One claim per call, from a button.** Matching on every keystroke spends a
 * lookup per character; matching the whole queue on open spends one per line of
 * every claim before anybody has decided to look. A button also makes the cost
 * legible — the accountant chooses when to ask.
 *
 * **It only touches lines nobody has answered for** — no `VendorNo` *and* no
 * verdict. A line an accountant set is their answer, and a line already marked
 * `"none"` has been asked and answered; re-running must not overwrite either.
 * Clearing a line's vendor returns it to NULL, which is how somebody asks
 * again.
 *
 * **The claim brand is resolved to the Interface company first.** `ErpVendors`
 * is keyed on the Business Central company, so passing the claim brand through
 * answers an empty list for every ROCKS claim — the same resolution the vendor
 * picker itself makes.
 *
 * **The write goes through `setReimburseItemAccounts`**, so it inherits every
 * guard the manual edit has: the roster check, the `(AP-4, ManagerApproved,
 * ACCOUNT)` predicate claimed with a conditional UPDATE inside the transaction,
 * the brand scope re-decided from the database, and the old→new activity row. A
 * sibling writer would re-implement four checks and could only get one wrong.
 *
 * **`authorizeAccRequest(..., "read", ...)`, not `"mutate"`** — that mode is
 * creator-and-`Draft`/`Returned`-only and would refuse every legitimate
 * approver. Same layering as `../items` and `../suggest-gl`, and the roster
 * check inside the service is what narrows the `"read"` verdict, which also
 * admits AP-1's shared `AccApprover` roster.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAuth();
  if (session instanceof Response) return session;

  const { id: rawId } = await params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
  }

  const gate = await authorizeAccRequest(session, id, "read", AP4_FORM_CODE);
  if (gate instanceof Response) return gate;

  try {
    const claim = await getReimburseRequest(id);
    if (!claim) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const map = await getBrandErpInterfaceMap(claim.brandCode ?? "", AP4_FORM_CODE);
    const company = (map?.interfaceBrandCode?.trim() || (claim.brandCode ?? "")).toUpperCase();
    if (!company) {
      return NextResponse.json(
        { ok: false, error: "แบรนด์นี้ยังไม่ได้ map เป็น Company ปลายทาง — ตั้งค่าที่ Interface ERP ก่อน" },
        { status: 400 },
      );
    }

    const targets = claim.items.filter(
      (it) =>
        it.id != null &&
        (it.vendorNo ?? "").trim() === "" &&
        (it.vendorMatchStatus ?? null) === null &&
        ((it.vendorTaxId ?? "").trim() !== "" || (it.vendorName ?? "").trim() !== ""),
    );
    if (targets.length === 0) {
      return NextResponse.json({ ok: true, data: { matched: 0, none: 0 } });
    }

    const answers = await matchVendorsForClaim(
      company,
      targets.map((it) => ({
        id: it.id as number,
        vendorTaxId: it.vendorTaxId ?? null,
        vendorName: it.vendorName ?? null,
      })),
    );
    if (answers.length === 0) {
      return NextResponse.json({ ok: true, data: { matched: 0, none: 0 } });
    }

    // `category` carries the line's CURRENT G/L account, not null: absent, it
    // is treated as a clear by `setReimburseItemAccounts` — the rule
    // `ItemAccountEdit.category` has always had — so matching a vendor would
    // wipe the G/L account the accountant or the AI had just chosen.
    const categoryById = new Map(claim.items.map((it) => [it.id as number, it.category ?? null]));
    const actor = await buildAccActor(Number(session.user.id), session.user.email ?? null);
    await setReimburseItemAccounts(
      id,
      actor,
      answers.map((a) => ({
        id: a.id,
        category: categoryById.get(a.id) ?? null,
        vendorNo: a.vendorNo,
        vendorMatchStatus: a.vendorMatchStatus,
      })),
    );

    return NextResponse.json({
      ok: true,
      data: {
        matched: answers.filter((a) => a.vendorNo).length,
        none: answers.filter((a) => !a.vendorNo).length,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Internal server error";
    return NextResponse.json({ ok: false, error: message }, { status: statusForAccError(e) });
  }
}
