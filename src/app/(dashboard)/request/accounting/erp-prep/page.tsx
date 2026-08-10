import { redirect } from "next/navigation";

/** Legacy route — ERP prep lives under accounting approvals (Interface tab). */
export default function AccountingErpPrepPage() {
  redirect("/request/accounting/approvals?tab=interface");
}
