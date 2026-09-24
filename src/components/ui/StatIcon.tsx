"use client";

import {
  Ban,
  CalendarDays,
  CheckCircle,
  ClipboardCheck,
  Clock,
  FilePen,
  Layers,
  RotateCcw,
  XCircle,
} from "lucide-react";

/**
 * The icons the stat tiles and summary boxes share.
 *
 * ## Why a name rather than a component
 *
 * `request-status-filter.ts` decides which box exists and what it stands for,
 * and it is a **pure module** — import-free so the boxes and the dropdown can
 * be unit-tested against each other without a database. It cannot hold a React
 * element, so it names one and this maps the name. The union is what makes a
 * box with no icon, or one naming an icon nobody drew, a compile error rather
 * than an empty square.
 *
 * ## Why these icons
 *
 * They are the ones the **approval timeline already draws** for the same
 * states: `CheckCircle` for approved, `XCircle` for rejected, `Clock` for
 * pending, `RotateCcw` for returned, `Ban` for a withdrawal. A box is a filter
 * onto rows whose own chips carry those icons, so a different one here would
 * make the same state look like two states on two screens — which is precisely
 * the complaint that produced `withdrawn-approval.ts` one commit earlier, in
 * miniature.
 *
 * `draft` is the one that could not be borrowed: a draft has no approval row
 * and so no timeline icon. `FilePen` is Home's own AP-2 card icon — a document
 * still being written, which is what a draft is.
 */
export type StatIconName =
  | "all"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "returned"
  | "draft"
  | "inbox"
  | "month";

const ICONS: Record<StatIconName, React.ComponentType<{ size?: number }>> = {
  all: Layers,
  pending: Clock,
  approved: CheckCircle,
  rejected: XCircle,
  cancelled: Ban,
  returned: RotateCcw,
  draft: FilePen,
  /** งานของฉัน's own nav icon — the tile that links there should look like it. */
  inbox: ClipboardCheck,
  month: CalendarDays,
};

/**
 * One tile's icon, tinted in that tile's own colour and held well back.
 *
 * It is decoration beside a number and a label that already say everything, so
 * it is `aria-hidden` — read aloud it would add a word to every tile and a fact
 * to none. The opacity is what keeps it from competing with the figure, which
 * is the thing somebody came to read.
 */
export function StatIcon({
  name,
  color,
  size = 18,
}: {
  name: StatIconName;
  color: string;
  size?: number;
}) {
  const Icon = ICONS[name];
  return (
    <span
      aria-hidden
      className="shrink-0 flex items-center justify-center"
      style={{ color, opacity: 0.45 }}
    >
      <Icon size={size} />
    </span>
  );
}
