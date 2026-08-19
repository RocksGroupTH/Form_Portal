"use client";

import { useState } from "react";
import useSWR from "swr";
import {
  Check,
  Eye,
  EyeOff,
  FileCheck,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RULE_TEXT_MAX } from "@/features/reimburse/constants";
import type { ReimburseRule } from "@/features/reimburse/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** Admin view: retired rules included, so they can be brought back. */
const ENDPOINT = "/api/request/reimburse/settings/rules?includeInactive=1";
const WRITE_ENDPOINT = "/api/request/reimburse/settings/rules";

/* ─────────────────────────── one row ─────────────────────────── */

function RuleRow({
  rule,
  busy,
  onSave,
  onToggleActive,
}: {
  rule: ReimburseRule;
  busy: boolean;
  onSave: (id: number, text: string) => Promise<void>;
  onToggleActive: (rule: ReimburseRule) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.ruleText);

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
    background: isDragging ? "var(--bg-card-alt)" : "var(--bg-card)",
    border: "1px solid var(--border-card)",
    boxShadow: isDragging ? "var(--shadow-lg)" : "var(--shadow-sm)",
    opacity: rule.isActive ? 1 : 0.6,
  };

  const startEdit = () => {
    setDraft(rule.ruleText);
    setEditing(true);
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-start gap-3 rounded-2xl pl-1.5 pr-3 py-2.5 transition-all"
    >
      <button
        {...attributes}
        {...listeners}
        className="shrink-0 w-6 h-9 inline-flex items-center justify-center cursor-grab active:cursor-grabbing border-none touch-none opacity-30 group-hover:opacity-100 transition-opacity"
        style={{ background: "transparent", color: "var(--text-faint)" }}
        title="ลากเพื่อจัดลำดับ"
        aria-label="ลากเพื่อจัดลำดับ"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex-1 min-w-0 py-1">
        {editing ? (
          <div className="flex flex-col gap-2">
            <textarea
              autoFocus
              rows={3}
              maxLength={RULE_TEXT_MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full text-[12.5px] leading-relaxed rounded-xl px-3 py-2 outline-none"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border-input)",
                color: "var(--text-primary)",
                resize: "vertical",
              }}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || !draft.trim()}
                onClick={() => {
                  void onSave(rule.id, draft).then(() => setEditing(false));
                }}
                className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-lg border-none enabled:cursor-pointer disabled:opacity-60"
                style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} บันทึก
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-lg cursor-pointer border-none"
                style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
              >
                <X size={12} /> ยกเลิก
              </button>
              <span className="text-[10px] ml-auto tabular-nums" style={{ color: "var(--text-faint)" }}>
                {draft.length} / {RULE_TEXT_MAX}
              </span>
            </div>
          </div>
        ) : (
          <p
            className="text-[12.5px] leading-relaxed m-0 whitespace-pre-wrap break-words"
            style={{ color: "var(--text-primary)" }}
          >
            {rule.ruleText}
          </p>
        )}
      </div>

      {!editing && (
        <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded"
            style={
              rule.isActive
                ? { background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
                : { background: "var(--bg-badge)", color: "var(--text-muted)" }
            }
          >
            {rule.isActive ? "ใช้งาน" : "ปิด"}
          </span>
          <button
            type="button"
            onClick={startEdit}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border-none enabled:cursor-pointer disabled:opacity-60"
            style={{ width: 24, height: 24, background: "var(--bg-badge)", color: "var(--text-secondary)" }}
            title="แก้ไขข้อความ"
            aria-label={`แก้ไขระเบียบข้อที่ ${rule.sortOrder + 1}`}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            onClick={() => onToggleActive(rule)}
            disabled={busy}
            className="inline-flex items-center justify-center rounded-full border-none enabled:cursor-pointer disabled:opacity-60"
            style={
              rule.isActive
                ? { width: 24, height: 24, background: "var(--status-bad-bg)", color: "var(--status-bad-text)" }
                : { width: 24, height: 24, background: "var(--status-ok-bg)", color: "var(--status-ok-text)" }
            }
            title={rule.isActive ? "ปิดการใช้งาน" : "เปิดใช้งาน"}
            aria-label={rule.isActive ? "ปิดการใช้งานระเบียบข้อนี้" : "เปิดใช้งานระเบียบข้อนี้"}
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : rule.isActive ? (
              <EyeOff size={12} />
            ) : (
              <Eye size={12} />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── the editor ─────────────────────────── */

/**
 * The acknowledgement checklist (`AccReimburseRule`) — add, reword, reorder and
 * retire.
 *
 * **Nothing here deletes.** `AccReimburseRuleAck` holds one row per
 * (request, rule) for every claim that ticked it, so a rule is retired rather
 * than removed: a request approved months ago still renders the wording that
 * was in force when its author agreed to it. The one destructive-looking button
 * — the crossed-out eye — flips `IsActive`, and the row stays listed here so it
 * can be switched back on.
 *
 * Rewording is deliberately in-place and keeps the id. That is the right
 * behaviour for a typo and the wrong one for a change of policy: an existing
 * acknowledgement will then point at text nobody agreed to. There is no way for
 * this page to tell the two apart, so the copy below says so and the remedy —
 * retire the old line, add a new one — is one click away.
 *
 * Drag to reorder, like AP-1's vehicle list, with the same optimistic write.
 */
export function ReimburseRuleSettings() {
  const { data, mutate, isLoading } = useSWR<{ ok: boolean; data: ReimburseRule[]; error?: string }>(
    ENDPOINT,
    fetcher,
  );

  const [busyId, setBusyId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState("");
  const [saving, setSaving] = useState(false);

  const rules = data?.ok ? data.data : [];
  const loadError = data && !data.ok ? (data.error ?? "โหลดข้อมูลไม่สำเร็จ") : null;
  const activeCount = rules.filter((r) => r.isActive).length;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const write = async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(WRITE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) return true;
      toast.error(json.error ?? "บันทึกไม่สำเร็จ");
      return false;
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
      return false;
    }
  };

  const handleCreate = async () => {
    const text = newText.trim();
    if (!text) return;
    setSaving(true);
    try {
      if (await write({ action: "create", ruleText: text })) {
        toast.success("เพิ่มระเบียบแล้ว");
        setNewText("");
        setAdding(false);
        await mutate();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSaveText = async (id: number, text: string) => {
    setBusyId(id);
    try {
      if (await write({ action: "update", id, ruleText: text.trim() })) {
        toast.success("บันทึกข้อความแล้ว");
        await mutate();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleToggleActive = (rule: ReimburseRule) => {
    setBusyId(rule.id);
    void write({ action: "setActive", id: rule.id, isActive: !rule.isActive })
      .then(async (ok) => {
        if (ok) {
          toast.success(rule.isActive ? "ปิดการใช้งานแล้ว" : "เปิดใช้งานแล้ว");
          await mutate();
        }
      })
      .finally(() => setBusyId(null));
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = rules.findIndex((r) => r.id === active.id);
    const newIndex = rules.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(rules, oldIndex, newIndex).map((r, i) => ({ ...r, sortOrder: i }));
    // Optimistic, then persist — the same shape as AP-1's vehicle reorder.
    void mutate({ ok: true, data: reordered }, false);
    void write({ action: "reorder", ids: reordered.map((r) => r.id) }).then(async (ok) => {
      if (ok) toast.success("เรียงลำดับใหม่แล้ว");
      await mutate();
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl p-4" style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
        <div className="flex items-center gap-2 mb-3">
          <FileCheck size={16} style={{ color: "var(--text-heading)" }} />
          <h2 className="text-[14px] font-bold flex-1" style={{ color: "var(--text-heading)" }}>
            ระเบียบการจ่าย Reimburse
          </h2>
          <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>
            ใช้งาน {activeCount} / {rules.length} ข้อ
          </span>
        </div>

        <p className="text-[11.5px] leading-relaxed mb-3 m-0" style={{ color: "var(--text-muted)" }}>
          ผู้ขอเบิกต้องติ๊กยืนยันทุกข้อที่เปิดใช้งานก่อนส่งคำขอ AP-4 · ลากเพื่อจัดลำดับ ·
          ระเบียบจะถูก &quot;ปิดการใช้งาน&quot; ไม่ใช่ลบ เพราะคำขอที่ส่งไปแล้วอ้างอิงข้อความเดิมไว้ ·
          หากเป็นการเปลี่ยนเนื้อหาสาระ ไม่ใช่แก้คำผิด ควรปิดข้อเดิมแล้วเพิ่มข้อใหม่
          เพื่อไม่ให้คำขอเก่าชี้ไปยังข้อความที่เจ้าของคำขอไม่เคยยืนยัน
        </p>

        {/* ── add ── */}
        <div className="mb-4">
          {adding ? (
            <div
              className="rounded-2xl p-3 flex flex-col gap-2"
              style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-card)" }}
            >
              <textarea
                autoFocus
                rows={3}
                maxLength={RULE_TEXT_MAX}
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="ข้อความระเบียบที่ผู้ขอเบิกต้องยืนยัน..."
                className="w-full text-[12.5px] leading-relaxed rounded-xl px-3 py-2 outline-none"
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-input)",
                  color: "var(--text-primary)",
                  resize: "vertical",
                }}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={saving || !newText.trim()}
                  onClick={() => void handleCreate()}
                  className="inline-flex items-center gap-1 text-[11px] font-bold px-3 py-1.5 rounded-lg border-none enabled:cursor-pointer disabled:opacity-60"
                  style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} เพิ่ม
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAdding(false);
                    setNewText("");
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-lg cursor-pointer border-none"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
                >
                  <X size={12} /> ยกเลิก
                </button>
                <span className="text-[10px] ml-auto tabular-nums" style={{ color: "var(--text-faint)" }}>
                  {newText.length} / {RULE_TEXT_MAX}
                </span>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg cursor-pointer border-none"
              style={{ background: "var(--color-action)", color: "var(--btn-primary-text)" }}
            >
              <Plus size={12} /> เพิ่มระเบียบ
            </button>
          )}
        </div>

        {/* ── list ── */}
        {isLoading ? (
          <div className="py-10 flex justify-center">
            <Loader2 size={20} className="animate-spin" style={{ color: "var(--text-muted)" }} />
          </div>
        ) : loadError ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-danger)" }}>
            {loadError}
          </p>
        ) : rules.length === 0 ? (
          <p className="py-8 text-center text-[12px]" style={{ color: "var(--text-muted)" }}>
            ยังไม่มีระเบียบ — กด &quot;เพิ่มระเบียบ&quot; เพื่อเริ่มต้น
          </p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {rules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    busy={busyId === rule.id}
                    onSave={handleSaveText}
                    onToggleActive={handleToggleActive}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
