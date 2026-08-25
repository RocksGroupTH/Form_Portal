/** "Powered by Claude" badge — logo matches the Claude Desktop icon (orange sunburst). */
export function PoweredByClaude() {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] font-medium select-none whitespace-nowrap"
      style={{ color: "var(--text-faint)" }}
      aria-label="ประมวลผลโดย Claude AI"
    >
      {/* Claude Desktop sunburst logomark — 11 rounded arms, organic lengths */}
      <svg
        width="18"
        height="18"
        viewBox="0 0 41 41"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ flexShrink: 0 }}
      >
        <g transform="translate(20.5,20.5)">
          <rect x="-1.4" y="-17" width="2.8" height="14" rx="1.4" fill="#CC785C" transform="rotate(0)" />
          <rect x="-1.4" y="-17" width="2.8" height="15" rx="1.4" fill="#CC785C" transform="rotate(33)" />
          <rect x="-1.4" y="-17" width="2.8" height="13" rx="1.4" fill="#CC785C" transform="rotate(66)" />
          <rect x="-1.4" y="-17" width="2.8" height="14.5" rx="1.4" fill="#CC785C" transform="rotate(99)" />
          <rect x="-1.4" y="-17" width="2.8" height="13" rx="1.4" fill="#CC785C" transform="rotate(132)" />
          <rect x="-1.4" y="-17" width="2.8" height="15" rx="1.4" fill="#CC785C" transform="rotate(165)" />
          <rect x="-1.4" y="-17" width="2.8" height="14" rx="1.4" fill="#CC785C" transform="rotate(198)" />
          <rect x="-1.4" y="-17" width="2.8" height="13.5" rx="1.4" fill="#CC785C" transform="rotate(231)" />
          <rect x="-1.4" y="-17" width="2.8" height="15" rx="1.4" fill="#CC785C" transform="rotate(264)" />
          <rect x="-1.4" y="-17" width="2.8" height="13" rx="1.4" fill="#CC785C" transform="rotate(297)" />
          <rect x="-1.4" y="-17" width="2.8" height="14.5" rx="1.4" fill="#CC785C" transform="rotate(330)" />
        </g>
      </svg>
      Powered by Claude
    </span>
  );
}
