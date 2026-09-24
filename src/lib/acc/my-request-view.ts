import type { ReportRow } from "@/lib/acc/report-service";

/**
 * **The table view of My Requests and My Work — which columns exist, which are
 * on by default, and what each cell says.**
 *
 * Pure and import-free apart from a type, for the reason every rule in this
 * repository that matters is: `report-service.ts` reaches `@/env` through a
 * pool and throws at import, so nothing that lives beside it can be unit
 * tested. The panel is a client component, so a rule written inline in it could
 * not be tested either.
 *
 * ## One definition, two pages
 *
 * `/my-request` and `/my-work` render the same component with `kind="mine"` and
 * `kind="work"`, so the column list is shared and `kinds` narrows the few that
 * belong to one of them. A column absent from a page is absent from its picker
 * too — offering "ผู้ขอเบิก" on a list where every row is the reader's own is
 * offering a column of one repeated name.
 *
 * ## Why the cell text is HERE and not in the table component
 *
 * The Excel export must say exactly what the screen says. Two renderers
 * drift — the report this app already has learned that the expensive way — so
 * `cellText()` is the single answer and the table renders its output, styling
 * it rather than recomputing it. The few cells that carry a badge (status,
 * PRO/UAT) still read their text from here.
 */

/** Every column the table can show. */
export type MyRequestColKey =
  | "requestNo"
  | "formCode"
  | "formName"
  | "brandCode"
  | "requesterName"
  | "requesterDepartment"
  | "status"
  | "pendingBy"
  | "currentStep"
  | "submittedAt"
  | "daysPending"
  | "managerApprovedAt"
  | "managerTurnaround"
  | "accountApprovedAt"
  | "paymentDate"
  | "daysUntilPayment"
  | "totalAmount"
  | "currency"
  | "foreignAmount"
  | "exchangeRate"
  | "rateAsOf"
  | "travelDate"
  | "dayCount"
  | "totalDistanceKm"
  | "vehicleNames"
  | "workDetail"
  | "environment";

export type MyRequestKind = "mine" | "work";

export interface MyRequestColumn {
  key: MyRequestColKey;
  label: string;
  align?: "right";
  /** Absent means both pages. */
  kinds?: readonly MyRequestKind[];
}

/**
 * Declaration order is also the picker's order and the table's default order.
 *
 * Grouped by the question each answers: what is it, who owns it, where is it,
 * when did it move, what is it worth, what was the trip.
 */
export const MY_REQUEST_COLUMNS: readonly MyRequestColumn[] = [
  { key: "requestNo", label: "เลขที่คำขอ" },
  { key: "formCode", label: "ฟอร์ม" },
  { key: "formName", label: "ชื่อฟอร์ม" },
  { key: "brandCode", label: "แบรนด์" },
  { key: "requesterName", label: "ผู้ขอเบิก", kinds: ["work"] },
  { key: "requesterDepartment", label: "แผนก", kinds: ["work"] },
  { key: "status", label: "สถานะ" },
  { key: "pendingBy", label: "รออนุมัติโดย" },
  { key: "currentStep", label: "ขั้นตอนปัจจุบัน" },
  { key: "submittedAt", label: "วันที่ส่ง" },
  { key: "daysPending", label: "ค้างมา (วัน)", align: "right" },
  { key: "managerApprovedAt", label: "ผู้จัดการอนุมัติ" },
  { key: "managerTurnaround", label: "ผู้จัดการใช้เวลา (วัน)", align: "right" },
  { key: "accountApprovedAt", label: "บัญชีอนุมัติ" },
  { key: "paymentDate", label: "วันที่จ่าย" },
  { key: "daysUntilPayment", label: "อีก/เลยมา (วัน)", align: "right" },
  { key: "totalAmount", label: "ยอดรวม (บาท)", align: "right" },
  { key: "currency", label: "สกุลเงิน" },
  { key: "foreignAmount", label: "ยอดสกุลต่างประเทศ", align: "right" },
  { key: "exchangeRate", label: "อัตราแลกเปลี่ยน", align: "right" },
  { key: "rateAsOf", label: "เรตของวันที่" },
  { key: "travelDate", label: "วันเดินทาง" },
  { key: "dayCount", label: "จำนวนวัน", align: "right" },
  { key: "totalDistanceKm", label: "ระยะทาง (กม.)", align: "right" },
  { key: "vehicleNames", label: "ยานพาหนะ" },
  { key: "workDetail", label: "รายละเอียดงาน" },
  { key: "environment", label: "PRO/UAT" },
];

/** The columns offered on one page, in declaration order. */
export function columnsForKind(kind: MyRequestKind): MyRequestColumn[] {
  return MY_REQUEST_COLUMNS.filter((c) => !c.kinds || c.kinds.indexOf(kind) !== -1);
}

/**
 * What a page opens on.
 *
 * Deliberately short on both — a table of twenty-seven columns is a table
 * nobody reads, and the picker is one click away. The two differ on the
 * question each page is for: **คำขอของฉัน** is "where has my money got to", so
 * it leads with the money and the payment date; **งานของฉัน** is "what is
 * waiting for me", so it leads with who filed it and how long it has sat.
 */
export function defaultVisibleKeys(kind: MyRequestKind): MyRequestColKey[] {
  return kind === "work"
    ? [
        "requestNo",
        "formCode",
        "requesterName",
        "status",
        "pendingBy",
        "submittedAt",
        "daysPending",
        "totalAmount",
      ]
    : [
        "requestNo",
        "formCode",
        "brandCode",
        "status",
        "pendingBy",
        "submittedAt",
        "managerApprovedAt",
        "totalAmount",
        "paymentDate",
      ];
}

/* ------------------------------------------------------------------ *
 * Derived day counts — computed here rather than fetched.
 * ------------------------------------------------------------------ */

/**
 * A request is still moving when nothing terminal has happened to it.
 *
 * An **allow-list of the terminal statuses** rather than a list of the live
 * ones, deliberately and in the opposite direction to `perdiem-window.ts`: a
 * status this module has never heard of is far more likely to be a new stage
 * than a new ending, and counting a live claim's age is harmless where
 * counting a finished one's is a column that climbs forever.
 */
const SETTLED = ["Approved", "Rejected", "Cancelled", "Completed"];

export function isSettled(status: string | null | undefined): boolean {
  return SETTLED.indexOf((status ?? "").trim()) !== -1;
}

/**
 * Whole days between two instants, by **calendar date** rather than by 24-hour
 * blocks.
 *
 * Filing at 23:00 and reading the list at 01:00 is *one day ago*, which is what
 * anybody looking at the column means; an elapsed-hours count would answer 0
 * and then flip to 1 in the middle of the following night. Same argument
 * `earliest-travel-date.ts` makes for AP-17's departure rule.
 */
export function daysBetween(fromIso: string | null | undefined, toIso: string): number | null {
  if (!fromIso) return null;
  const from = new Date(fromIso);
  const to = new Date(toIso);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** How long this request has been waiting. Null once it has settled. */
export function daysPending(row: ReportRow, nowIso: string): number | null {
  if (isSettled(row.status)) return null;
  return daysBetween(row.submittedAt, nowIso);
}

/** Submit → manager approval. Null until the manager has acted. */
export function managerTurnaroundDays(row: ReportRow): number | null {
  if (!row.managerApprovedAt) return null;
  return daysBetween(row.submittedAt, row.managerApprovedAt);
}

/**
 * Days until the payment date — **negative once it has passed**.
 *
 * The sign is the information: `-3` on an unsettled claim is a payment date
 * three days gone, which is the row somebody needs to look at. Rendering it as
 * an unsigned "3" would make it indistinguishable from a payment due in three
 * days, so `cellText` spells both out in words.
 */
export function daysUntilPayment(row: ReportRow, nowIso: string): number | null {
  if (!row.paymentDate) return null;
  return daysBetween(nowIso, row.paymentDate);
}

/* ------------------------------------------------------------------ *
 * Cell text
 * ------------------------------------------------------------------ */

const BLANK = "—";

function money(n: number | null | undefined): string {
  if (n == null) return BLANK;
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * `YYYY-MM-DD` → `DD/MM/YYYY`, and an ISO instant likewise.
 *
 * **Local getters throughout, never `toISOString()`.** Every timestamp in these
 * databases is a Thai wall clock and the driver runs `useUTC: false`, so the
 * date parts are already right — re-serialising through UTC is the seven-hour
 * shift CLAUDE.md's Dates section exists to stop.
 */
export function fmtDate(raw: string | null | undefined): string {
  if (!raw) return BLANK;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return BLANK;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** The Thai label for a pending step, matching `approval-display.ts`'s vocabulary. */
const STEP_LABEL: Record<string, string> = {
  MANAGER: "ผู้จัดการ",
  ACCOUNT: "บัญชี",
  ACCOUNT_FINAL: "บัญชี (ขั้นสุดท้าย)",
  ADMIN: "Admin จอง",
  HEAD_ACC: "หัวหน้าบัญชี",
  DIRECTOR: "ผู้บริหาร",
  ACC_OFFICER: "เจ้าหน้าที่บัญชี",
  HEAD: "หัวหน้า",
};

export function stepLabel(code: string | null | undefined): string {
  const key = (code ?? "").trim();
  if (!key) return BLANK;
  return STEP_LABEL[key] ?? key;
}

/**
 * One cell, as text — the same string the screen shows and the export writes.
 *
 * `now` is passed rather than read, so the three day-count columns are testable
 * at a fixed instant and so every row of one render measures against one clock
 * rather than each against its own `Date.now()`.
 */
export function cellText(row: ReportRow, key: MyRequestColKey, nowIso: string): string {
  switch (key) {
    case "requestNo":
      return row.requestNo ?? BLANK;
    case "formCode":
      return row.formCode || BLANK;
    case "formName":
      return row.formName ?? BLANK;
    case "brandCode":
      return row.brandCode ?? BLANK;
    case "requesterName":
      return row.requesterFullName ?? BLANK;
    case "requesterDepartment":
      return row.requesterDepartmentName ?? BLANK;
    case "status":
      return row.status || BLANK;
    case "pendingBy": {
      // The step AND who holds it: "บัญชี" alone does not say whether anybody
      // in particular is sitting on it, and a bare name does not say what they
      // are being asked to do. Both accounting steps are assigned to a pool
      // rather than a person, which is why the name is often absent and the
      // step is what remains.
      if (isSettled(row.status)) return BLANK;
      const step = row.pendingStepCode ?? row.currentStepCode ?? null;
      const who = row.pendingApproverName?.trim() || row.pendingApproverEmail?.trim() || "";
      if (!step && !who) return BLANK;
      if (!who) return stepLabel(step);
      if (!step) return who;
      return `${stepLabel(step)} · ${who}`;
    }
    case "currentStep":
      return stepLabel(row.currentStepCode);
    case "submittedAt":
      return fmtDate(row.submittedAt);
    case "daysPending": {
      const d = daysPending(row, nowIso);
      return d == null ? BLANK : String(d);
    }
    case "managerApprovedAt":
      return fmtDate(row.managerApprovedAt);
    case "managerTurnaround": {
      const d = managerTurnaroundDays(row);
      return d == null ? BLANK : String(d);
    }
    case "accountApprovedAt":
      return fmtDate(row.accountApprovedAt);
    case "paymentDate":
      return fmtDate(row.paymentDate);
    case "daysUntilPayment": {
      const d = daysUntilPayment(row, nowIso);
      if (d == null) return BLANK;
      if (d === 0) return "วันนี้";
      // Spelled out rather than signed: "-3" beside "3" in a column of numbers
      // reads as a minus sign somebody might miss, and the two mean opposite
      // things to whoever is chasing a payment.
      return d > 0 ? `อีก ${d}` : `เลยมา ${Math.abs(d)}`;
    }
    case "totalAmount":
      return money(row.totalAmount);
    case "currency":
      // Null and "THB" both mean baht (`currency.ts`), and a baht claim leaves
      // it null — so the column answers THB rather than a dash, which would
      // read as "nobody knows what this is denominated in".
      return (row.currency ?? "").trim() || "THB";
    case "foreignAmount":
      return row.foreignAmount == null ? BLANK : money(row.foreignAmount);
    case "exchangeRate":
      return row.exchangeRate == null ? BLANK : String(row.exchangeRate);
    case "rateAsOf":
      return fmtDate(row.rateAsOf);
    case "travelDate": {
      // A range when the claim spans days, one date when it does not, and
      // nothing at all on a form that has no journey — the list already
      // follows this rule, because an AP-2 row printing "เดินทาง —" labelled
      // an empty dash as a trip that never happened.
      if (!row.travelDate) return BLANK;
      const from = fmtDate(row.travelDate);
      const to = row.travelDateTo ? fmtDate(row.travelDateTo) : null;
      return !to || to === from ? from : `${from} – ${to}`;
    }
    case "dayCount":
      return row.dayCount ? String(row.dayCount) : BLANK;
    case "totalDistanceKm":
      return row.totalDistanceKm == null ? BLANK : money(row.totalDistanceKm);
    case "vehicleNames": {
      const list = row.vehicleNames?.length ? row.vehicleNames : null;
      if (list) return list.join(", ");
      return row.vehicleName ?? BLANK;
    }
    case "workDetail":
      return row.workDetail ?? BLANK;
    case "environment":
      return row.environment ?? "Production";
  }
}

/**
 * The value the EXPORT writes, which is not always the text the screen shows.
 *
 * A date column reaches Excel as `DD/MM/YYYY` text on purpose rather than as a
 * serial: this app's timestamps are Thai wall clocks, and handing a `Date` to
 * `xlsx-js-style` re-interprets it against the reader's own timezone, which is
 * the seven-hour shift this codebase has already fixed once. A **number**,
 * though, must arrive as a number or the column cannot be summed — which is the
 * first thing anybody does with ยอดรวม.
 */
export function cellExportValue(
  row: ReportRow,
  key: MyRequestColKey,
  nowIso: string,
): string | number {
  switch (key) {
    case "totalAmount":
      return row.totalAmount ?? "";
    case "foreignAmount":
      return row.foreignAmount ?? "";
    case "exchangeRate":
      return row.exchangeRate ?? "";
    case "totalDistanceKm":
      return row.totalDistanceKm ?? "";
    case "dayCount":
      return row.dayCount ?? "";
    case "daysPending":
      return daysPending(row, nowIso) ?? "";
    case "managerTurnaround":
      return managerTurnaroundDays(row) ?? "";
    case "daysUntilPayment":
      // The signed number, not the Thai phrase: a spreadsheet sorts and filters
      // on it, and "เลยมา 3" sorts beside "อีก 3" alphabetically.
      return daysUntilPayment(row, nowIso) ?? "";
    default: {
      const text = cellText(row, key, nowIso);
      return text === BLANK ? "" : text;
    }
  }
}
