export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{ background: "var(--bg-page)" }}
    >
      {/* `rocks-200.png`, not `rocks.png`: this slot is square, and the plain
          file is 74×91 — a square box letterboxes it and leaves the glyph
          looking small, which is the same reason the navbar renders it 20×24. */}
      <img
        src="/brandlogo/rocks-200.png"
        alt="Form Portal"
        width={64}
        height={64}
        className="animate-pulse object-contain"
      />
      <span
        className="text-[14px] font-bold"
        style={{ color: "var(--text-heading)" }}
      >
        Form Portal
      </span>
    </div>
  );
}
