"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { Save, Eye } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";
import {
  expandFormMessage,
  parseFormMessage,
  messageBodyProblem,
  FORM_OWNER_TOKEN,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_BLOCKS,
} from "@/lib/form-environment/form-message-text";

interface MessageRow {
  body: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

const fetcher = async (url: string): Promise<MessageRow> => {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
  return json.data as MessageRow;
};

/**
 * The Message tab, shared by all five forms.
 *
 * The **live preview** is not decoration: it runs the same
 * `parseFormMessage` + `expandFormMessage` the form runs, against this form's
 * real owners, so the blank-line rule and a mistyped token are visible before
 * saving rather than after. It is the only thing that makes the format
 * learnable.
 */
export function FormMessageSettings({
  endpoint,
  formCode,
}: {
  endpoint: string;
  formCode: string;
}) {
  const { data, error, isLoading, mutate } = useSWR<MessageRow>(endpoint, fetcher);
  const { data: env } = useFormEnvironments();
  const owners = env?.forms?.[formCode]?.owners ?? [];

  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seeded once from the server, then owned by the textarea — re-seeding per
  // render would snap a half-typed edit back on every revalidation.
  useEffect(() => {
    if (data && text === null) setText(data.body);
  }, [data, text]);

  const body = text ?? "";
  const blocks = expandFormMessage(body, owners);
  const problem = messageBodyProblem(body);
  const dirty = data != null && body !== data.body;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok === false) throw new Error(json?.error || `HTTP ${res.status}`);
      await mutate(json.data as MessageRow, { revalidate: false });
      setText((json.data as MessageRow).body);
      toast.success("บันทึกข้อความแล้ว");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>;
  }
  // A failed read must never render as an empty message: saving over it would
  // wipe the real copy. Same rule `LogPanel` learned the hard way.
  if (error) {
    return (
      <p className="text-[13px]" style={{ color: "var(--text-danger)" }}>
        โหลดข้อความไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className="rounded-xl px-4 py-3 text-[12.5px] leading-relaxed"
        style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
      >
        <p className="m-0">• คั่นแต่ละข้อด้วย<strong>บรรทัดว่าง 1 บรรทัด</strong> — การขึ้นบรรทัดใหม่เฉย ๆ จะยังอยู่ในข้อเดียวกัน</p>
        <p className="m-0">• พิมพ์ <code>{FORM_OWNER_TOKEN}</code> เพื่อแทนชื่อเจ้าของฟอร์ม — ถ้าลบออก บรรทัดติดต่อจะหายไปด้วย</p>
        <p className="m-0">• ปล่อยว่างไว้ = ไม่แสดงกล่องข้อความบนฟอร์มนี้</p>
      </div>

      <textarea
        value={body}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        spellCheck={false}
        className="w-full rounded-xl px-3 py-2.5 text-[13px] leading-relaxed font-mono"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", color: "var(--text-primary)" }}
      />

      <div className="flex items-center justify-between gap-3 flex-wrap text-[12px]">
        <span style={{ color: problem ? "var(--text-danger)" : "var(--text-muted)" }}>
          {problem ?? `${body.length.toLocaleString()} / ${MAX_MESSAGE_CHARS.toLocaleString()} ตัวอักษร · ${parseFormMessage(body).length} / ${MAX_MESSAGE_BLOCKS} ข้อ`}
        </span>
        <Button onClick={save} disabled={saving || !!problem || !dirty}>
          <Save size={14} /> {saving ? "กำลังบันทึก..." : "บันทึก"}
        </Button>
      </div>

      {data?.updatedAt && (
        <p className="text-[11.5px] m-0" style={{ color: "var(--text-faint)" }}>
          แก้ไขล่าสุด {new Date(data.updatedAt).toLocaleString("th-TH")}
          {data.updatedBy ? ` โดย ${data.updatedBy}` : ""}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
          <Eye size={13} /> ตัวอย่างที่ผู้ขอเบิกจะเห็น
        </span>
        {blocks.length === 0 ? (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-faint)" }}>
            ไม่มีข้อความ — ฟอร์มนี้จะไม่แสดงกล่องข้อความ
          </p>
        ) : (
          <div
            className="rounded-2xl px-4 py-3.5 flex flex-col gap-1"
            style={{
              background: "color-mix(in srgb, var(--color-action) 8%, var(--bg-card))",
              border: "1px solid color-mix(in srgb, var(--color-action) 25%, var(--border-card))",
            }}
          >
            {blocks.map((b, i) => (
              <p key={i} className="text-[12.5px] leading-relaxed m-0 whitespace-pre-line" style={{ color: "var(--text-secondary)" }}>
                {b}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
