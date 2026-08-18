import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/api-auth";
import { listTiers, upsertTier } from "@/lib/adv/advance-tier-service";
import { isStepType, type StepType } from "@/lib/adv/approval-steps";

/** GET — the amount → steps approval matrix. IT/System Admin only. */
export async function GET() {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    return NextResponse.json({ ok: true, data: await listTiers() });
  } catch (err) {
    console.error("[api/request/advance/settings/tiers] GET", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

/** POST — upsert one tier. Body: { id?, minAmount, maxAmount, steps: StepType[], isActive?, sortOrder? }. */
export async function POST(req: NextRequest) {
  const session = await requireRole(["IT Admin", "System Admin"]);
  if (session instanceof Response) return session;
  try {
    const b = await req.json();
    const steps = Array.isArray(b.steps) ? (b.steps as unknown[]).filter(isStepType) as StepType[] : [];
    if (steps.length === 0) {
      return NextResponse.json({ ok: false, error: "ต้องเลือกอย่างน้อย 1 ขั้นอนุมัติ" }, { status: 400 });
    }
    const minAmount = Number(b.minAmount);
    const maxAmount = b.maxAmount === null || b.maxAmount === undefined || b.maxAmount === "" ? null : Number(b.maxAmount);
    if (Number.isNaN(minAmount) || (maxAmount != null && maxAmount < minAmount)) {
      return NextResponse.json({ ok: false, error: "ช่วงจำนวนเงินไม่ถูกต้อง" }, { status: 400 });
    }
    await upsertTier({
      id: b.id,
      minAmount,
      maxAmount,
      steps,
      isActive: b.isActive,
      sortOrder: b.sortOrder,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/request/advance/settings/tiers] POST", err);
    return NextResponse.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}
