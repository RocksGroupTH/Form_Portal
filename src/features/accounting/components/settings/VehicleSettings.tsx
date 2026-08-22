"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, X, Check, GripVertical, Car } from "lucide-react";
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
import { SettingOption } from "@/components/settings/SettingOption";
import { EmojiPickerButton } from "@/components/settings/EmojiPickerButton";
import { SettingsFilterBar } from "./SettingsFilterBar";
import type { AccVehicle } from "@/features/accounting/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/* ── Vehicle Form Dialog ── */
interface VehicleFormData {
  id?: number;
  name: string;
  ratePerKm: string;
  isManualEntry: boolean;
  isActive: boolean;
  icon: string;
}

const ICON_SUGGESTIONS = ["🚗", "🏍️", "🛵", "🚕", "🚙", "🚐", "🚌", "🚆", "✈️", "🚲", "🛺", "🚚", "⛴️", "🧾"];

function VehicleDialog({
  initial,
  onClose,
  onSave,
}: {
  initial?: AccVehicle;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState<VehicleFormData>({
    id: initial?.id,
    name: initial?.name ?? "",
    ratePerKm: initial?.ratePerKm != null ? String(initial.ratePerKm) : "",
    isManualEntry: initial?.isManualEntry ?? false,
    isActive: initial?.isActive ?? true,
    icon: initial?.icon ?? "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("กรุณาระบุชื่อพาหนะ");
      return;
    }
    if (!form.isManualEntry) {
      const rate = Number(form.ratePerKm);
      if (!form.ratePerKm || isNaN(rate) || rate < 1) {
        toast.error("อัตราต้องมีค่า ≥ 1 บาท/กม.");
        return;
      }
    }

    setSaving(true);
    const body: Record<string, unknown> = {
      ...(form.id !== undefined ? { id: form.id } : {}),
      name: form.name.trim(),
      ratePerKm: form.isManualEntry ? null : Number(form.ratePerKm),
      isManualEntry: form.isManualEntry,
      isActive: form.isActive,
      icon: form.icon.trim() || null,
    };
    // Preserve existing order on edit; new rows get appended by the parent.
    if (initial?.sortOrder != null) body.sortOrder = initial.sortOrder;
    await onSave(body);
    setSaving(false);
  };

  return (
    <div
      className="app-overlay fixed inset-0 z-50 flex items-center justify-center"
     
    >
      <div
        className="rounded-2xl w-[440px] max-w-[95vw] overflow-hidden"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-card)",
          boxShadow: "var(--shadow-modal)",
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 flex items-center justify-between"
          style={{ borderBottom: "1px solid var(--border-card)" }}
        >
          <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
            {initial ? "แก้ไขพาหนะ" : "เพิ่มพาหนะใหม่"}
          </h3>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
          >
            <X size={13} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
              ชื่อพาหนะ *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="เช่น รถยนต์ส่วนตัว"
              className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
              style={{
                background: "var(--bg-input)",
                color: "var(--text-primary)",
                border: "1px solid var(--border-input)",
              }}
            />
          </div>

          {/* Icon / emoji */}
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
              ไอคอน (emoji)
            </label>
            <div className="flex items-center gap-2">
              <input
                value={form.icon}
                onChange={(e) => setForm((f) => ({ ...f, icon: e.target.value }))}
                placeholder="🚗"
                maxLength={8}
                className="w-16 rounded-lg px-3 py-2 text-[18px] text-center outline-none"
                style={{
                  background: "var(--bg-input)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-input)",
                }}
              />
              <div className="flex flex-wrap gap-1">
                {ICON_SUGGESTIONS.map((emo) => (
                  <button
                    key={emo}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, icon: emo }))}
                    className="w-8 h-8 rounded-lg text-[16px] cursor-pointer border-none flex items-center justify-center"
                    style={{
                      background: form.icon === emo ? "var(--nav-active-bg)" : "var(--bg-badge)",
                    }}
                    title={emo}
                  >
                    {emo}
                  </button>
                ))}
                {form.icon && (
                  <button
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, icon: "" }))}
                    className="w-8 h-8 rounded-lg text-[12px] cursor-pointer border-none flex items-center justify-center"
                    style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
                    title="ล้าง"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>
            {/* Full emoji picker */}
            <EmojiPickerButton onPick={(emo) => setForm((f) => ({ ...f, icon: emo }))} />
          </div>

          {/* Manual entry toggle */}
          <SettingOption
            checked={form.isManualEntry}
            onChange={(v) => setForm((f) => ({ ...f, isManualEntry: v }))}
            label="กรอกระยะทางเอง"
            description="ไม่ใช้แผนที่ (เช่น Grab / Taxi) — ไม่ต้องระบุอัตราต่อกิโลเมตร"
          />

          {/* Rate per km — hidden when manual */}
          {!form.isManualEntry && (
            <div>
              <label className="block text-[11px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
                อัตราค่าเดินทาง (บาท/กม.) *
              </label>
              <input
                type="number"
                min={1}
                value={form.ratePerKm}
                onChange={(e) => setForm((f) => ({ ...f, ratePerKm: e.target.value }))}
                placeholder="เช่น 4"
                className="w-full rounded-lg px-3 py-2 text-[13px] outline-none"
                style={{
                  background: "var(--bg-input)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-input)",
                }}
              />
            </div>
          )}

          {/* Active toggle */}
          <SettingOption
            checked={form.isActive}
            onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            label="เปิดใช้งาน"
            description="ปิดเพื่อซ่อนพาหนะนี้จากรายการในฟอร์มเบิก AP-1"
          />
        </div>

        {/* Footer */}
        <div
          className="flex gap-2 px-5 py-3"
          style={{ borderTop: "1px solid var(--border-card)", background: "var(--bg-card-alt)" }}
        >
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-medium cursor-pointer border-none"
            style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white flex items-center justify-center gap-1.5"
            style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)", opacity: saving ? 0.6 : 1 }}
          >
            <Check size={12} />
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Sortable vehicle card ── */
function SortableVehicleCard({
  v, onEdit, disabled,
}: {
  v: AccVehicle;
  onEdit: (v: AccVehicle) => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: v.id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
    background: isDragging ? "var(--bg-card-alt)" : "var(--bg-card)",
    border: "1px solid var(--border-card)",
    boxShadow: isDragging ? "var(--shadow-lg)" : "var(--shadow-sm)",
    opacity: v.isActive ? 1 : 0.6,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 rounded-2xl pl-1.5 pr-3 py-2.5 transition-all hover:-translate-y-[1px] hover:shadow-md"
    >
      {/* Drag handle (hidden while filtering — order applies to the full list) */}
      {disabled ? (
        <div className="shrink-0 w-6" />
      ) : (
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
      )}

      {/* Emoji avatar */}
      <div
        className="shrink-0 w-11 h-11 rounded-xl flex items-center justify-center text-[22px] leading-none"
        style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
      >
        {v.icon ? <span>{v.icon}</span> : <Car size={20} />}
      </div>

      {/* Name + meta */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
          {v.name}
        </p>
        <div className="mt-1">
          {v.isManualEntry ? (
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#eaf0fb", color: "#6f93da" }}>
              กรอกระยะทางเอง
            </span>
          ) : (
            <span className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full" style={{ background: "#eaf0fb", color: "#6f93da" }}>
              ฿{v.ratePerKm ?? 0} / กม.
            </span>
          )}
        </div>
      </div>

      {/* Status pill */}
      {v.isActive ? (
        <span className="shrink-0 text-[10.5px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "#e4f4ea", color: "#4fa37a" }}>
          ใช้งาน
        </span>
      ) : (
        <span className="shrink-0 text-[10.5px] font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--bg-badge)", color: "var(--text-faint)" }}>
          ปิด
        </span>
      )}

      {/* Edit */}
      <button
        onClick={() => onEdit(v)}
        className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer border-none opacity-60 group-hover:opacity-100 transition-opacity"
        style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
        title="แก้ไข"
      >
        <Pencil size={13} />
      </button>
    </div>
  );
}

/* ── Main Component ── */
export function VehicleSettings() {
  const { data, mutate } = useSWR<{ ok: boolean; data: AccVehicle[] }>(
    "/api/request/accounting/settings/vehicles",
    fetcher,
  );
  const [editVehicle, setEditVehicle] = useState<AccVehicle | null | "new">(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "rate" | "manual">("all");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const vehicles = data?.data ?? [];
  const q = search.trim().toLowerCase();
  const isFiltering = !!q || statusFilter !== "all" || typeFilter !== "all";
  const filtered = vehicles.filter((v) => {
    if (statusFilter === "active" && !v.isActive) return false;
    if (statusFilter === "inactive" && v.isActive) return false;
    if (typeFilter === "rate" && v.isManualEntry) return false;
    if (typeFilter === "manual" && !v.isManualEntry) return false;
    if (!q) return true;
    return v.name.toLowerCase().includes(q);
  });

  const handleSave = async (body: Record<string, unknown>) => {
    // New vehicles (no sortOrder from the dialog) append to the end of the list.
    if (body.sortOrder === undefined) {
      body.sortOrder = vehicles.reduce((m, v) => Math.max(m, v.sortOrder), -1) + 1;
    }
    const res = await fetch("/api/request/accounting/settings/vehicles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("บันทึกสำเร็จ");
      mutate();
      setEditVehicle(null);
    } else {
      toast.error(json.error ?? "บันทึกไม่สำเร็จ");
    }
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = vehicles.findIndex((v) => v.id === active.id);
    const newIndex = vehicles.findIndex((v) => v.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(vehicles, oldIndex, newIndex).map((v, i) => ({
      ...v,
      sortOrder: i,
    }));
    // Optimistic update, then persist.
    mutate({ ok: true, data: reordered }, false);
    fetch("/api/request/accounting/settings/vehicles/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: reordered.map((v) => v.id) }),
    })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) toast.success("เรียงลำดับใหม่แล้ว");
        else toast.error(j.error ?? "เรียงลำดับไม่สำเร็จ");
        mutate();
      })
      .catch(() => {
        toast.error("เรียงลำดับไม่สำเร็จ");
        mutate();
      });
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <p className="text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
            พาหนะ &amp; เรทค่าเดินทาง
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {vehicles.filter((v) => v.isActive).length} ใช้งาน · {vehicles.length} ทั้งหมด · ลากเพื่อจัดลำดับ
          </p>
        </div>
        <button
          onClick={() => setEditVehicle("new")}
          className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-2.5 rounded-xl cursor-pointer border-none text-white shrink-0 transition-transform hover:-translate-y-[1px]"
          style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
        >
          <Plus size={14} /> เพิ่มพาหนะ
        </button>
      </div>

      {/* Search + filter */}
      {vehicles.length > 0 && (
        <SettingsFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="ค้นหาชื่อพาหนะ..."
          groups={[
            {
              value: statusFilter,
              onChange: (v) => setStatusFilter(v as "all" | "active" | "inactive"),
              options: [
                { value: "all", label: "ทั้งหมด" },
                { value: "active", label: "ใช้งาน" },
                { value: "inactive", label: "ปิด" },
              ],
            },
            {
              value: typeFilter,
              onChange: (v) => setTypeFilter(v as "all" | "rate" | "manual"),
              options: [
                { value: "all", label: "ทุกประเภท" },
                { value: "rate", label: "ตามระยะทาง" },
                { value: "manual", label: "กรอกเอง" },
              ],
            },
          ]}
        />
      )}

      {/* List */}
      {vehicles.length === 0 ? (
        <div
          className="rounded-2xl py-14 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-card)" }}
        >
          <p className="text-[30px] mb-2">🚗</p>
          <p className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
            ยังไม่มีพาหนะ
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-faint)" }}>
            กด “เพิ่มพาหนะ” เพื่อเริ่มต้น
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl py-12 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-card)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            ไม่พบพาหนะที่ตรงกับการค้นหา
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map((v) => v.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {filtered.map((v) => (
                <SortableVehicleCard key={v.id} v={v} onEdit={setEditVehicle} disabled={isFiltering} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Dialog */}
      {editVehicle !== null && (
        <VehicleDialog
          initial={editVehicle === "new" ? undefined : editVehicle}
          onClose={() => setEditVehicle(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
