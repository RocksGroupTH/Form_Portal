/**
 * Column model for the AP-2 approval queue — which columns exist, how each one
 * reads as text, and how the reader's shown/hidden and dragged order survive a
 * reload. Same shape the AP-2-Control report uses, kept out of the component so
 * the table markup stays readable.
 *
 * The checkbox and the preview button are not here: they are controls, not data,
 * so they are never hidden, never reordered and never filtered on.
 */

import { makeColumnPrefs } from "./queue-column-prefs";

export type QueueFilterKind = "text" | "select";

export interface ApproveQueueColumn {
  key: string;
  label: string;
  /** Right-align the cell and its header — numbers only. */
  numeric?: boolean;
  /** What kind of header filter the column offers, if any. */
  filter?: QueueFilterKind;
}

/**
 * Canonical order. Everything is offered; nothing is excluded, because unlike
 * the report this table has no export whose column positions other people's
 * spreadsheets depend on.
 */
export const APPROVE_QUEUE_COLUMNS: ApproveQueueColumn[] = [
  { key: "requestNo", label: "เลขที่", filter: "text" },
  { key: "company", label: "Company", filter: "select" },
  { key: "requester", label: "ผู้ขอ", filter: "text" },
  { key: "payee", label: "ผู้รับเงิน", filter: "text" },
  { key: "currency", label: "สกุลเงิน", filter: "select" },
  { key: "amount", label: "จำนวน (สกุลเงิน)", numeric: true },
  { key: "exchangeRate", label: "อัตราแลกเปลี่ยน", numeric: true },
  { key: "baseAmount", label: "จำนวน (บาท)", numeric: true },
  { key: "vendor", label: "Vendor", filter: "text" },
  { key: "step", label: "ขั้น", filter: "select" },
];

/** Storage keys of its own — the interface list has its own layout. */
export const APPROVE_QUEUE_PREFS = makeColumnPrefs(
  APPROVE_QUEUE_COLUMNS,
  "ap2-approve-cols",
  "ap2-approve-col-order",
);
