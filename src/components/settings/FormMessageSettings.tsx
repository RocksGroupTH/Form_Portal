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
  // `revalidateOnFocus: false` matches every other editing panel in this repo
  // (`ReimburseForm.tsx`, `ApiKeySettings.tsx`, `ReimburseDetail.tsx`): SWR's
  // default is on with no global `SWRConfig` here, and an admin who tabs away
  // mid-edit and comes back into a failed background revalidation must not
  // have their in-progress copy replaced by an error screen — see the `error`
  // gate below, which is the other half of the same fix.
  const { data, error, isLoading, mutate } = useSWR<MessageRow>(endpoint, fetcher, {
    revalidateOnFocus: false,
  });
  const { data: env } = useFormEnvironments();
  const owners = env?.forms?.[formCode]?.owners ?? [];

  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Seeded once from the server, then owned by the textarea — re-seeding per
  // render would snap a half-typed edit back on every revalidation.
  useEffect(() => {
    if (data && text === null) setText(data.body);
  }, [data, text]);

  // Falling back to "" alone paints an empty textarea for the one render
  // between SWR resolving and the seeding effect above running, with `dirty`
  // already true and Save enabled against nothing. Falling back to the
  // server's own body first means that render shows the real copy instead.
  const body = text ?? data?.body ?? "";
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
  // A failed FIRST load must never render as an empty message: saving over it
  // would wipe the real copy. Same rule `LogPanel` learned the hard way.
  //
  // But this must fire only when there is no `data` to fall back on. With
  // `revalidateOnFocus` off this is now almost always a first-load failure —
  // a background revalidation error is the rarer case, and replacing the whole
  // editor with this message would discard whatever the admin was typing, in
  // React state but unreachable behind this early return. `ApiKeySettings.tsx`'s
  // `LogPanel` draws the same line for the same reason.
  if (error && !data) {
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
        {/* Only AP-1 folded its contact line into this box — it renders no
            `FormOwnerNotice` anywhere else. AP-17 and AP-2/AP-3/AP-4 all still
            render that line as its own paragraph outside this box, so telling
            them the SAME thing this hint tells AP-1 would invite an admin to
            type the token here too and get the contact line twice. */}
        {formCode === "AP-1" ? (
          <p className="m-0">• พิมพ์ <code>{FORM_OWNER_TOKEN}</code> เพื่อแทนชื่อเจ้าของฟอร์ม — ถ้าลบออก บรรทัดติดต่อจะหายไปด้วย</p>
        ) : (
          <p className="m-0">• ฟอร์มนี้แสดงบรรทัดติดต่อเจ้าของฟอร์มแยกต่างหากอยู่แล้ว — ถ้าพิมพ์ <code>{FORM_OWNER_TOKEN}</code> ในข้อความนี้ด้วย บรรทัดติดต่อจะซ้ำกัน</p>
        )}
        <p className="m-0">• ปล่อยว่างไว้ = ไม่แสดงกล่องข้อความบนฟอร์มนี้</p>
      </div>

      <textarea
        value={body}
        onChange={(e) => setText(e.target.value)}
        rows={14}
        spellCheck={false}
        disabled={saving}
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
              // `pre-wrap`, not `pre-line` — AP-4's `ReimburseNotice` renders
              // with `whitespace-pre-wrap`, and `pre-line` collapses runs of
              // spaces and drops a line's leading space. Its docblock (and
              // migration 164's own seed comment) call the fourth
              // `REIMBURSE_NOTICE` block's leading space part of the owner's
              // compliance source text — `pre-wrap` is a superset that
              // preserves it and is correct for all five forms' previews.
              <p key={i} className="text-[12.5px] leading-relaxed m-0 whitespace-pre-wrap" style={{ color: "var(--text-secondary)" }}>
                {b}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
