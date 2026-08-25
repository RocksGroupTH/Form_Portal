/** Small "Powered by Claude" badge shown on AI-assisted upload sections. */
export function PoweredByClaude() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium select-none"
      style={{ color: "var(--text-faint)" }}
      aria-label="ประมวลผลโดย Claude AI"
    >
      {/* Anthropic logomark — simplified "A" letterform */}
      <svg
        width="11"
        height="11"
        viewBox="0 0 46 46"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0, opacity: 0.75 }}
      >
        <path
          d="M26.38 6h7.27L46 40H38.8l-2.77-8.11H19.96L17.19 40H10zm-4.01 20.77h9.24L26.99 15.2z"
          fill="#CC785C"
        />
        <path
          d="M0 40 12.35 6h7.28l-12.36 34z"
          fill="#CC785C"
        />
      </svg>
      Powered by Claude
    </span>
  );
}
