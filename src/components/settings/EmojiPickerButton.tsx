"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Smile } from "lucide-react";

/** Full emoji picker dataset — grouped by Thai category. */
const EMOJI_GROUPS: { label: string; emojis: string[] }[] = [
  {
    label: "เดินทาง & สถานที่",
    emojis: [
      "🚗", "🚕", "🚙", "🚐", "🚌", "🚎", "🏎️", "🚓", "🚑", "🚒", "🚚", "🚛", "🚜",
      "🏍️", "🛵", "🚲", "🛺", "🚔", "🚍", "🚝", "🚄", "🚅", "🚈", "🚂", "🚆", "🚇", "🚊", "🚉",
      "✈️", "🛫", "🛬", "🛩️", "💺", "🚁", "🚀", "🛸", "🛥️", "⛴️", "🚢", "⛵", "🛶",
      "🗺️", "🧭", "⛽", "🚏", "🛣️", "🛤️", "🧳", "🎫", "🛂", "🛃",
    ],
  },
  {
    label: "อาคาร & ที่พัก",
    emojis: [
      "🏢", "🏬", "🏭", "🏗️", "🏠", "🏡", "🏘️", "🏚️", "🏦", "🏨", "🏪", "🏫", "🏥",
      "🏛️", "⛪", "🕌", "🏩", "🏯", "🏰", "⛺", "🏕️", "🏙️", "🌆", "🏞️", "🗼", "🗽",
      "🛏️", "🛋️", "🚪", "🏟️",
    ],
  },
  {
    label: "งาน & เอกสาร",
    emojis: [
      "💼", "📁", "📂", "🗂️", "📋", "📝", "📄", "📃", "📑", "🧾", "📊", "📈", "📉",
      "📅", "📆", "🗓️", "📌", "📍", "✏️", "🖊️", "🖋️", "🔍", "🔎", "🔒", "🔓", "🔑", "🗝️",
      "🛠️", "🔧", "🔨", "⚙️", "🧰", "📐", "📏", "🗃️", "🗄️", "🖥️", "💻", "⌨️", "🖨️", "☎️", "📞", "📠", "🖇️", "📎",
    ],
  },
  {
    label: "กิจกรรม & อื่นๆ",
    emojis: [
      "🎉", "🎊", "🎈", "🎪", "🎭", "🎨", "🎬", "🎤", "🎓", "📚", "🧑‍🏫", "🤝", "👥", "👤",
      "🧑‍💼", "👔", "🍽️", "🍴", "🥂", "🍱", "☕", "🧮", "📦", "📮", "✅", "❌", "⭐", "🎯",
      "📣", "📢", "💡", "🔔", "🚫", "❓", "❗", "➕", "🏷️", "💰", "💳",
    ],
  },
];

/** Popover grid for picking any emoji (grouped, scrollable). Portaled + fixed so a
 *  parent dialog's `overflow-hidden` can't clip it; flips above the anchor when space is tight. */
function EmojiPickerPopover({
  anchorRef,
  onPick,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const width = 320;
    const height = 288; // popover max height + padding
    let left = Math.min(r.left, window.innerWidth - width - 12);
    left = Math.max(12, left);
    let top = r.bottom + 4;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, r.top - height - 4); // flip above
    }
    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchorRef.current?.contains(t)) return; // let the toggle button handle itself
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[70] w-[320px] max-w-[calc(100vw-1.5rem)] rounded-xl overflow-hidden"
      style={{
        top: pos.top,
        left: pos.left,
        background: "var(--bg-card)",
        border: "1px solid var(--border-card)",
        boxShadow: "var(--shadow-modal)",
      }}
    >
      <div className="max-h-[260px] overflow-y-auto p-2">
        {EMOJI_GROUPS.map((g) => (
          <div key={g.label} className="mb-1.5 last:mb-0">
            <p
              className="text-[10.5px] font-semibold px-1 py-1 sticky top-0"
              style={{ color: "var(--text-muted)", background: "var(--bg-card)" }}
            >
              {g.label}
            </p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.emojis.map((emo, i) => (
                <button
                  key={`${emo}-${i}`}
                  type="button"
                  onClick={() => onPick(emo)}
                  className="w-9 h-9 rounded-lg text-[18px] cursor-pointer border-none flex items-center justify-center hover:scale-110 transition-transform"
                  style={{ background: "transparent" }}
                  title={emo}
                >
                  {emo}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

/** "เลือก emoji เพิ่มเติม" button that toggles a full, categorized emoji picker popover. */
export function EmojiPickerButton({ onPick }: { onPick: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="mt-2">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg cursor-pointer border-none"
        style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
      >
        <Smile size={13} /> เลือก emoji เพิ่มเติม
      </button>
      {open && (
        <EmojiPickerPopover
          anchorRef={btnRef}
          onPick={(emo) => {
            onPick(emo);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
