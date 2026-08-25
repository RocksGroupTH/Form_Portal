/** Small "Powered by Claude" badge shown on AI-assisted upload sections. */
export function PoweredByClaude() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium select-none whitespace-nowrap"
      style={{ color: "var(--text-faint)" }}
      aria-label="ประมวลผลโดย Claude AI"
    >
      {/* Anthropic Claude logomark */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <path
          d="M13.827 3.52L18.27 16.52H15.335L14.25 13.23H9.75L8.665 16.52H5.73L10.173 3.52H13.827ZM12 6.23L10.535 11.23H13.465L12 6.23Z"
          fill="#CC785C"
        />
      </svg>
      Powered by Claude
    </span>
  );
}
