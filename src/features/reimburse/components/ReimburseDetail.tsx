"use client";

import React, { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import {
  Ban,
  CheckCircle,
  Clock,
  FileCheck,
  FileSpreadsheet,
  FileText,
  ImageIcon,
  Info,
  ListChecks,
  Mail,
  Download,
  Paperclip,
  Receipt,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  User,
  XCircle,
} from "lucide-react";
import {
  AttachmentViewer,
  attachmentKind,
  type AttachmentKind,
  type AttachmentSource,
} from "./AttachmentViewer";
import { Dialog } from "@/components/ui";
import { Avatar } from "@/components/ui/Avatar";
import { UatDataBanner } from "@/components/UatDataBanner";
import { getBrandById } from "@/lib/brand";
import { statusLabelDisplay } from "@/features/accounting/constants";
import { PaymentDatePicker } from "@/features/accounting/components/PaymentDatePicker";
import { fmtBaht } from "@/features/travel-booking/components/shared";
import { sumReimburseItems } from "@/lib/acc/reimburse/calc";
import {
  REIMBURSE_STEP_CODES,
  REIMBURSE_STEP_LABEL,
  type ReimburseStepCode,
} from "@/features/reimburse/constants";
// Type-only: `approval-policy` imports `./payment-calendar`, which reaches the
// holiday lookup through a dynamic import — a runtime import here would pull
// `@/lib/db/mssql` and `@/env` into the browser bundle.
import type { ReimburseApprovalContext } from "@/lib/acc/reimburse/approval-policy";
import type {
  ReimburseApproval,
  ReimburseDetail as ReimburseDetailData,
  ReimburseFileMeta,
  ReimburseRule,
} from "@/features/reimburse/types";

/**
 * AP-4 detail — the request as it stands, its approval timeline, and the one
 * action the viewer may take on it.
 *
 * The action bar is drawn from `/api/request/reimburse/requests/[id]/approval-context`
 * and nothing else. Whether somebody is on `AccReimburseApprover`, which payment
 * rounds exist (they need `Rocks_Codex.Holiday`), and whether the two-person rule
 * lets this person take the final step are all server facts; asking the server
 * once is both the only way to know them and the only honest way to draw them.
 * The buttons are a convenience — every one of those answers is recomputed by
 * the approve / reject routes before anything is written.
 *
 * Laid out like AP-1's `RequestDetail` so the two forms read the same.
 */

/* ─────────────────────────── helpers ─────────────────────────── */

/** Local getters throughout — the server runs on Thai time and `toISOString` would shift the day. */
function fmtDateTime(raw: string | null | undefined): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()} ${hh}:${mi}`;
}

function fmtDateOnly(raw: string | null | undefined): string {
  if (!raw) return "—";
  // A YYYY-MM-DD from the server is already local-calendar text; parsing it
  // through Date would reinterpret it as UTC midnight.
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (ymd) return `${ymd[3]}/${ymd[2]}/${ymd[1]}`;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** The shared `fmtBaht`, plus the em-dash this page wants for an absent figure. */
function fmtMoney(n: number | null | undefined): string {
  if (n == null) return "—";
  return fmtBaht(n);
}

/**
 * What to show for an error the action routes returned.
 *
 * Their named refusals are Thai and worth showing as-is — "the request already
 * moved", "you are the same person who checked it". The generic ones are not:
 * `not found` and `Internal server error` are the framework's English and reach
 * a Thai UI as a toast the reader cannot act on.
 */
const ACTION_ERROR_TH: Record<string, string> = {
  "not found": "ไม่พบคำขอนี้ — อาจถูกลบหรือเปลี่ยนสถานะไปแล้ว กรุณาโหลดหน้านี้ใหม่",
  "Invalid id": "เลขที่คำขอไม่ถูกต้อง",
  "Internal server error": "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่อีกครั้ง",
};

function actionErrorMessage(raw: string | null | undefined): string {
  const msg = raw?.trim();
  if (!msg) return "ดำเนินการไม่สำเร็จ";
  const named = ACTION_ERROR_TH[msg];
  if (named) return named;
  // No Thai in it at all means it did not come from one of the named refusals
  // this page exists to relay.
  if (!/[\u0E00-\u0E7F]/.test(msg)) return "ดำเนินการไม่สำเร็จ — กรุณาโหลดหน้านี้ใหม่";
  return msg;
}

async function jsonFetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "Request failed");
  return json.data as T;
}

/**
 * AP-4's three steps — the shared two-step vocabulary plus `ACCOUNT_FINAL`
 * (migration 091), read from the one declaration My Work reads too.
 *
 * The two used to hold separate copies and had already drifted: this page said
 * "บัญชี (อนุมัติขั้นสุดท้าย)" where `approval-display.ts` said
 * "บัญชี (ขั้นสุดท้าย)", to the same approver about the same request.
 */
const STEP_LABEL = REIMBURSE_STEP_LABEL;

/**
 * The chain the request will walk, in order — the timeline's skeleton.
 *
 * `AccApproval` rows are opened one step at a time, so drawing only the rows
 * that exist shows all three steps only once the request has reached the last
 * of them. The brief asks for the three steps; the rows are overlaid onto this.
 *
 * `REIMBURSE_STEP_CODES` rather than a fourth hand-written `["MANAGER",
 * "ACCOUNT", "ACCOUNT_FINAL"]`. It cannot be `approval-policy`'s `STEP_ORDER`,
 * which is the authority on the `StepOrder` column: that module may only be
 * imported as a **type** from here (see the import above), and `STEP_ORDER` is
 * a value. `@/features/reimburse/constants` imports nothing at all, so it is
 * safe from the browser, and `approval-policy.test.ts` asserts that `STEP_ORDER`
 * agrees with this array's order — which is what makes reading the sequence off
 * it a checked fact rather than a coincidence.
 */
const STEP_SEQUENCE: readonly ReimburseStepCode[] = REIMBURSE_STEP_CODES;

/**
 * What approving is called at each step. The accounting check is not simply "an
 * approval" — it is where the payment date is fixed, and the button says so.
 */
const APPROVE_LABEL: Record<ReimburseStepCode, string> = {
  MANAGER: "อนุมัติ",
  ACCOUNT: "ตรวจสอบและกำหนดวันที่จ่าย",
  ACCOUNT_FINAL: "อนุมัติขั้นสุดท้าย",
};

const APPROVE_DONE_LABEL: Record<ReimburseStepCode, string> = {
  MANAGER: "อนุมัติแล้ว",
  ACCOUNT: "บันทึกการตรวจสอบแล้ว",
  ACCOUNT_FINAL: "อนุมัติขั้นสุดท้ายแล้ว",
};

/** AP-4's rounds, not AP-1's — see `src/lib/acc/reimburse/payment-calendar.ts`. */
const AP4_ROUNDS_HINT = "วันจ่าย: ศุกร์ที่ 1 และ 3 ของเดือน (เลื่อนกลับ 1 วันถ้าตรงวันหยุด)";

function approvalActorLabel(a: ReimburseApproval): string | null {
  if (a.status === "Pending") {
    if (!a.assignedEmail && a.assignedTo == null) return "ฝ่ายบัญชี";
    const name = a.assignedToHrName?.trim();
    if (name && a.assignedTo != null) return `${name} · StaffId ${a.assignedTo}`;
    if (name) return name;
    if (a.assignedTo != null) return `StaffId ${a.assignedTo}`;
    return a.assignedEmail;
  }
  const name = a.actionedByHrName?.trim();
  const email = a.actionedByHrEmail ?? a.assignedEmail;
  if (name && a.actionedByStaffId != null) return `${name} · StaffId ${a.actionedByStaffId}`;
  if (name && email) return `${name} (${email})`;
  if (name) return name;
  if (a.actionedByStaffId != null) return `StaffId ${a.actionedByStaffId}`;
  return email ?? null;
}

/**
 * `withdrawn` is the request being `Cancelled`, not the row saying so.
 *
 * A self-cancel closes the pending `MANAGER` row as `Returned`, because
 * `CK_AccApproval_Status` has no `Cancelled` — see `cancelReimburseByRequester`.
 * Left unqualified the timeline would then say the requester "ส่งกลับ" their own
 * claim for editing, which is the one thing a cancel is not.
 */
function approvalActorPrefix(status: ReimburseApproval["status"], withdrawn = false): string {
  if (status === "Approved") return "อนุมัติโดย";
  if (status === "Rejected") return "ไม่อนุมัติโดย";
  if (status === "Returned") return withdrawn ? "ยกเลิกโดย" : "ส่งกลับโดย";
  return "รอดำเนินการโดย";
}

function isImageFile(f: ReimburseFileMeta): boolean {
  if (f.contentType?.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif)$/i.test(f.fileName);
}

/* ─────────────────────────── small pieces ─────────────────────────── */

function ApprovalStatusBadge({
  status,
  withdrawn = false,
}: {
  status: ReimburseApproval["status"];
  withdrawn?: boolean;
}) {
  const cfg: Record<
    ReimburseApproval["status"],
    { label: string; icon: React.ReactNode; bg: string; text: string; border: string }
  > = {
    Pending: {
      label: "รออนุมัติ",
      icon: <Clock size={12} />,
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
    Approved: {
      label: "อนุมัติแล้ว",
      icon: <CheckCircle size={12} />,
      bg: "var(--bg-info-green)",
      text: "var(--text-info-green)",
      border: "var(--border-info-green)",
    },
    Rejected: {
      label: "ไม่อนุมัติ",
      icon: <XCircle size={12} />,
      bg: "var(--status-bad-bg)",
      text: "var(--status-bad-text)",
      border: "var(--status-bad-bg)",
    },
    Returned: {
      label: "ส่งกลับแก้ไข",
      icon: <RotateCcw size={12} />,
      bg: "var(--bg-info-yellow)",
      text: "var(--text-info-yellow)",
      border: "var(--border-info-yellow)",
    },
  };
  // Same colours, honest wording — see `approvalActorPrefix`.
  const base = cfg[status];
  const c =
    withdrawn && status === "Returned"
      ? { ...base, label: "ยกเลิกโดยผู้ขอ", icon: <Ban size={12} /> }
      : base;
  return (
    <span
      className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {c.icon}
      {c.label}
    </span>
  );
}

function RequestStatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    Draft: { bg: "var(--status-draft-bg)", text: "var(--status-draft-text)" },
    Submitted: { bg: "var(--status-pending-bg)", text: "var(--status-pending-text)" },
    ManagerApproved: { bg: "var(--status-pending-bg)", text: "var(--status-pending-text)" },
    Approved: { bg: "var(--status-ok-bg)", text: "var(--status-ok-text)" },
    Rejected: { bg: "var(--status-bad-bg)", text: "var(--status-bad-text)" },
    Returned: { bg: "var(--status-draft-bg)", text: "var(--status-draft-text)" },
    Cancelled: { bg: "var(--bg-badge)", text: "var(--text-faint)" },
  };
  const c = map[status] ?? map.Draft;
  return (
    <span
      className="inline-flex items-center text-[11px] font-medium px-2.5 py-1 rounded-full"
      style={{ background: c.bg, color: c.text }}
    >
      {statusLabelDisplay(status)}
    </span>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-2xl overflow-hidden mb-4"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        className="flex items-center gap-2.5 px-5 py-3"
        style={{ borderBottom: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
      >
        {icon && (
          <span
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
          >
            {icon}
          </span>
        )}
        <h2 className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
          {title}
        </h2>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-baseline gap-0.5 sm:gap-2">
      <span className="text-[11px] font-medium shrink-0 sm:w-36" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
      <span className="text-[13px] min-w-0" style={{ color: "var(--text-primary)" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

/**
 * One attachment row: the name opens it in the viewer, the icon downloads it.
 *
 * This is the surface the three approvers actually read a claim on, and until
 * now every file here — receipt, tax invoice, workbook — was a bare download
 * link, so checking one meant leaving the page and opening whatever the desktop
 * associates with `.pdf`. The download stays, because approving is not the only
 * reason to want the file.
 */
function FileLink({ file, onView }: { file: ReimburseFileMeta; onView: () => void }) {
  const image = isImageFile(file);
  return (
    <div
      className="flex items-center gap-2.5 rounded-lg px-3 py-2 min-w-0"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      <span className="shrink-0" style={{ color: "var(--nav-active-text)" }}>
        {image ? <ImageIcon size={16} /> : <FileText size={16} />}
      </span>
      <button
        type="button"
        onClick={onView}
        className="flex-1 min-w-0 text-left text-[12.5px] font-semibold truncate cursor-zoom-in border-none bg-transparent p-0"
        style={{ color: "var(--text-primary)" }}
        title={file.fileName}
      >
        {file.fileName}
      </button>
      <a
        href={file.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`ดาวน์โหลด ${file.fileName}`}
        title="ดาวน์โหลด"
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center no-underline"
        style={{ background: "var(--bg-card)", color: "var(--text-muted)" }}
      >
        <Download size={14} />
      </a>
    </div>
  );
}

/* ─────────────────────────── main ─────────────────────────── */

export function ReimburseDetail({
  request,
  onChanged,
}: {
  request: ReimburseDetailData;
  /** Called after an approval or a rejection lands, so the page can re-read it. */
  onChanged?: () => void;
}) {
  // Rule text for the ids this request acknowledged. Only active rules are
  // listed, so a rule retired since the acknowledgement shows as a count
  // rather than silently disappearing from the total.
  const { data: rulesData } = useSWR<ReimburseRule[]>(
    "/api/request/reimburse/settings/rules",
    jsonFetcher,
    { revalidateOnFocus: false },
  );
  const rules = rulesData ?? [];
  const ackedSet = new Set(request.ackedRuleIds);
  const ackedRules = rules.filter((r) => ackedSet.has(r.id));

  // What the attachment viewer is showing. Stored files only here — nothing on
  // this page is unsaved.
  const [viewing, setViewing] = useState<{ source: AttachmentSource; kind: AttachmentKind } | null>(
    null,
  );
  const viewFile = (f: ReimburseFileMeta) =>
    setViewing({
      source: { name: f.fileName, url: f.url },
      kind: attachmentKind(f.fileName, f.contentType),
    });

  const brand = getBrandById(request.brandCode);
  // Recomputed from the items on screen, with the server's own function, so the
  // figure below the table cannot drift from the stored header total.
  const itemsTotal = sumReimburseItems(request.items);
  const approvals = (request.approvals ?? []).slice().sort((a, b) => a.stepOrder - b.stepOrder);
  // The three steps in order, each carrying its row if one has been opened yet.
  // A step with no row is still drawn — greyed, with no actor — so the chain the
  // request has to walk is visible from the first approval rather than only
  // after the last one.
  // A rejection ends the request, so its unopened steps were not "not yet" —
  // they will never happen, and saying otherwise reads as a stuck workflow.
  const chainStopped = request.status === "Rejected" || request.status === "Cancelled";
  const withdrawn = request.status === "Cancelled";
  const timeline: { key: string; stepCode: ReimburseStepCode; approval: ReimburseApproval | null }[] = [];
  for (const code of STEP_SEQUENCE) {
    const rows = approvals.filter((a) => a.stepCode === code);
    if (rows.length === 0) {
      timeline.push({ key: `step-${code}`, stepCode: code, approval: null });
    } else {
      for (const a of rows) timeline.push({ key: `row-${a.id}`, stepCode: code, approval: a });
    }
  }

  /* ── What this viewer may do, answered by the server ── */

  const [ctx, setCtx] = useState<ReimburseApprovalContext | null>(null);
  /**
   * The context fetch failed, as opposed to having answered "you may not act".
   *
   * Without this the two are the same picture. A 500 from `approval-context`
   * leaves `ctx` null, so `canAct` is false *and* `ctx?.reason` is empty, and an
   * approver who is entitled to act sees an approval section with no buttons and
   * no explanation — the exact "a missing button reads as a bug" case that
   * route's own `finalStepRefusal` reasoning exists to avoid.
   */
  const [ctxFailed, setCtxFailed] = useState(false);
  const [action, setAction] = useState<"approve" | "reject" | "return" | null>(null);
  const [comment, setComment] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  // Bumped when an action is refused. The payment rounds expire on a clock the
  // page does not watch — a round drops out of `getReimbursePaymentDates` once
  // its cut-off passes — so a refusal is the one moment the answers on screen
  // are known to be out of date, and `request` has not changed to trigger the
  // refetch below.
  const [ctxNonce, setCtxNonce] = useState(0);

  // Re-asked whenever the request moves, not just on mount: after an approval
  // the step has changed and the previous answer describes a step that is over.
  useEffect(() => {
    let cancelled = false;
    setCtx(null);
    setCtxFailed(false);
    fetch(`/api/request/reimburse/requests/${request.id}/approval-context`)
      .then((r) => r.json())
      .then((json: { ok: boolean; data?: ReimburseApprovalContext }) => {
        if (cancelled) return;
        if (json.ok && json.data) setCtx(json.data);
        else setCtxFailed(true);
      })
      .catch(() => {
        if (!cancelled) setCtxFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [request.id, request.currentStepCode, request.status, request.updatedAt, ctxNonce]);

  // The picker opens on the round the server chose with `defaultPaymentRound`,
  // and the approver may pick any other valid round instead (spec §3.4).
  useEffect(() => {
    setPaymentDate(ctx?.defaultPaymentDate ?? "");
  }, [ctx?.defaultPaymentDate]);

  const step = ctx?.step ?? null;
  const canAct = !!ctx?.canAct && step != null;
  const needsPaymentDate = step === "ACCOUNT";

  /**
   * The requester's own withdrawal window, as the **server** answered it.
   *
   * Not recomputed here from `submittedAt`: the deadline is a statement about
   * the server's clock, and AP-1's detail page evaluating
   * `Date.now() - new Date(submittedAt) <= 24 * 3600 * 1000` in the browser is a
   * second copy of the rule that a wrong machine clock quietly disagrees with.
   * `selfCancel` is null for anyone who did not file this request.
   */
  const selfCancel = ctx?.selfCancel ?? null;

  const closeDialog = useCallback(() => {
    setAction(null);
    setComment("");
  }, []);

  /** The two comment-carrying actions, and what each dialog is called. */
  const NEEDS_COMMENT: Record<"reject" | "return", string> = {
    reject: "กรุณาระบุเหตุผลที่ไม่อนุมัติ",
    return: "กรุณาระบุสิ่งที่ต้องแก้ไข",
  };

  async function submitAction(kind: "approve" | "reject" | "return") {
    if (!step) return;
    if (kind !== "approve" && !comment.trim()) {
      toast.error(NEEDS_COMMENT[kind]);
      return;
    }
    if (kind === "approve" && needsPaymentDate && !paymentDate) {
      toast.error("กรุณาเลือกวันที่จ่าย");
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/request/reimburse/requests/${request.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `step` is an optimistic-concurrency token, not an instruction: the
        // route dispatches on the record's own step and 409s when this does not
        // match it. Without it a tab left open at the accounting check while
        // somebody else performs that check will, on the next click, take the
        // final approval instead — the step that authorises payment — and say
        // "บันทึกการตรวจสอบแล้ว" while doing it. The return route carries the
        // same token for the same reason.
        body: JSON.stringify(
          kind === "approve"
            ? { step, paymentDate: needsPaymentDate ? paymentDate : undefined }
            : { step, comment: comment.trim() },
        ),
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (json.ok) {
        toast.success(
          kind === "approve"
            ? APPROVE_DONE_LABEL[step]
            : kind === "return"
              ? "ส่งกลับให้ผู้ขอแก้ไขแล้ว"
              : "ไม่อนุมัติแล้ว",
        );
        closeDialog();
        onChanged?.();
      } else {
        // The route's named refusals are Thai and shown as-is; the framework's
        // English ones are translated. Either way the context is re-asked: what
        // the page is offering is now known to be stale.
        toast.error(actionErrorMessage(json.error));
        setCtxNonce((n) => n + 1);
        // …and so is the record behind it. `ctxNonce` only refetched the action
        // bar, so after a 409 the buttons corrected themselves while the
        // timeline underneath still showed the step somebody else had already
        // taken — the page then disagreed with itself about where the request
        // was. `onChanged` re-runs the page's own fetch; it does not close the
        // dialog (only a success does that), so the reason stays on screen.
        onChanged?.();
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The requester withdraws their own claim.
   *
   * No body and no step token: there is one state this is possible from, and the
   * server claims it. A refusal is shown as sent — the three reasons a cancel
   * can fail each name their own remedy, and flattening them into
   * "ยกเลิกไม่สำเร็จ" is what leaves the requester unable to tell waiting from
   * asking the manager.
   */
  async function handleCancel() {
    setBusy(true);
    try {
      const res = await fetch(`/api/request/reimburse/requests/${request.id}/cancel`, {
        method: "POST",
      });
      const json: { ok: boolean; error?: string } = await res.json();
      if (json.ok) {
        toast.success("ยกเลิกคำขอแล้ว");
        setCancelOpen(false);
        onChanged?.();
      } else {
        toast.error(actionErrorMessage(json.error));
        setCtxNonce((n) => n + 1);
        onChanged?.();
      }
    } catch {
      toast.error("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <UatDataBanner requestId={request.id} />

      {/* ── ยกเลิกคำขอ — the requester's own 24-hour window (spec §5.3) ──
          Drawn only for the person who filed it: `selfCancel` is null for
          everyone else, so a manager or an approver never sees the bar at all.
          Whether the window is still open, and when it shuts, are both the
          server's answers — see `selfCancel` above. */}
      {request.status === "Submitted" && selfCancel && (
        <div
          className="rounded-2xl p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-card)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div className="flex items-start gap-2.5 min-w-0">
            <Ban size={16} style={{ color: "var(--color-danger)", marginTop: 2 }} className="shrink-0" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-heading)" }}>
                ยกเลิกคำขอ
              </p>
              <p className="text-[11px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
                {selfCancel.allowed
                  ? selfCancel.until
                    ? `ยกเลิกเองได้ถึง ${fmtDateTime(selfCancel.until)} และก่อนผู้จัดการอนุมัติ`
                    : "ยกเลิกเองได้ก่อนผู้จัดการอนุมัติ"
                  : (selfCancel.reason ?? "ยกเลิกเองไม่ได้แล้ว กรุณาติดต่อผู้จัดการหรือฝ่ายบัญชี")}
              </p>
            </div>
          </div>
          {selfCancel.allowed && (
            <button
              type="button"
              onClick={() => setCancelOpen(true)}
              className="shrink-0 inline-flex items-center gap-2 text-[13px] font-semibold px-4 py-2 rounded-lg cursor-pointer transition-colors"
              style={{
                color: "var(--color-danger)",
                border: "1px solid rgba(220,38,38,0.3)",
                background: "rgba(220,38,38,0.06)",
              }}
            >
              <Ban size={14} /> ยกเลิกคำขอ
            </button>
          )}
        </div>
      )}

      {/* ── ขั้นตอนการอนุมัติ ── */}
      {approvals.length > 0 && (
        <Section title="ขั้นตอนการอนุมัติ" icon={<CheckCircle size={15} />}>
          {/* The action bar: only the step that is pending, only for someone
              the server says may act on it. */}
          {canAct && step && (
            <div
              className="mb-4 pb-4 flex flex-col gap-3"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              {ctx?.viaManagerDevBypass && (
                <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
                  โหมดทดสอบ (localhost:3081) — ผู้ใช้ที่ล็อกอินกดอนุมัติแทนผู้จัดการได้
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => { setAction("approve"); setComment(""); }}
                  className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: "var(--bg-info-green)",
                    color: "var(--text-info-green)",
                    border: "1px solid var(--border-info-green)",
                  }}
                >
                  <ThumbsUp size={14} />
                  {APPROVE_LABEL[step]}
                </button>
                {/* Return, not reject: the claim is fixable rather than
                    refused. Available at all three steps — see `returnReimburse`
                    — and it is what makes a mistake survivable at all, since a
                    rejection is terminal and the requester cannot edit,
                    resubmit or even discard afterwards. */}
                <button
                  type="button"
                  onClick={() => { setAction("return"); setComment(""); }}
                  className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    background: "var(--bg-info-yellow)",
                    color: "var(--text-info-yellow)",
                    border: "1px solid var(--border-info-yellow)",
                  }}
                >
                  <RotateCcw size={14} />
                  ส่งกลับแก้ไข
                </button>
                <button
                  type="button"
                  onClick={() => { setAction("reject"); setComment(""); }}
                  className="inline-flex items-center gap-2 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer"
                  style={{
                    color: "var(--color-danger)",
                    border: "1px solid rgba(220,38,38,0.25)",
                    background: "rgba(220,38,38,0.06)",
                  }}
                >
                  <ThumbsDown size={14} />
                  ไม่อนุมัติ
                </button>
              </div>
            </div>
          )}

          {/* The context could not be fetched. Distinct from "you may not act",
              which is the block below: with no message at all an approver who is
              entitled to act sees an approval section with no buttons and no
              reason, and reads it as a broken page. */}
          {ctxFailed && (
            <div
              className="mb-4 pb-4 flex items-start gap-2"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              <Info size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-yellow)" }} />
              <p className="text-[12px] m-0" style={{ color: "var(--text-secondary)" }}>
                ตรวจสอบสิทธิ์การอนุมัติไม่สำเร็จ — ปุ่มดำเนินการจึงยังไม่แสดง กรุณาโหลดหน้านี้ใหม่
              </p>
            </div>
          )}

          {/* A refusal that needs explaining: the viewer *is* an approver, so a
              missing button with no reason would read as a broken page. */}
          {!canAct && ctx?.reason && (
            <div
              className="mb-4 pb-4 flex items-start gap-2"
              style={{ borderBottom: "1px solid var(--border-light)" }}
            >
              <Info size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-yellow)" }} />
              <p className="text-[12px] m-0" style={{ color: "var(--text-secondary)" }}>
                {ctx.reason}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-0">
            {timeline.map((entry, idx) => {
              const isLast = idx === timeline.length - 1;
              const a = entry.approval;
              if (!a) {
                return (
                  <div key={entry.key} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                        style={{
                          background: "var(--bg-badge)",
                          color: "var(--text-faint)",
                          border: "1px dashed var(--border-card)",
                        }}
                      >
                        <Clock size={13} />
                      </div>
                      {!isLast && (
                        <div className="w-px flex-1 my-1" style={{ background: "var(--border-light)", minHeight: 16 }} />
                      )}
                    </div>
                    <div className="flex-1 pb-4 min-w-0">
                      <div className="mb-0.5">
                        <span className="text-[13px] font-medium" style={{ color: "var(--text-faint)" }}>
                          {STEP_LABEL[entry.stepCode]}
                        </span>
                      </div>
                      <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
                        {chainStopped ? "ไม่ได้ดำเนินการ" : "ยังไม่ถึงขั้นตอนนี้"}
                      </p>
                    </div>
                  </div>
                );
              }
              const dot =
                a.status === "Approved"
                  ? { background: "var(--bg-info-green)", color: "var(--text-info-green)", border: "1px solid var(--border-info-green)" }
                  : a.status === "Rejected"
                    ? { background: "var(--status-bad-bg)", color: "var(--status-bad-text)", border: "1px solid var(--status-bad-bg)" }
                    : a.status === "Returned"
                      ? { background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }
                      : { background: "var(--bg-badge)", color: "var(--text-muted)", border: "1px solid var(--border-card)" };
              const actor = approvalActorLabel(a);
              return (
                <div key={entry.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                      style={dot}
                    >
                      {a.status === "Approved" ? (
                        <CheckCircle size={14} />
                      ) : a.status === "Rejected" ? (
                        <XCircle size={14} />
                      ) : a.status === "Returned" ? (
                        <RotateCcw size={13} />
                      ) : (
                        <Clock size={13} />
                      )}
                    </div>
                    {!isLast && (
                      <div className="w-px flex-1 my-1" style={{ background: "var(--border-light)", minHeight: 16 }} />
                    )}
                  </div>

                  <div className="flex-1 pb-4 min-w-0">
                    <div className="mb-1 flex items-center gap-2 flex-wrap">
                      <ApprovalStatusBadge status={a.status} withdrawn={withdrawn} />
                      {request.currentStepCode === a.stepCode && a.status === "Pending" && (
                        <span
                          className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
                        >
                          ขั้นตอนปัจจุบัน
                        </span>
                      )}
                    </div>
                    <div className="mb-0.5">
                      <span className="text-[13px] font-medium" style={{ color: "var(--text-heading)" }}>
                        {STEP_LABEL[a.stepCode] ?? a.stepCode}
                      </span>
                    </div>
                    {actor && (
                      <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                        {approvalActorPrefix(a.status, withdrawn)} {actor}
                      </p>
                    )}
                    {a.comment && (
                      <p
                        className="text-[12px] mt-1 px-2 py-1.5 rounded-lg whitespace-pre-wrap break-words"
                        style={{
                          color: "var(--text-secondary)",
                          background: "var(--bg-card-alt)",
                          border: "1px solid var(--border-light)",
                        }}
                      >
                        {a.comment}
                      </p>
                    )}
                    {a.actionedAt && (
                      <p className="text-[10px] mt-1 m-0" style={{ color: "var(--text-faint)" }}>
                        {fmtDateTime(a.actionedAt)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* ── รายละเอียดคำขอ ── */}
      <Section title="รายละเอียดคำขอ" icon={<Receipt size={15} />}>
        <div className="flex flex-col gap-2.5">
          <DetailRow label="เลขที่คำขอ" value={request.requestNo ?? "ฉบับร่าง"} />
          <DetailRow label="สถานะ" value={<RequestStatusBadge status={request.status} />} />
          <DetailRow label="แบรนด์ที่เบิก" value={brand?.name ?? request.brandCode ?? "—"} />
          {request.purpose && (
            <DetailRow
              label="วัตถุประสงค์"
              value={<span className="whitespace-pre-wrap break-words">{request.purpose}</span>}
            />
          )}
          <DetailRow
            label="ยอดรวมที่ขอเบิก"
            value={<span className="font-bold tabular-nums">฿{fmtMoney(request.totalAmount ?? itemsTotal)}</span>}
          />
          {request.submittedAt && <DetailRow label="วันที่ส่ง" value={fmtDateTime(request.submittedAt)} />}
          {request.paymentDate && <DetailRow label="วันที่จ่าย" value={fmtDateOnly(request.paymentDate)} />}
        </div>
      </Section>

      {/* ── ผู้ขอเบิก ── */}
      <Section title="ผู้ขอเบิก" icon={<User size={15} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
              <Avatar name={request.requesterFullName || "?"} size={48} color="var(--nav-active-text)" />
            </div>
            <div className="min-w-0 flex flex-col gap-0.5">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                  {request.requesterFullName || "-"}
                </span>
                {request.staffId != null && (
                  <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                    #{request.staffId}
                  </span>
                )}
              </div>
              {(request.requesterDepartmentName || request.requesterPosition) && (
                <span className="text-[12px] truncate" style={{ color: "var(--text-muted)" }}>
                  {[request.requesterDepartmentName, request.requesterPosition].filter(Boolean).join(" · ")}
                </span>
              )}
              {request.requesterEmail && (
                <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <Mail size={11} className="shrink-0" />
                  <span className="truncate">{request.requesterEmail}</span>
                </span>
              )}
            </div>
          </div>

          {request.managerEmail && (
            <div className="flex items-center gap-3 min-w-0 border-t md:border-t-0 md:border-l border-[var(--border-light)] pt-4 md:pt-0 md:pl-6">
              <div className="shrink-0 rounded-2xl overflow-hidden" style={{ boxShadow: "0 0 0 2px var(--nav-active-bg)" }}>
                <Avatar name={request.managerEmail} size={48} color="var(--nav-active-text)" />
              </div>
              <div className="min-w-0 flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                  หัวหน้างาน (ผู้จัดการ)
                </span>
                {request.managerStaffId != null && (
                  <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                    #{request.managerStaffId}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[12px] truncate" style={{ color: "var(--text-secondary)" }}>
                  <Mail size={11} className="shrink-0" />
                  <span className="truncate">{request.managerEmail}</span>
                </span>
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* ── รายการค่าใช้จ่ายจริง ── */}
      <Section title="รายการค่าใช้จ่ายจริง" icon={<ListChecks size={15} />}>
        {request.items.length === 0 ? (
          <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
            — ไม่มีรายการ —
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-card)" }}>
                  {["วันที่", "รายละเอียด", "ยอดรวม VAT", "VAT", "หัก ณ ที่จ่าย"].map((h, i) => (
                    <th
                      key={h}
                      className={`text-[11px] font-semibold uppercase tracking-wide py-2 px-2 ${i >= 2 ? "text-right" : "text-left"}`}
                      style={{ color: "var(--text-muted)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {request.items.map((it, i) => (
                  <tr key={it.id ?? i} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td className="text-[13px] py-2 px-2 whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {fmtDateOnly(it.expenseDate)}
                    </td>
                    <td className="text-[13px] py-2 px-2 break-words" style={{ color: "var(--text-primary)" }}>
                      {it.description || "—"}
                    </td>
                    <td className="text-[13px] py-2 px-2 text-right tabular-nums font-semibold" style={{ color: "var(--text-primary)" }}>
                      {fmtMoney(it.amount)}
                    </td>
                    <td className="text-[13px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {fmtMoney(it.vatAmount)}
                    </td>
                    <td className="text-[13px] py-2 px-2 text-right tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {fmtMoney(it.whtAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div
          className="rounded-xl px-4 py-3 flex items-center justify-between gap-3 mt-3"
          style={{ background: "var(--nav-active-bg)" }}
        >
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--nav-active-text)" }}>
            ยอดรวมที่ขอเบิก
          </span>
          <span className="text-[16px] font-bold tabular-nums" style={{ color: "var(--nav-active-text)" }}>
            ฿{fmtMoney(itemsTotal)}
          </span>
        </div>
      </Section>

      {/* ── เอกสารแนบ ── */}
      <Section title="เอกสารแนบ" icon={<Paperclip size={15} />}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 m-0" style={{ color: "var(--text-muted)" }}>
              <FileSpreadsheet size={11} className="inline mr-1 -mt-0.5" />
              ไฟล์ Excel สรุปรายการ (AP-4.1)
            </p>
            {request.excelFile ? (
              <FileLink file={request.excelFile} onView={() => viewFile(request.excelFile!)} />
            ) : (
              <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
                — ไม่มีไฟล์ —
              </p>
            )}
          </div>

          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide mb-1.5 m-0" style={{ color: "var(--text-muted)" }}>
              หลักฐาน (ใบเสร็จ / ใบกำกับภาษี)
            </p>
            {request.receiptFiles.length === 0 ? (
              <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
                — ไม่มีไฟล์ —
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {request.receiptFiles.map((f) => (
                  <FileLink key={f.id} file={f} onView={() => viewFile(f)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* ── ระเบียบการจ่าย ── */}
      <Section title="ระเบียบการจ่าย Reimburse" icon={<FileCheck size={15} />}>
        {request.ackedRuleIds.length === 0 ? (
          <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
            — ยังไม่ได้ยืนยัน —
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
              ยืนยันแล้ว {request.ackedRuleIds.length} ข้อ
            </p>
            {ackedRules.map((r) => (
              <div key={r.id} className="flex items-start gap-2 min-w-0">
                <CheckCircle size={14} className="shrink-0 mt-0.5" style={{ color: "var(--text-info-green)" }} />
                <span
                  className="text-[12.5px] leading-relaxed whitespace-pre-wrap break-words"
                  style={{ color: "var(--text-primary)" }}
                >
                  {r.ruleText}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* ── Approve: a confirmation, plus the payment-date picker on the check ── */}
      <Dialog
        open={action === "approve"}
        onOpenChange={(open) => { if (!open) closeDialog(); }}
        title={step === "ACCOUNT" ? "ตรวจสอบและกำหนดวันที่จ่าย" : "ยืนยันการอนุมัติ"}
        uniformSurface
      >
        <div className="flex flex-col gap-4 mb-6">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            คำขอเลขที่{" "}
            <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong>{" "}
            ยอดรวม{" "}
            <strong style={{ color: "var(--text-heading)" }}>฿{fmtMoney(request.totalAmount ?? itemsTotal)}</strong>
          </p>
          {needsPaymentDate && (
            <PaymentDatePicker
              dates={ctx?.paymentDates ?? []}
              value={paymentDate}
              onChange={setPaymentDate}
              loading={ctx == null}
              hint={AP4_ROUNDS_HINT}
            />
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => submitAction("approve")}
            disabled={busy || (needsPaymentDate && !paymentDate)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              background: "var(--bg-info-green)",
              color: "var(--text-info-green)",
              border: "1px solid var(--border-info-green)",
              opacity: busy || (needsPaymentDate && !paymentDate) ? 0.7 : 1,
            }}
          >
            {busy ? "กำลังดำเนินการ..." : "ยืนยัน"}
          </button>
        </div>
      </Dialog>

      {/* ── Reject: the reason is required, here and on the server ── */}
      <Dialog
        open={action === "reject"}
        onOpenChange={(open) => { if (!open) closeDialog(); }}
        title="ไม่อนุมัติ — ระบุเหตุผล"
        uniformSurface
      >
        <div className="flex flex-col gap-3 mb-5">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            คำขอเลขที่{" "}
            <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong>
          </p>
          <textarea
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--bg-input)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-input)",
            }}
            placeholder="ระบุเหตุผลที่ไม่อนุมัติ..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => submitAction("reject")}
            disabled={busy || !comment.trim()}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              background: "var(--color-danger)",
              color: "#ffffff",
              opacity: busy || !comment.trim() ? 0.7 : 1,
            }}
          >
            {busy ? "กำลังดำเนินการ..." : "ยืนยัน ไม่อนุมัติ"}
          </button>
        </div>
      </Dialog>

      {/* ── Return for edit: what has to change is required, here and on the server ── */}
      <Dialog
        open={action === "return"}
        onOpenChange={(open) => { if (!open) closeDialog(); }}
        title="ส่งกลับแก้ไข — ระบุสิ่งที่ต้องแก้"
        uniformSurface
      >
        <div className="flex flex-col gap-3 mb-5">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            คำขอเลขที่{" "}
            <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong>{" "}
            จะกลับไปให้ผู้ขอแก้ไข โดยยังใช้เลขที่คำขอเดิม
          </p>
          <textarea
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
            style={{
              background: "var(--bg-input)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-input)",
            }}
            placeholder="ระบุสิ่งที่ต้องแก้ไข..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={() => submitAction("return")}
            disabled={busy || !comment.trim()}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              background: "var(--bg-info-yellow)",
              color: "var(--text-info-yellow)",
              border: "1px solid var(--border-info-yellow)",
              opacity: busy || !comment.trim() ? 0.7 : 1,
            }}
          >
            {busy ? "กำลังดำเนินการ..." : "ยืนยัน ส่งกลับแก้ไข"}
          </button>
        </div>
      </Dialog>

      {/* ── The requester's own withdrawal. No comment: nobody downstream has to
             act on it, and the request keeps its number and its rows. ── */}
      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => { if (!open) setCancelOpen(false); }}
        title="ยกเลิกคำขอ"
        uniformSurface
      >
        <div className="flex flex-col gap-3 mb-5">
          <p className="text-[13px] m-0" style={{ color: "var(--text-secondary)" }}>
            ยกเลิกคำขอเลขที่{" "}
            <strong style={{ color: "var(--text-heading)" }}>{request.requestNo ?? "ฉบับร่าง"}</strong>{" "}
            ยอดรวม{" "}
            <strong style={{ color: "var(--text-heading)" }}>฿{fmtMoney(request.totalAmount ?? itemsTotal)}</strong>
          </p>
          <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
            คำขอจะถูกยกเลิกและไม่ส่งต่อให้ผู้จัดการ — ยกเลิกแล้วจะกลับมาแก้ไขคำขอนี้ไม่ได้
            หากต้องการเบิกใหม่ ต้องสร้างคำขอใหม่
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setCancelOpen(false)}
            disabled={busy}
            className="text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              color: "var(--text-secondary)",
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
            }}
          >
            ไม่ยกเลิก
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium px-4 py-2 rounded-lg"
            style={{
              background: "var(--color-danger)",
              color: "#ffffff",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? "กำลังดำเนินการ..." : "ยืนยัน ยกเลิกคำขอ"}
          </button>
        </div>
      </Dialog>

      <AttachmentViewer
        open={viewing !== null}
        source={viewing?.source ?? null}
        kind={viewing?.kind ?? "other"}
        onClose={() => setViewing(null)}
      />
    </div>
  );
}
