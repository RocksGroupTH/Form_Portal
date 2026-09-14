"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Loader2 } from "lucide-react";

/**
 * "Pull this company's lists from Business Central", on a settings screen that
 * picks from them.
 *
 * Every list these screens offer — the chart of accounts, the BRANCH dimension,
 * the Locations that carry the BUs — is a mirror of BC, so an account added or
 * renamed over there does not appear until somebody syncs. The only sync
 * buttons before this were on AP-1's Interface ERP tab and AP-3's Location / BU
 * tab, neither of which is where somebody configuring G/L categories is
 * looking.
 *
 * **A partial run reports as a partial run**, not as a failure: a company whose
 * Locations have never been set up still gets its accounts, and the toast names
 * the half that did not arrive. The route answers 200 for that case precisely so
 * the half that worked is not thrown away.
 *
 * Admin only, like the route — a non-admin never reaches these screens at all,
 * so the button is not separately hidden.
 */
export function ErpSyncButton({
  endpoint,
  company,
  target,
  onDone,
}: {
  /** This form's own sync path — see the route's docblock for why it is per form. */
  endpoint: string;
  company: string;
  target: "glAccounts" | "buGlMap";
  onDone: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company, target }),
      });
      const j = (await res.json()) as {
        ok: boolean;
        error?: string;
        data?: { phases: { label: string; rows: number }[]; errors: { label: string; error: string }[] };
      };
      if (!j.ok) {
        toast.error(j.error ?? "sync ไม่สำเร็จ");
        return;
      }
      const pulled = (j.data?.phases ?? []).map((p) => `${p.label} ${p.rows}`).join(" · ");
      const failed = j.data?.errors ?? [];
      if (failed.length > 0) {
        toast.warning(`sync บางส่วน: ${pulled || "ไม่ได้อะไรเลย"} — ไม่สำเร็จ: ${failed.map((e) => e.label).join(", ")}`);
      } else {
        toast.success(`sync จาก Business Central แล้ว — ${pulled}`);
      }
      await onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "sync ไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={busy || !company}
      onClick={() => void run()}
      title="ดึงผังบัญชี/สาขา/Location ของบริษัทนี้จาก Business Central"
      className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-55"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        color: "var(--text-secondary)",
      }}
    >
      {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
      Sync จาก ERP
    </button>
  );
}
