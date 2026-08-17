/**
 * Refusals that only exist because Production and UAT run side by side.
 *
 * Every one of them is judged on `resolveFormEnvironment()` /
 * `resolveCurrentFormAccess()` — the **resolved** environment, which honours the
 * record's id — and never on the viewer's UAT-mode cookie. A tester in UAT mode
 * opening one of their own production claims resolves Production by id, and must
 * be treated exactly like anybody else on that claim.
 *
 * Kept out of `./service` so the tester service stays free of `next/headers`:
 * `src/lib/form-environment/index.ts` dynamically imports that service from
 * inside `viewerIsTesting`, and a static edge back would put the resolver's own
 * dependencies inside the module it lazily loads.
 */
import { resolveCurrentFormWritable, resolveFormEnvironment } from "@/lib/form-environment";
import { getActiveUatTesterFor } from "./service";

/** A form switched off in the environment this request resolved to. */
export const FORM_UNAVAILABLE_ERROR = "ฟอร์มนี้ยังไม่เปิดให้ใช้งานในสภาพแวดล้อมที่คุณอยู่";

/** A UAT request opened for somebody outside the tester list. */
export const UAT_ON_BEHALF_ERROR = "โหมด UAT: ส่งแทนคนที่ไม่ได้อยู่ในรายชื่อ UAT Users ไม่ได้";

/**
 * What every "no manager" refusal says in UAT. The production wording points at
 * HR, which is the wrong remedy here: nothing in HR can fix a UAT chain, and
 * following it would end with somebody asking HR to point a real manager at test
 * data.
 */
export const UAT_MANAGER_MISSING_ERROR =
  "โหมด UAT: ยังไม่ได้กำหนดผู้จัดการสำหรับ UAT — ตั้งที่ Settings → UAT Users";

/** True when the current request resolved to the UAT database. */
export async function isUatRequest(): Promise<boolean> {
  return (await resolveFormEnvironment()) === "UAT";
}

/**
 * Refuse a write to a form the environment this request resolved to is no longer
 * taking work for.
 *
 * `resolveCurrentFormWritable()` rather than `resolveCurrentFormAccess().available`:
 * the id rule is what lets a tester with UAT mode off save the UAT draft they
 * were just allowed to open, so a named record is always *available* — and every
 * submit and every resumed draft names one. Judged on `available`, this guard
 * fired only on brand-new drafts, and turning `ProductionEnabled` off left every
 * request already in flight still submitting into production. The environment is
 * still decided by the id; only the verdict on writing to it comes from that
 * environment's own switch.
 */
export async function assertFormWritable(): Promise<void> {
  if (!(await resolveCurrentFormWritable())) throw new Error(FORM_UNAVAILABLE_ERROR);
}

/**
 * Refuse an on-behalf write whose requester is outside the tester list while the
 * request resolves UAT.
 *
 * Both forms route to the manager of the **requester**, not the actor, so
 * without this a tester could file a UAT request for a colleague who has no UAT
 * manager at all — and the chain would either dead-end or reach for the
 * colleague's real HR manager. No-op outside UAT.
 */
export async function assertRequesterAllowedInUat(
  requesterEmail: string | null,
  requesterStaffId: number | null,
): Promise<void> {
  if (!(await isUatRequest())) return;
  const tester = await getActiveUatTesterFor(requesterEmail, requesterStaffId);
  if (!tester) throw new Error(UAT_ON_BEHALF_ERROR);
}
