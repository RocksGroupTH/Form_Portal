"use client";

import React from "react";
import { FIELD_TYPES } from "../constants";
import type { FieldType } from "../types";
import {
  Type, AlignLeft, Hash, Calendar, ChevronDown, Circle,
  CheckSquare, Upload, Navigation, Minus, Info,
} from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number }>> = {
  Type, AlignLeft, Hash, Calendar, ChevronDown, Circle,
  CheckSquare, Upload, Navigation, Minus, Info,
};

interface FieldPaletteProps {
  onAdd: (type: FieldType) => void;
}

export function FieldPalette({ onAdd }: FieldPaletteProps) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-bold mb-1 px-1" style={{ color: "var(--text-muted)" }}>
        FIELD TYPES
      </p>
      {FIELD_TYPES.map((ft) => {
        const Icon = ICON_MAP[ft.icon];
        return (
          <button
            key={ft.type}
            onClick={() => onAdd(ft.type)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[12px] cursor-pointer transition-colors text-left"
            style={{
              background: "transparent",
              color: "var(--text-secondary)",
              border: "1px solid transparent",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--bg-card-hover)";
              e.currentTarget.style.borderColor = "var(--border-card)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "transparent";
            }}
          >
            {Icon && <Icon size={14} />}
            {ft.label}
          </button>
        );
      })}
    </div>
  );
}
