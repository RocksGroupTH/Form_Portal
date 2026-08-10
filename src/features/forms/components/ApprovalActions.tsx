"use client";

import { useState } from "react";
import { Button, Dialog } from "@/components/ui";
import { Check, X, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

interface ApprovalActionsProps {
  approvalId: number;
  onActionComplete: () => void;
}

type ActionType = "approve" | "reject" | "return";

const ACTION_CONFIG: Record<ActionType, { label: string; icon: React.ReactNode; variant: "primary" | "danger" | "secondary"; commentRequired: boolean }> = {
  approve: { label: "Approve", icon: <Check size={14} />, variant: "primary", commentRequired: false },
  reject:  { label: "Reject", icon: <X size={14} />, variant: "danger", commentRequired: true },
  return:  { label: "Return", icon: <ArrowLeft size={14} />, variant: "secondary", commentRequired: true },
};

export function ApprovalActions({ approvalId, onActionComplete }: ApprovalActionsProps) {
  const [dialogAction, setDialogAction] = useState<ActionType | null>(null);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  const config = dialogAction ? ACTION_CONFIG[dialogAction] : null;

  const handleSubmit = async () => {
    if (!dialogAction) return;
    const cfg = ACTION_CONFIG[dialogAction];
    if (cfg.commentRequired && !comment.trim()) {
      toast.error("Comment is required");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/forms/approvals/${approvalId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dialogAction, comment: comment.trim() || null }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.data?.message ?? json.error ?? "Action failed");
        return;
      }
      toast.success(json.data?.message ?? "Done");
      setDialogAction(null);
      setComment("");
      onActionComplete();
    } catch {
      toast.error("Action failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className="flex items-center gap-2 p-3 rounded-xl"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
      >
        <p className="text-[12px] font-medium flex-1" style={{ color: "var(--text-secondary)" }}>
          This submission is waiting for your approval.
        </p>
        <Button variant="secondary" size="sm" icon={<ArrowLeft size={13} />} onClick={() => setDialogAction("return")}>
          Return
        </Button>
        <Button variant="danger" size="sm" icon={<X size={13} />} onClick={() => setDialogAction("reject")}>
          Reject
        </Button>
        <Button variant="primary" size="sm" icon={<Check size={13} />} onClick={() => setDialogAction("approve")}>
          Approve
        </Button>
      </div>

      <Dialog
        open={!!dialogAction}
        onOpenChange={(open) => { if (!open) { setDialogAction(null); setComment(""); } }}
        title={config?.label ?? ""}
      >
        <div className="flex flex-col gap-3 mt-2">
          <div>
            <label className="block text-[12px] font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
              Comment {config?.commentRequired && <span style={{ color: "var(--color-danger)" }}>*</span>}
            </label>
            <textarea
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none min-h-[80px] resize-y"
              style={{
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-input)",
              }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={config?.commentRequired ? "Please provide a reason..." : "Optional comment..."}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setDialogAction(null); setComment(""); }}>
              Cancel
            </Button>
            <Button
              variant={config?.variant ?? "primary"}
              size="sm"
              icon={config?.icon}
              loading={loading}
              onClick={handleSubmit}
            >
              {config?.label}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
