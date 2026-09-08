import { ReimburseApprovalQueue } from "@/features/reimburse/ReimburseApprovalQueue";

/**
 * /request/reimburse/approvals — AP-4's accounting queue.
 *
 * A thin server component: every stateful piece (the SWR fetch, the
 * selection, the payment-date control, the per-row return box) lives in
 * `ReimburseApprovalQueue`, which is itself the client boundary. Nothing here
 * reads `useSearchParams`, so nothing here needs a `<Suspense>` wrapper —
 * unlike this route's siblings, which carry one because their header reads a
 * `?from=` return tag this page does not.
 */
export default function ReimburseApprovalsPage() {
  return <ReimburseApprovalQueue />;
}
