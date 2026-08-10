"use client";

/**
 * Progress strip — two distinct visual modes that no longer stack on
 * top of each other:
 *
 *   1. Determinate (`progress` provided)  →  ONE solid accent-coloured
 *      fill bar that grows from 0 → 100%. No sweep animations: the
 *      fill itself is the affordance.
 *
 *   2. Indeterminate (`progress` undefined)  →  ONE GPU-friendly
 *      sweep travelling across the track. No fill bar underneath.
 */
export function TopProgressBar({
  active,
  progress,
}: {
  active: boolean;
  progress?: number;
}) {
  const isDeterminate = typeof progress === "number";
  const pct = isDeterminate
    ? Math.max(0, Math.min(1, progress as number)) * 100
    : 0;

  return (
    <div
      aria-hidden={!active ? "true" : "false"}
      className={`relative h-[3px] w-full overflow-hidden rounded transition-opacity duration-200 ${
        active ? "opacity-100" : "opacity-0"
      }`}
      style={{ background: "var(--border)" }}
    >
      {isDeterminate ? (
        // Solid fill bar — single layer.
        <div
          className="absolute top-0 bottom-0 left-0 rounded"
          style={{
            width: `${pct}%`,
            background: "var(--accent)",
            transition: "width 220ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "width",
          }}
        />
      ) : (
        // Indeterminate shimmer — single sweep.
        <div
          className="absolute top-0 bottom-0 left-0 rounded"
          style={{
            width: "30%",
            background:
              "linear-gradient(90deg, transparent, var(--accent) 35%, #f59e0b 50%, var(--accent) 65%, transparent)",
            animation: active
              ? "topProgressSweepA 1.4s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite"
              : undefined,
            willChange: "transform",
          }}
        />
      )}
      <style>{`
        @keyframes topProgressSweepA {
          0%   { transform: translate3d(-110%, 0, 0); }
          100% { transform: translate3d(440%, 0, 0); }
        }
      `}</style>
    </div>
  );
}
