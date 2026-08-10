"use client";

interface QuickDateFilterProps {
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}

function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  const mon = new Date(d);
  mon.setDate(mon.getDate() - diff);
  return mon;
}

const PRESETS: { label: string; getRange: () => [string, string] }[] = [
  {
    label: "Today",
    getRange: () => { const t = fmt(new Date()); return [t, t]; },
  },
  {
    label: "Yesterday",
    getRange: () => { const y = new Date(); y.setDate(y.getDate() - 1); const s = fmt(y); return [s, s]; },
  },
  {
    label: "SDLW",
    getRange: () => {
      const y = new Date(); y.setDate(y.getDate() - 1);
      const lw = new Date(y); lw.setDate(lw.getDate() - 7);
      return [fmt(lw), fmt(lw)];
    },
  },
  {
    label: "This Week",
    getRange: () => { const now = new Date(); return [fmt(getMonday(now)), fmt(now)]; },
  },
  {
    label: "Last Week",
    getRange: () => {
      const now = new Date();
      const thisMon = getMonday(now);
      const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
      const lastSun = new Date(thisMon); lastSun.setDate(lastSun.getDate() - 1);
      return [fmt(lastMon), fmt(lastSun)];
    },
  },
  {
    label: "This Month",
    getRange: () => { const now = new Date(); return [fmt(new Date(now.getFullYear(), now.getMonth(), 1)), fmt(now)]; },
  },
  {
    label: "Last Month",
    getRange: () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return [fmt(first), fmt(last)];
    },
  },
];

export function QuickDateFilter({ from, to, onFromChange, onToChange }: QuickDateFilterProps) {
  const isActive = (preset: typeof PRESETS[number]) => {
    const [pFrom, pTo] = preset.getRange();
    return from === pFrom && to === pTo;
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => { const [f, t] = p.getRange(); onFromChange(f); onToChange(t); }}
          className="text-[11px] font-medium px-2 py-1 rounded-lg cursor-pointer border-none transition-colors"
          style={{
            background: isActive(p) ? "var(--nav-active-bg)" : "var(--bg-badge)",
            color: isActive(p) ? "var(--nav-active-text)" : "var(--text-muted)",
          }}
        >
          {p.label}
        </button>
      ))}
      <input
        type="date"
        value={from}
        onChange={(e) => onFromChange(e.target.value)}
        className="hidden sm:block rounded-lg px-2 py-1 text-[11px] outline-none"
        style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
      />
      <span className="hidden sm:inline text-[11px]" style={{ color: "var(--text-muted)" }}>to</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className="hidden sm:block rounded-lg px-2 py-1 text-[11px] outline-none"
        style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
      />
    </div>
  );
}
