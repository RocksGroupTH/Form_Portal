"use client";

import { useState } from "react";
import useSWR from "swr";
import { Plus, Pencil, X, Check, GripVertical, Tag, Trash2 } from "lucide-react";
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
import { SettingsFilterBar } from "@/features/accounting/components/settings/SettingsFilterBar";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

/** One of the 4 AP-17 settings tables — matches the `[kind]` URL segment under `/api/request/travel-booking/settings`. */
export type TravelOptionKind = "reasons" | "accommodations" | "vehicles" | "rent-vehicles";

interface TravelOptionRow {
  id: number;
  name: string;
  isActive: boolean;
  sortOrder: number;
  requiresCustomReason: boolean;
  icon: string | null;
  // Accommodations ("ที่พัก") tab only — selecting it flags the request for Admin room booking.
  needsRoomBooking?: boolean;
  // Rent-vehicles ("เช่ายานพาหนะ") tab only — selecting it flags the request for Admin to arrange the rental.
  needsRentBooking?: boolean;
  // Vehicles ("การเดินทาง") tab only — config that drives the requester form.
  needsDepartureLocations?: boolean;
  needsTicketBooking?: boolean;
  needsDepartTime?: boolean;
  needsVehicleRent?: boolean;
  places?: { id: number; name: string; sortOrder: number }[];
}

/** Emoji suggestions per tab — each list is relevant to its topic (reasons / accommodation / vehicle / rent). */
const ICON_SUGGESTIONS: Record<TravelOptionKind, string[]> = {
  reasons: [
    "🔍", "🗺️", "🏢", "🏗️", "🎉", "🛠️", "🎨", "🔒", "📋", "🔎",
    "🎓", "📚", "🧑‍🏫", "📦", "🧮", "📊", "🍽️", "🎪", "🤝", "📣",
    "🎯", "🏪", "🧭", "📌", "📝",
  ],
  accommodations: ["🏨", "🏠", "🏢", "🏡", "🛏️", "⛺", "🏘️", "🗺️", "🚫"],
  vehicles: ["🚗", "🚕", "🚙", "🚐", "🚌", "🚆", "🚄", "✈️", "🛥️", "🚫"],
  "rent-vehicles": ["🚗", "🏍️", "🛵", "🚙", "🚐", "🚕", "🚌", "🚲", "🛺", "🚫"],
};

/* ── Row Dialog (add/edit) ── */
function OptionDialog({
  initial,
  titleAdd,
  titleEdit,
  namePlaceholder,
  iconSuggestions,
  isVehicle,
  isAccommodation,
  isRentVehicle,
  onClose,
  onSave,
}: {
  initial?: TravelOptionRow;
  titleAdd: string;
  titleEdit: string;
  namePlaceholder: string;
  iconSuggestions: string[];
  /** Vehicles ("การเดินทาง") tab: swap the custom-reason toggle for the travel-config fields. */
  isVehicle: boolean;
  /** Accommodations ("ที่พัก") tab: swap the custom-reason toggle for the room-booking checkbox. */
  isAccommodation: boolean;
  /** Rent-vehicles ("เช่ายานพาหนะ") tab: swap the custom-reason toggle for the rent-booking checkbox. */
  isRentVehicle: boolean;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    id: initial?.id,
    name: initial?.name ?? "",
    isActive: initial?.isActive ?? true,
    requiresCustomReason: initial?.requiresCustomReason ?? false,
    icon: initial?.icon ?? "",
    // accommodation-only config
    needsRoomBooking: initial?.needsRoomBooking ?? false,
    // rent-vehicle-only config
    needsRentBooking: initial?.needsRentBooking ?? false,
    // vehicle-only config — ticket booking drives departure locations + depart time too
    needsTicketBooking: initial?.needsTicketBooking ?? false,
    needsVehicleRent: initial?.needsVehicleRent ?? false,
    places: (initial?.places ?? []).map((p) => p.name),
  });
  const [saving, setSaving] = useState(false);

  const setPlace = (idx: number, val: string) =>
    setForm((f) => ({ ...f, places: f.places.map((p, i) => (i === idx ? val : p)) }));
  const addPlace = () => setForm((f) => ({ ...f, places: [...f.places, ""] }));
  const removePlace = (idx: number) =>
    setForm((f) => ({ ...f, places: f.places.filter((_, i) => i !== idx) }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      toast.error("กรุณาระบุชื่อรายการ");
      return;
    }
    setSaving(true);
    const body: Record<string, unknown> = {
      ...(form.id !== undefined ? { id: form.id } : {}),
      name: form.name.trim(),
      isActive: form.isActive,
      icon: form.icon.trim() || null,
    };
    if (isVehicle) {
      // Ticket booking implies a pickup point + a depart time — all follow one checkbox.
      body.needsTicketBooking = form.needsTicketBooking;
      body.needsDepartureLocations = form.needsTicketBooking;
      body.needsDepartTime = form.needsTicketBooking;
      body.needsVehicleRent = form.needsVehicleRent;
      body.places = form.needsTicketBooking ? form.places.map((p) => p.trim()).filter(Boolean) : [];
    } else if (isAccommodation) {
      body.needsRoomBooking = form.needsRoomBooking;
    } else if (isRentVehicle) {
      body.needsRentBooking = form.needsRentBooking;
    } else {
      body.requiresCustomReason = form.requiresCustomReason;
    }
    // Preserve existing order on edit; new rows get appended by the parent.
    if (initial?.sortOrder != null) body.sortOrder = initial.sortOrder;
    await onSave(body);
    setSaving(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "var(--overlay-bg)" }}
    >
      <div
        className={`rounded-2xl ${isVehicle ? "w-[560px]" : "w-[440px]"} max-w-[95vw] max-h-[90vh] flex flex-col overflow-hidden`}
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
            {initial ? titleEdit : titleAdd}
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
        <div className="px-5 py-4 flex flex-col gap-4 flex-1 min-h-0 overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-[11px] font-semibold mb-1" style={{ color: "var(--text-muted)" }}>
              ชื่อรายการ *
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder={namePlaceholder}
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
                placeholder={iconSuggestions[0] ?? "🧭"}
                maxLength={8}
                className="w-16 rounded-lg px-3 py-2 text-[18px] text-center outline-none"
                style={{
                  background: "var(--bg-input)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-input)",
                }}
              />
              <div className="flex flex-wrap gap-1">
                {iconSuggestions.map((emo) => (
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

          {isVehicle ? (
            <>
              {/* Admin ticket booking — implies pickup point + depart time (ข้อ11–13 รวมกัน) */}
              <div>
                <SettingOption
                  variant="checkbox"
                  checked={form.needsTicketBooking}
                  onChange={(v) => setForm((f) => ({ ...f, needsTicketBooking: v }))}
                  label="ให้ Admin จองตั๋ว / ที่นั่ง"
                  description="ทีม Admin จองตั๋วให้ + ผู้ขอต้องระบุจุดขึ้น/สถานที่ และเวลาออกเดินทาง"
                />
                {form.needsTicketBooking && (
                  <div className="mt-2 flex flex-col gap-2 pl-1">
                    <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      จุดขึ้น/สถานที่ (ตัวเลือกด่วน — ผู้ขอค้นหาเพิ่มเองได้)
                    </p>
                    {(form.places.length ? form.places : [""]).map((p, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input
                          value={p}
                          onChange={(e) => (form.places.length ? setPlace(idx, e.target.value) : setForm((f) => ({ ...f, places: [e.target.value] })))}
                          placeholder="เช่น สุวรรณภูมิ (BKK)"
                          className="flex-1 rounded-lg px-3 py-2 text-[13px] outline-none"
                          style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                        />
                        <button
                          type="button"
                          onClick={() => removePlace(idx)}
                          disabled={form.places.length <= 1 && !p.trim()}
                          aria-label="ลบสถานที่นี้"
                          title="ลบสถานที่นี้"
                          className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-muted)" }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addPlace}
                      className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12.5px] font-medium cursor-pointer"
                      style={{ border: "1px dashed var(--border-card)", background: "transparent", color: "var(--text-muted)" }}
                    >
                      <Plus size={13} /> เพิ่มสถานที่
                    </button>
                  </div>
                )}
              </div>

              {/* Vehicle rent (12.4) */}
              <SettingOption
                variant="checkbox"
                checked={form.needsVehicleRent}
                onChange={(v) => setForm((f) => ({ ...f, needsVehicleRent: v }))}
                label="ต้องการเช่ารถ"
                description="เปิดส่วนเช่ายานพาหนะในฟอร์ม"
              />
            </>
          ) : isAccommodation ? (
            /* Admin room booking (12.x — ที่พัก) */
            <SettingOption
              variant="checkbox"
              checked={form.needsRoomBooking}
              onChange={(v) => setForm((f) => ({ ...f, needsRoomBooking: v }))}
              label="ให้ Admin จองห้อง"
              description="เมื่อเลือกที่พักนี้ ทีม Admin จะเป็นผู้จองห้องพักให้"
            />
          ) : isRentVehicle ? (
            /* Admin rental arrangement (ข้อ15 — เช่ายานพาหนะ) */
            <SettingOption
              variant="checkbox"
              checked={form.needsRentBooking}
              onChange={(v) => setForm((f) => ({ ...f, needsRentBooking: v }))}
              label="ให้ Admin เช่ายานพาหนะ"
              description="เมื่อเลือกรายการนี้ ทีม Admin จะเป็นผู้จัดการเช่ายานพาหนะให้"
            />
          ) : (
            /* Requires custom reason toggle */
            <SettingOption
              variant="checkbox"
              checked={form.requiresCustomReason}
              onChange={(v) => setForm((f) => ({ ...f, requiresCustomReason: v }))}
              label="ต้องระบุเหตุผลเอง"
              description="เมื่อเลือกรายการนี้ ผู้ขอต้องกรอกรายละเอียดเพิ่มเติมเองในฟอร์ม (ช่องข้อความอิสระ)"
            />
          )}

          {/* Active toggle */}
          <SettingOption
            checked={form.isActive}
            onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
            label="เปิดใช้งาน"
            description="ปิดเพื่อซ่อนรายการนี้จากฟอร์มขอเดินทาง AP-17"
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
            style={{ background: "var(--color-action)", opacity: saving ? 0.6 : 1 }}
          >
            <Check size={12} />
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small pill used for vehicle config badges on the card. */
function ConfigBadge({ label }: { label: string }) {
  return (
    <span
      className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "#eaf0fb", color: "#6f93da" }}
    >
      {label}
    </span>
  );
}

/* ── Sortable row card ── */
function SortableOptionCard({
  row, onEdit, disabled, isVehicle, isAccommodation, isRentVehicle,
}: {
  row: TravelOptionRow;
  onEdit: (row: TravelOptionRow) => void;
  disabled?: boolean;
  isVehicle: boolean;
  isAccommodation: boolean;
  isRentVehicle: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.id, disabled });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
    background: isDragging ? "var(--bg-card-alt)" : "var(--bg-card)",
    border: "1px solid var(--border-card)",
    boxShadow: isDragging ? "var(--shadow-lg)" : "var(--shadow-sm)",
    opacity: row.isActive ? 1 : 0.6,
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
        {row.icon ? <span>{row.icon}</span> : <Tag size={18} />}
      </div>

      {/* Name + badges */}
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
          {row.name}
        </p>
        {isVehicle ? (
          (row.needsTicketBooking || row.needsVehicleRent) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {row.needsTicketBooking && <ConfigBadge label={`🎫 จองตั๋ว + จุดขึ้น${row.places?.length ? ` (${row.places.length})` : ""} + เวลา`} />}
              {row.needsVehicleRent && <ConfigBadge label="🚙 เช่ารถ" />}
            </div>
          )
        ) : isAccommodation ? (
          row.needsRoomBooking && (
            <div className="mt-1">
              <ConfigBadge label="🛏️ จองห้อง" />
            </div>
          )
        ) : isRentVehicle ? (
          row.needsRentBooking && (
            <div className="mt-1">
              <ConfigBadge label="🚗 Admin เช่าให้" />
            </div>
          )
        ) : (
          row.requiresCustomReason && (
            <div className="mt-1">
              <ConfigBadge label="ต้องระบุเหตุผลเอง" />
            </div>
          )
        )}
      </div>

      {/* Status pill */}
      {row.isActive ? (
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
        onClick={() => onEdit(row)}
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
export function TravelOptionSettings({
  kind,
  label,
  addLabel,
  namePlaceholder,
  emptyIcon = "📋",
  emptyLabel,
}: {
  /** URL segment for `/api/request/travel-booking/settings/[kind]`. */
  kind: TravelOptionKind;
  /** Thai display name for this list, e.g. "เหตุผลการเดินทาง". */
  label: string;
  /** Label on the "add" button, e.g. "เพิ่มเหตุผล". */
  addLabel: string;
  namePlaceholder: string;
  emptyIcon?: string;
  emptyLabel: string;
}) {
  const apiBase = `/api/request/travel-booking/settings/${kind}`;
  const isVehicle = kind === "vehicles";
  const isAccommodation = kind === "accommodations";
  const isRentVehicle = kind === "rent-vehicles";
  const { data, mutate } = useSWR<{ ok: boolean; data: TravelOptionRow[] }>(apiBase, fetcher);
  const [editRow, setEditRow] = useState<TravelOptionRow | null | "new">(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const rows = data?.data ?? [];
  const q = search.trim().toLowerCase();
  const isFiltering = !!q || statusFilter !== "all";
  const filtered = rows.filter((r) => {
    if (statusFilter === "active" && !r.isActive) return false;
    if (statusFilter === "inactive" && r.isActive) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q);
  });

  const handleSave = async (body: Record<string, unknown>) => {
    // New rows (no sortOrder from the dialog) append to the end of the list.
    if (body.sortOrder === undefined) {
      body.sortOrder = rows.reduce((m, r) => Math.max(m, r.sortOrder), -1) + 1;
    }
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (json.ok) {
      toast.success("บันทึกสำเร็จ");
      mutate();
      setEditRow(null);
    } else {
      toast.error(json.error ?? "บันทึกไม่สำเร็จ");
    }
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = rows.findIndex((r) => r.id === active.id);
    const newIndex = rows.findIndex((r) => r.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(rows, oldIndex, newIndex).map((r, i) => ({
      ...r,
      sortOrder: i,
    }));
    // Optimistic update, then persist.
    mutate({ ok: true, data: reordered }, false);
    fetch(`${apiBase}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: reordered.map((r) => r.id) }),
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
            {label}
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            {rows.filter((r) => r.isActive).length} ใช้งาน · {rows.length} ทั้งหมด · ลากเพื่อจัดลำดับ
          </p>
        </div>
        <button
          onClick={() => setEditRow("new")}
          className="flex items-center gap-1.5 text-[12px] font-bold px-4 py-2.5 rounded-xl cursor-pointer border-none text-white shrink-0 transition-transform hover:-translate-y-[1px]"
          style={{ background: "var(--color-action)" }}
        >
          <Plus size={14} /> {addLabel}
        </button>
      </div>

      {/* Search + filter */}
      {rows.length > 0 && (
        <SettingsFilterBar
          search={search}
          onSearch={setSearch}
          placeholder="ค้นหาชื่อรายการ..."
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
          ]}
        />
      )}

      {/* List */}
      {rows.length === 0 ? (
        <div
          className="rounded-2xl py-14 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-card)" }}
        >
          <p className="text-[30px] mb-2">{emptyIcon}</p>
          <p className="text-[13px] font-medium" style={{ color: "var(--text-secondary)" }}>
            {emptyLabel}
          </p>
          <p className="text-[11px] mt-1" style={{ color: "var(--text-faint)" }}>
            กด &quot;{addLabel}&quot; เพื่อเริ่มต้น
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-2xl py-12 text-center"
          style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-card)" }}
        >
          <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
            ไม่พบรายการที่ตรงกับการค้นหา
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={filtered.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {filtered.map((r) => (
                <SortableOptionCard key={r.id} row={r} onEdit={setEditRow} disabled={isFiltering} isVehicle={isVehicle} isAccommodation={isAccommodation} isRentVehicle={isRentVehicle} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Dialog */}
      {editRow !== null && (
        <OptionDialog
          initial={editRow === "new" ? undefined : editRow}
          titleAdd={addLabel}
          titleEdit={`แก้ไข${label}`}
          namePlaceholder={namePlaceholder}
          iconSuggestions={ICON_SUGGESTIONS[kind]}
          isVehicle={isVehicle}
          isAccommodation={isAccommodation}
          isRentVehicle={isRentVehicle}
          onClose={() => setEditRow(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
