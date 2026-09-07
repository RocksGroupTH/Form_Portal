/**
 * Column model for the "ส่งแล้ว" table on the AP-2 Interface ERP tab.
 *
 * "การจัดการ" — the pull-back button — is deliberately absent: it is a control,
 * not data, and a reader must not be able to hide or rearrange their way out of
 * reaching it. Same reason the approval queue keeps its checkbox and preview
 * button outside the model.
 */

import { makeColumnPrefs } from "./queue-column-prefs";

export interface SentQueueColumn {
  key: string;
  label: string;
  /** Right-align the cell and its header — numbers only. */
  numeric?: boolean;
}

export const SENT_QUEUE_COLUMNS: SentQueueColumn[] = [
  { key: "requestNo", label: "เลขที่" },
  { key: "company", label: "Company" },
  { key: "payee", label: "ผู้รับเงิน" },
  { key: "paymentDate", label: "วันจ่าย" },
  { key: "currency", label: "สกุลเงิน" },
  { key: "amount", label: "จำนวน (สกุลเงิน)", numeric: true },
  { key: "exchangeRate", label: "อัตราแลกเปลี่ยน", numeric: true },
  { key: "baseAmount", label: "จำนวน (บาท)", numeric: true },
  { key: "externalDoc", label: "External Doc." },
  { key: "erpDocumentNo", label: "Doc No. (ERP)" },
  { key: "sentAt", label: "วันที่ส่ง" },
  { key: "status", label: "สถานะ" },
];

export const SENT_QUEUE_PREFS = makeColumnPrefs(
  SENT_QUEUE_COLUMNS,
  "ap2-sent-cols",
  "ap2-sent-col-order",
);
