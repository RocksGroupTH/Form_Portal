"use client";

import { useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Loader2, Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui";
import type { RewardOfficer } from "@/features/reward/types";

/**
 * The Assist AP roster.
 *
 * Admin-only on the server, and worth saying why on screen: being on this list
 * grants the queue, the report and read access to every reward request — so the
 * page names that rather than presenting it as a neutral preference.
 */

async function fetcher(url: string): Promise<RewardOfficer[]> {
  const res = await fetch(url);
  const json = await res.json();
  if (!json.ok) throw new Error(typeof json.error === "string" ? json.error : "โหลดข้อมูลไม่สำเร็จ");
  return json.data as RewardOfficer[];
}

export function RewardOfficerSettings() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/request/reward/settings/officers",
    fetcher,
  );
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const officers = (data ?? []).filter((o) => o.isActive);

  async function add() {
    if (!email.trim()) {
      toast.error("กรุณาระบุอีเมล");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/request/reward/settings/officers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "เพิ่มไม่สำเร็จ");
        return;
      }
      toast.success("เพิ่มแล้ว");
      setEmail("");
      mutate();
    } catch {
      toast.error("เพิ่มไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: number) {
    try {
      const res = await fetch(`/api/request/reward/settings/officers?id=${id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ลบไม่สำเร็จ");
        return;
      }
      mutate();
    } catch {
      toast.error("ลบไม่สำเร็จ");
    }
  }

  return (
    <section
      className="rounded-[14px] p-4 sm:p-5"
      style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
    >
      <h2 className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
        ทีม Assist AP
      </h2>
      <p className="text-[11.5px] mt-1 mb-3.5" style={{ color: "var(--text-muted)" }}>
        ผู้ที่อยู่ในรายชื่อนี้จะเห็นคิวจัดของ รายงาน และคำขอแลกของรางวัลทั้งหมด
        และเป็นผู้อนุมัติขั้นที่ 2
      </p>

      {officers.length === 0 && !isLoading && (
        <p
          className="text-[12px] rounded-lg px-3 py-2 mb-3"
          style={{ background: "var(--status-pending-bg)", color: "var(--status-pending-text)" }}
        >
          ยังไม่มีใครในรายชื่อ — คำขอจะค้างอยู่ที่ขั้น Assist AP
          จนกว่าจะเพิ่มอย่างน้อย 1 คน (ผู้ดูแลระบบยังดำเนินการแทนได้)
        </p>
      )}

      <div className="flex gap-2 mb-4">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="อีเมลพนักงาน"
          className="flex-1 text-[13px] rounded-lg px-3 py-2 outline-none"
          style={{
            background: "var(--bg-subtle)",
            color: "var(--text-primary)",
            border: "1px solid var(--border-card)",
          }}
        />
        <Button variant="primary" size="md" loading={busy} icon={<Plus size={14} />} onClick={add}>
          เพิ่ม
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={15} className="animate-spin" />
          กำลังโหลด...
        </div>
      ) : error ? (
        <p className="text-[13px]" style={{ color: "var(--text-danger)" }}>
          {error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"}
        </p>
      ) : (
        <div className="space-y-2">
          {officers.map((o) => (
            <div
              key={o.id}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2"
              style={{ background: "var(--bg-subtle)" }}
            >
              <UserRound size={15} style={{ color: "var(--text-muted)" }} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p
                  className="text-[12.5px] font-semibold truncate"
                  style={{ color: "var(--text-primary)" }}
                >
                  {o.displayName ?? o.email}
                </p>
                {o.displayName && (
                  <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                    {o.email}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => remove(o.id)}
                className="shrink-0 p-1 rounded-md"
                style={{ color: "var(--text-danger)" }}
                aria-label={`ลบ ${o.email}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
