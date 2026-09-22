import { env } from "@/env";
import { esc } from "@/lib/acc/email-templates";
import { payoutDateLabel } from "@/lib/acc/travel-booking/payout-rule";
import type { TravelBookingRequest } from "@/features/travel-booking/types";

/**
 * AP-17 email templates (spec §11-ish — every AccEmailQueue.TriggerType this form emits).
 * Mirrors `src/lib/acc/email-templates.ts` (AP-1)'s `esc()` + HTML shell/brand color,
 * but is typed against `TravelBookingRequest` (AP-1's `AccRequest` doesn't share this shape).
 */

const BRAND_COLOR = "#A3121B";
const FORM_LABEL = "AP-17 · แบบฟอร์มขอจองที่พัก/ตั๋วโดยสาร";

function shell(title: string, bodyRows: string, ctaUrl: string): string {
  return `<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto">
    <p style="margin:0 0 4px;color:#999;font-size:12px">${esc(FORM_LABEL)}</p>
    <h2 style="color:${BRAND_COLOR};margin-top:0">${esc(title)}</h2>
    <table style="width:100%;border-collapse:collapse">${bodyRows}</table>
    <p style="margin-top:16px"><a href="${esc(ctaUrl)}"
      style="background:${BRAND_COLOR};color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">เปิดเอกสาร</a></p>
  </div>`;
}

/**
 * Where the trip goes, for the three approval mails.
 *
 * They carried จังหวัด and nothing else until ข้อ8 was removed on 2026-09-01,
 * so without this a manager approving from mail would be told nothing about the
 * destination at all. Falls back to the stored province for a trip filed before
 * then, which is the only place that value still surfaces.
 */
function workLocationLine(req: TravelBookingRequest): string {
  const places = (req.workLocations ?? [])
    .map((w) => (w.name ?? "").trim())
    .filter((n) => n.length > 0);
  return places.length > 0 ? places.join(" · ") : req.provinceName ?? "-";
}

function row(k: string, v: unknown): string {
  return `<tr><td style="padding:4px 8px;color:#666">${esc(k)}</td><td style="padding:4px 8px">${esc(v)}</td></tr>`;
}

export type TravelBookingTrigger =
  | "Submitted"
  | "Approved"
  | "Rejected"
  | "Returned"
  | "ReadyForAdmin"
  | "Completed";

function dateRangeLabel(req: TravelBookingRequest): string {
  return `${req.departDate ?? "-"} – ${req.returnDate ?? "-"}`;
}

function perDiemLabel(req: TravelBookingRequest): string {
  return `${req.perDiemDays} วัน · ${req.perDiemTotal.toFixed(2)} บาท`;
}

/**
 * Approved's "what happens next" line, and Returned's "what to do" line —
 * named exports so a test can assert against the constant rather than a
 * prose fragment, and a reword does not red the suite for no reason.
 */
export const APPROVED_NEXT_STEP_TEXT = "รอ Admin ดำเนินการจองให้ แล้วจึงส่งให้บัญชีตรวจสอบ";
export const RETURNED_ACTION_TEXT = "เปิดคำขอนี้ แก้ไขตามหมายเหตุ แล้วกดส่งใหม่ (เลขที่เดิม)";

/** Which admin-fill-in items this tab still needs (spec §2.x needs* flags). */
function needsBookingLabel(req: TravelBookingRequest): string {
  const needs: string[] = [];
  if (req.needsRoomBooking) needs.push("ที่พัก");
  if (req.goNeedsTicketBooking) needs.push("ตั๋วขาไป");
  if (req.returnNeedsTicketBooking) needs.push("ตั๋วขากลับ");
  if (req.needsRentBooking) needs.push("เช่ายานพาหนะ");
  return needs.length > 0 ? needs.join(", ") : "-";
}

/**
 * Build the subject + HTML body for one AP-17 notification trigger. All interpolated
 * request/note values are HTML-escaped via `esc()` (through `row()`/`shell()`).
 */
export function buildTravelBookingEmail(
  trigger: TravelBookingTrigger,
  req: TravelBookingRequest,
  note?: string,
  /**
   * Who performed the action, for the three manager triggers.
   *
   * Passed as the acting manager's email; `notify()` (`approval.ts`) upgrades
   * it to their HR display name when one is on file — the MANAGER
   * `AccApproval` row's `actionedByHrName`, already loaded by the time
   * `notify()` runs because all three callers write `ActionedByStaffId`
   * inside their own committed transaction before calling it, so this costs
   * no extra lookup. Falls back to the email when there is no HR row.
   *
   * Optional because the other three triggers (`Submitted`, `ReadyForAdmin`,
   * `Completed`) have no single actor to name, and the Admin/account
   * rejections that reuse the `Rejected`/`Returned` cases pass none either.
   */
  actorName?: string | null,
): { subject: string; html: string } {
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/travel-booking/${req.id ?? ""}`;
  const no = req.requestNo ?? "-";

  switch (trigger) {
    case "Submitted": {
      const subject = `ขออนุมัติจองที่พัก/ตั๋วโดยสาร ${no}`;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", req.requesterFullName ?? "-"),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("เบี้ยเลี้ยง", perDiemLabel(req)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Approved": {
      const subject = `อนุมัติแล้ว ${no}`;
      // The DAY, not the month: a foreign trip pays on the 10th, so "ตุลาคม"
      // alone stopped naming when the money arrives.
      const payoutMonth = req.paymentDate ? payoutDateLabel(req.paymentDate) ?? "-" : "-";
      const rows = [
        row("เลขที่", no),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        actorName ? row("อนุมัติโดย", actorName) : "",
        row("กำหนดจ่าย", payoutMonth),
        row("เบี้ยเลี้ยงรวม (บาท)", req.perDiemTotal.toFixed(2)),
        // The subject reads as finished. It is not — the request goes to the
        // booking desk next, and a requester who thinks it is done does not
        // chase a booking that never happened.
        row("ขั้นถัดไป", APPROVED_NEXT_STEP_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "ReadyForAdmin": {
      const subject = `รอ Admin จองให้ ${no}`;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", req.requesterFullName ?? "-"),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("รายการที่ต้องจอง", needsBookingLabel(req)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Rejected": {
      const subject = `ไม่อนุมัติ ${no}`;
      const rows = [
        row("เลขที่", no),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        actorName ? row("ไม่อนุมัติโดย", actorName) : "",
        note ? row("เหตุผล", note) : "",
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Returned": {
      const subject = `ส่งกลับแก้ไข ${no}`;
      const rows = [
        row("เลขที่", no),
        row("วันเดินทาง", dateRangeLabel(req)),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        actorName ? row("ส่งกลับโดย", actorName) : "",
        note ? row("หมายเหตุ", note) : "",
        // "ส่งกลับแก้ไข" states a status. This states the instruction — and
        // that the running number survives, so nobody files a second request.
        row("สิ่งที่ต้องทำ", RETURNED_ACTION_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "Completed": {
      const subject = `การจองเสร็จสิ้น ${no}`;
      const rows = [
        row("เลขที่", no),
        row("สถานที่ปฏิบัติงาน", workLocationLine(req)),
        row("วันเดินทาง", dateRangeLabel(req)),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }
  }
}

/* ───────────────────────── AP-17 package E — พักห้องเดียวกับ ───────────────────────── */

/**
 * Room-share notifications (spec §5), and **why they are a second builder
 * rather than five more arms of `buildTravelBookingEmail` above.**
 *
 * Spec §5 says the three mails go through "the existing `AccEmailQueue` and
 * `buildTravelBookingEmail`". The queue half is honoured exactly — every one
 * of these is an ordinary `AccEmailQueue` row, so the `[UAT] ` prefix and the
 * `applyUatRedirect` fail-closed rule apply to them unchanged, with no special
 * case anywhere. The builder half could not be, for two reasons that are both
 * about the *shape of the fact* rather than about style:
 *
 * - **A room-share mail is about TWO requests**, the recipient's and the
 *   counterpart's. `buildTravelBookingEmail(trigger, req, …)` takes exactly
 *   one `TravelBookingRequest` and there is nowhere to put the second.
 * - **The cascade cannot obtain a `TravelBookingRequest` at all.** It runs
 *   inside the host's open transaction, and `getTravelBookingRequest` opens
 *   its own pool connection — which would read *outside* that transaction and,
 *   worse, block on the rows the transaction has just locked while the
 *   transaction waits for it. Synthesising a partial `TravelBookingRequest`
 *   and casting it would work today, and is precisely how "a field nobody
 *   intended arrives by inheritance" happens — the hazard the picker's own
 *   narrow response shape already exists to avoid.
 *
 * So these take an explicit, narrow input and reuse `shell()`, `row()`,
 * `esc()` and the brand colour above — the same mail family, built from the
 * two facts the cascade actually has in hand.
 *
 * **Why the copy is this emphatic.** Spec §2: the host has no veto. A guest
 * attaches to a document they do not own, draws money on it, and the host
 * learns afterwards; a `Completed` guest is cancelled even after payment; a
 * guest's dates move with no manager re-reviewing them. **Notification is the
 * entire mitigation** for all three, so each of these mails says what happened
 * *and* what the reader is expected to do about it. A mail that only states a
 * status leaves the protection unperformed.
 */
export type RoomShareMailKind =
  /** To the HOST: somebody has attached to your booking. */
  | "RoomShareAttached"
  /** To the GUEST: your request was cancelled because the host's was. */
  | "RoomShareGuestCancelled"
  /** To the GUEST: your travel dates moved because the host's did. */
  | "RoomShareGuestRedated"
  /** To ACCOUNTING: a request that had reached `Completed` was cancelled by the cascade. */
  | "RoomShareAccountingCancelled"
  /** To ACCOUNTING: a `Completed` request's dates moved but its paid figure could not. */
  | "RoomShareAccountingRedated";

/** One side of the binding, as a mail renders it. Every field is display-only. */
export interface RoomShareMailParty {
  /** Drives the CTA link, so it must be the request the RECIPIENT may open. */
  requestId: number | null;
  requestNo: string | null;
  /** `AccRequest.RequesterFullName` — the traveller, not whoever filed it. */
  personName: string | null;
  departDate: string | null;
  returnDate: string | null;
  /** `AccTravelWorkLocation.Name` values, already joined. */
  workLocation: string | null;
  perDiemDays: number | null;
  perDiemTotal: number | null;
}

export interface RoomShareMailInput {
  kind: RoomShareMailKind;
  /**
   * The request this mail is *about from the recipient's seat*, and the one
   * the CTA opens — the HOST's own request for `RoomShareAttached`, the
   * GUEST's for the other four. Getting this backwards hands somebody a link
   * to a record `decideRequestRead` will refuse them.
   */
  subjectOf: RoomShareMailParty;
  /** The other end of the binding. */
  counterpart: RoomShareMailParty;
  /** A cancelled guest's status immediately before the cascade claimed it. */
  previousStatus?: string | null;
  /** A re-dated guest's range before the cascade moved it. */
  previousDates?: { depart: string; return: string } | null;
}

/**
 * The five "so what do I do" lines, exported so tests assert the constant
 * rather than a prose fragment — package A's precedent, so a reword does not
 * red the suite for no reason.
 */
export const ROOM_SHARE_HOST_NOTICE_TEXT =
  "ระบบไม่ได้ขอความยินยอมจากคุณก่อน — นี่เป็นการแจ้งให้ทราบ " +
  "หากคำขอของคุณถูกยกเลิก/ไม่อนุมัติ คำขอของผู้พักร่วมจะถูกยกเลิกตามอัตโนมัติ " +
  "และหากคุณเปลี่ยนวันเดินทาง วันเดินทางของผู้พักร่วมจะเปลี่ยนตามอัตโนมัติ " +
  "หากไม่ถูกต้อง กรุณาติดต่อผู้พักร่วมโดยตรง";

export const ROOM_SHARE_GUEST_CANCELLED_TEXT =
  "คำขอที่คุณขอพักห้องร่วมด้วยถูกยกเลิกหรือไม่อนุมัติ คำขอนี้จึงถูกยกเลิกตามโดยอัตโนมัติ " +
  "และเบี้ยเลี้ยงถูกคำนวณใหม่ให้กลุ่มคำขอของคุณแล้ว หากยังต้องเดินทาง กรุณายื่นคำขอใหม่";

export const ROOM_SHARE_GUEST_REDATED_TEXT =
  "คำขอที่คุณขอพักห้องร่วมด้วยเปลี่ยนวันเดินทาง คำขอนี้จึงเปลี่ยนวันตามโดยอัตโนมัติ " +
  "โดยไม่ได้ส่งกลับให้ผู้จัดการอนุมัติใหม่ หากวันใหม่ไม่ถูกต้อง " +
  "กรุณาติดต่อเจ้าของคำขอที่พักห้องร่วม หรือยกเลิกการพักห้องร่วมแล้วแก้ไขคำขอของคุณเอง";

export const ROOM_SHARE_ACCOUNTING_CANCELLED_TEXT =
  "คำขอนี้ผ่านบัญชีแล้ว (Completed — อนุมัติและกำหนดวันจ่ายไปแล้ว) " +
  "และถูกยกเลิกอัตโนมัติเพราะคำขอที่พักห้องร่วมด้วยถูกยกเลิก/ไม่อนุมัติ " +
  "กรุณาตรวจสอบว่าจ่ายเบี้ยเลี้ยงไปแล้วหรือไม่ และเรียกคืนหรือหักกลบตามความเหมาะสม";

export const ROOM_SHARE_ACCOUNTING_REDATED_TEXT =
  "คำขอนี้ผ่านบัญชีแล้ว ระบบจึงเปลี่ยนวันเดินทางตามคำขอที่พักห้องร่วม " +
  "แต่ไม่แก้ไขยอดเบี้ยเลี้ยงที่อนุมัติไปแล้ว — วันเดินทางในระบบจึงไม่ตรงกับช่วงวันที่ใช้คำนวณยอด " +
  "กรุณาตรวจสอบและปรับปรุงเอง";

function partyRange(p: RoomShareMailParty): string {
  return `${p.departDate ?? "-"} – ${p.returnDate ?? "-"}`;
}

function partyPerDiem(p: RoomShareMailParty): string {
  if (p.perDiemDays == null && p.perDiemTotal == null) return "-";
  return `${p.perDiemDays ?? 0} วัน · ${(p.perDiemTotal ?? 0).toFixed(2)} บาท`;
}

/** "TRL26-00123 (Somchai Jaidee)" — the counterpart, named where a bare number is not enough. */
function counterpartLabel(p: RoomShareMailParty): string {
  const no = p.requestNo ?? "-";
  return p.personName ? `${no} (${p.personName})` : no;
}

/**
 * Build one room-share notification.
 *
 * Every value is escaped through `row()`/`shell()`, exactly as the six
 * triggers above are. `subject` stays well inside `AccEmailQueue.Subject`'s
 * `nvarchar(500)` even once `applyUatRedirect` has prefixed `[UAT] `.
 */
export function buildRoomShareEmail(input: RoomShareMailInput): { subject: string; html: string } {
  const me = input.subjectOf;
  const other = input.counterpart;
  const url = `${env.NEXT_PUBLIC_APP_URL ?? ""}/request/travel-booking/${me.requestId ?? ""}`;
  const no = me.requestNo ?? "-";

  switch (input.kind) {
    case "RoomShareAttached": {
      const subject = `มีผู้ขอพักห้องร่วมกับคำขอของคุณ ${no}`;
      const rows = [
        row("เลขที่คำขอของคุณ", no),
        row("วันเดินทาง", partyRange(me)),
        row("สถานที่ปฏิบัติงาน", me.workLocation ?? "-"),
        // The guest, named. Spec §5: "so an unexpected one is visible
        // immediately rather than at check-in."
        row("ผู้ขอพักห้องร่วม", other.personName ?? "-"),
        row("เลขที่คำขอของผู้พักร่วม", other.requestNo ?? "-"),
        row("วันเดินทางของผู้พักร่วม", partyRange(other)),
        row("สิ่งที่ควรทราบ", ROOM_SHARE_HOST_NOTICE_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "RoomShareGuestCancelled": {
      const subject = `คำขอถูกยกเลิกตามคำขอที่พักห้องร่วม ${no}`;
      const rows = [
        row("เลขที่", no),
        row("วันเดินทาง", partyRange(me)),
        row("สถานที่ปฏิบัติงาน", me.workLocation ?? "-"),
        row("สถานะเดิม", input.previousStatus ?? "-"),
        row("คำขอที่พักห้องร่วม", counterpartLabel(other)),
        row("สิ่งที่ต้องทำ", ROOM_SHARE_GUEST_CANCELLED_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "RoomShareGuestRedated": {
      const subject = `วันเดินทางเปลี่ยนตามคำขอที่พักห้องร่วม ${no}`;
      const before = input.previousDates;
      const rows = [
        row("เลขที่", no),
        // Both ranges, because the point of this mail is the CHANGE — the same
        // reason the `dates_followed_room_share_host` activity row records both.
        row("วันเดินทางเดิม", before ? `${before.depart} – ${before.return}` : "-"),
        row("วันเดินทางใหม่", partyRange(me)),
        row("สถานที่ปฏิบัติงาน", me.workLocation ?? "-"),
        row("คำขอที่พักห้องร่วม", counterpartLabel(other)),
        row("สิ่งที่ต้องทำ", ROOM_SHARE_GUEST_REDATED_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "RoomShareAccountingCancelled": {
      const subject = `[บัญชี] ยกเลิกคำขอที่ผ่านบัญชีแล้ว ${no}`;
      const rows = [
        row("เลขที่", no),
        // `ผู้ขอ` IS wanted here, and it is not the row package A removed: that
        // one was dropped from mails sent TO the requester, where it told
        // somebody their own name. This goes to accounting, who have to know
        // whose claim it is.
        row("ผู้ขอ", me.personName ?? "-"),
        row("วันเดินทาง", partyRange(me)),
        row("เบี้ยเลี้ยงที่คำนวณไว้", partyPerDiem(me)),
        row("สถานะเดิม", input.previousStatus ?? "-"),
        row("คำขอที่พักห้องร่วม", counterpartLabel(other)),
        row("สิ่งที่ต้องตรวจสอบ", ROOM_SHARE_ACCOUNTING_CANCELLED_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }

    case "RoomShareAccountingRedated": {
      const subject = `[บัญชี] วันเดินทางเปลี่ยนหลังผ่านบัญชีแล้ว ${no}`;
      const before = input.previousDates;
      const rows = [
        row("เลขที่", no),
        row("ผู้ขอ", me.personName ?? "-"),
        row("วันเดินทางเดิม", before ? `${before.depart} – ${before.return}` : "-"),
        row("วันเดินทางใหม่", partyRange(me)),
        // The figure that did NOT move, printed beside the dates that did —
        // which is the whole discrepancy this mail exists to report.
        row("เบี้ยเลี้ยงที่อนุมัติไว้ (ไม่ถูกแก้ไข)", partyPerDiem(me)),
        row("คำขอที่พักห้องร่วม", counterpartLabel(other)),
        row("สิ่งที่ต้องตรวจสอบ", ROOM_SHARE_ACCOUNTING_REDATED_TEXT),
      ].join("");
      return { subject, html: shell(subject, rows, url) };
    }
  }
}
