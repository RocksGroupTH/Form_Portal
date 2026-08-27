import type { PerDiemDependency } from "@/lib/acc/travel-booking/perdiem-dependency";

/**
 * The Thai wording for a blocked sign-off — one copy, read by both the
 * accounting queue's in-row warning and the route's refusal.
 *
 * Separate from `perdiem-dependency.ts` so that file stays the decision and
 * nothing else, and pure/import-free (the type import is erased) so the queue
 * page — a `"use client"` component — can read the same sentences the server
 * refuses with. Two places writing this independently is how a queue comes to
 * say one thing and the 400 another.
 */

/** A request with no number yet — the shape `perdiem-recompute.ts` already uses in its notes. */
export function dependencyRequestLabel(dep: PerDiemDependency): string {
  return dep.requestNo ?? `#${dep.requestId}`;
}

/**
 * Why that request is not settled yet, in Thai.
 *
 * An unrecognised status is named rather than guessed at — `perdiem-dependency`
 * treats anything it has not heard of as unsettled, so this has to be able to
 * say something true about a status this file has not heard of either.
 */
export function dependencyStatusReason(status: string): string {
  if (status === "Draft") return "ยังเป็นฉบับร่าง ยังไม่ได้ส่ง";
  if (status === "Submitted") return "ผู้จัดการยังไม่อนุมัติหรือไม่อนุมัติ";
  if (status === "Returned") return "ถูกส่งกลับให้ผู้ขอแก้ไข และอาจถูกส่งมาอนุมัติใหม่";
  return `มีสถานะ ${status} ซึ่งยังไม่ถือว่าสิ้นสุด`;
}

/** The warning shown on the queue row. */
export function dependencyWarningText(dep: PerDiemDependency): string {
  return (
    `ยอดเบี้ยเลี้ยงของคำขอนี้ขึ้นอยู่กับคำขอ ${dependencyRequestLabel(dep)} ` +
    `(${dependencyStatusReason(dep.status)}) — ` +
    `ถ้าคำขอนั้นไม่ได้รับอนุมัติ วันเบี้ยเลี้ยงจะถูกคืนและยอดจะเปลี่ยน จึงยังอนุมัติรายการนี้ไม่ได้`
  );
}

/** The message the server refuses with. */
export function dependencyRefusalText(dep: PerDiemDependency): string {
  return (
    `ยังอนุมัติไม่ได้ — ยอดเบี้ยเลี้ยงของคำขอนี้ขึ้นอยู่กับคำขอ ${dependencyRequestLabel(dep)} ` +
    `ซึ่ง${dependencyStatusReason(dep.status)} กรุณารอให้คำขอนั้นได้ข้อสรุปจากผู้จัดการก่อน`
  );
}
