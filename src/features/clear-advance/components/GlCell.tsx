"use client";

import React from "react";
import { GlPicker } from "@/features/clear-advance/components/LinePickers";
import { FORCE_GL_NON_ROCKS_PC } from "@/features/clear-advance/constants";
import { glOptionsForLine } from "@/features/clear-advance/hooks/useGlOptionsByBranch";
import type { GlAccountOption } from "@/features/clear-advance/types";

/**
 * The "รายการ" cell — the G/L account one expense line is charged to.
 *
 * Two shapes, and which one shows is not the caller's decision to make. A
 * non-home brand has every line forced to FORCE_GL_NON_ROCKS_PC at save time
 * in `persistClear`, so offering a picker there would invite a choice the
 * server discards. Everywhere else the branch decides the list, which is why
 * the picker stays disabled until a branch is on the line.
 */
export function GlCell({
  line,
  optionsByBranch,
  glForced,
  disabled,
  onPick,
}: {
  line: { branchCode?: string | null; glAccountNo?: string | null; glAccountName?: string | null };
  optionsByBranch: Record<string, GlAccountOption[]>;
  glForced: boolean;
  disabled?: boolean;
  onPick: (o: GlAccountOption | null) => void;
}) {
  if (glForced) {
    return (
      <div
        className="text-[12px] px-2 py-1.5 rounded-lg"
        style={{ background: "var(--bg-card-alt)", color: "var(--text-muted)", border: "1px dashed var(--border-card)" }}
      >
        {FORCE_GL_NON_ROCKS_PC} · เงินจ่ายแทนบริษัทอื่น
      </div>
    );
  }
  return (
    <GlPicker
      options={glOptionsForLine(optionsByBranch, line)}
      valueNo={line.glAccountNo ?? ""}
      disabled={disabled || !line.branchCode}
      noBranch={!line.branchCode}
      onPick={onPick}
    />
  );
}
