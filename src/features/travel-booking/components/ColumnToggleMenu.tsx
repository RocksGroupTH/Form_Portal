"use client";

import { useState } from "react";
import { Columns3, GripVertical } from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { SelectAllRow } from "@/features/travel-booking/components/MultiSelectFilter";

export interface ColumnToggleOption<K extends string> {
  key: K;
  label: string;
}

/** One row of the list, draggable only when the menu is in reorder mode. */
function SortableRow<K extends string>({
  col, checked, onToggle,
}: {
  col: ColumnToggleOption<K>;
  checked: boolean;
  onToggle: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col.key });

  return (
    <div
      ref={setNodeRef}
      className="flex items-center gap-1.5 px-1 py-1.5 rounded-lg text-[12px]"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        background: isDragging ? "var(--bg-card-alt)" : undefined,
        zIndex: isDragging ? 5 : undefined,
        position: isDragging ? "relative" : undefined,
      }}
    >
      {/* The handle carries the drag listeners, not the row: dragging from the
          label would make the checkbox unclickable. */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`ย้ายคอลัมน์ ${col.label}`}
        className="cursor-grab border-none bg-transparent p-0.5 shrink-0"
        style={{ color: "var(--text-faint)", touchAction: "none" }}
      >
        <GripVertical size={13} />
      </button>
      <label className="flex items-center gap-2 cursor-pointer grow" style={{ color: "var(--text-primary)" }}>
        <input type="checkbox" checked={checked} onChange={onToggle} className="rounded" />
        {col.label}
      </label>
    </div>
  );
}

/**
 * Generic show/hide-columns dropdown — a button that opens a checkbox list.
 * Deliberately a plain absolute-positioned panel (no portal, not a Radix menu),
 * factored out here so any AP-17 report table can reuse it.
 *
 * Pass `onReorder` to also let the reader drag the columns into their own
 * order. Without it the list renders exactly as it always has, which is what
 * every existing caller gets — the drag handles and the sensors only exist when
 * a caller has somewhere to put the new order.
 */
export function ColumnToggleMenu<K extends string>({
  columns,
  visible,
  onChange,
  onReorder,
  label = "คอลัมน์",
}: {
  columns: ColumnToggleOption<K>[];
  visible: Record<K, boolean>;
  onChange: (next: Record<K, boolean>) => void;
  /** Given the full key list in its new order. Omit to keep the list fixed. */
  onReorder?: (keys: K[]) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // A short distance so a click on the handle is still a click, and the
  // keyboard sensor so reordering is not mouse-only.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const keys = columns.map((c) => c.key);
    const from = keys.indexOf(active.id as K);
    const to = keys.indexOf(over.id as K);
    if (from < 0 || to < 0) return;
    onReorder?.(arrayMove(keys, from, to));
  }

  function toggle(key: K) {
    onChange({ ...visible, [key]: !(visible[key] ?? true) });
  }

  const shownCount = columns.filter((c) => visible[c.key] ?? true).length;
  const allShown = shownCount === columns.length;

  function toggleAll() {
    const next = {} as Record<K, boolean>;
    for (const c of columns) next[c.key] = !allShown;
    onChange(next);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer border-none transition-colors"
        style={{
          background: open ? "var(--nav-active-bg)" : "var(--bg-badge)",
          color: open ? "var(--nav-active-text)" : "var(--text-secondary)",
        }}
        title="แสดง/ซ่อนคอลัมน์"
      >
        <Columns3 size={13} />
        {label}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div
            className="absolute top-full right-0 mt-1 z-30 rounded-xl p-2 min-w-[220px] max-h-[360px] overflow-y-auto shadow-lg"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
          >
            <SelectAllRow checked={allShown} partial={shownCount > 0 && !allShown} onToggle={toggleAll} />
            <div className="my-1" style={{ borderTop: "1px solid var(--border-light)" }} />
            {onReorder ? (
              <>
                <p className="text-[10px] px-2 pb-1 m-0" style={{ color: "var(--text-faint)" }}>
                  ลากที่จุดจับเพื่อสลับลำดับคอลัมน์
                </p>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={columns.map((c) => c.key)} strategy={verticalListSortingStrategy}>
                    {columns.map((col) => (
                      <SortableRow
                        key={col.key}
                        col={col}
                        checked={visible[col.key] ?? true}
                        onToggle={() => toggle(col.key)}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              </>
            ) : (
              columns.map((col) => (
                <label
                  key={col.key}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer text-[12px]"
                  style={{ color: "var(--text-primary)" }}
                >
                  <input
                    type="checkbox"
                    checked={visible[col.key] ?? true}
                    onChange={() => toggle(col.key)}
                    className="rounded"
                  />
                  {col.label}
                </label>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
