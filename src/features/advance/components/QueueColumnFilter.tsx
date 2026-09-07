"use client";

/**
 * One header-row filter cell: a text box, or a select that accumulates picks as
 * removable chips so a queue can be narrowed to two companies at once.
 *
 * Multi-value filters are stored as a CSV string in one map keyed by column,
 * matching how the AP-2-Control report holds its filters — one shape for both
 * kinds keeps the filtering loop a single pass over the columns.
 */

export function QueueColumnFilter({
  kind, value, options, onChange,
}: {
  kind: "text" | "select";
  /** CSV for a select, plain text for a text filter. */
  value: string;
  options?: string[];
  onChange: (next: string) => void;
}) {
  const chips = value.split(",").filter(Boolean);

  const inputClass = "text-[11px] rounded-md px-1.5 py-1 outline-none w-full";
  const inputStyle = {
    background: "var(--bg-input)",
    border: "1px solid var(--border-input)",
    color: "var(--text-primary)",
  } as const;

  if (kind === "text") {
    return (
      // size={1} drops the input's intrinsic width so the column is sized by its
      // data rather than by the filter box.
      <input value={value} onChange={(e) => onChange(e.target.value)} size={1}
        placeholder="กรอง..." className={inputClass} style={inputStyle} />
    );
  }

  return (
    <div className="flex flex-col gap-1 min-w-[92px]">
      <select value="" className={inputClass} style={inputStyle}
        onChange={(e) => {
          const v = e.target.value;
          e.target.value = "";
          if (v && !chips.includes(v)) onChange([...chips, v].join(","));
        }}>
        <option value="">ทั้งหมด</option>
        {(options ?? []).filter((o) => !chips.includes(o)).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((c) => (
            <span key={c} className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}>
              {c}
              <button type="button" aria-label={`ลบตัวกรอง ${c}`}
                onClick={() => onChange(chips.filter((x) => x !== c).join(","))}
                className="border-none bg-transparent cursor-pointer p-0 leading-none"
                style={{ color: "inherit" }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
