/** "Powered by Claude" badge — uses the official Claude wordmark. */
export function PoweredByClaude() {
  return (
    <span
      className="inline-flex items-center gap-1 select-none whitespace-nowrap"
      style={{ color: "var(--text-faint)", fontSize: 10, fontWeight: 500 }}
      aria-label="ประมวลผลโดย Claude AI"
    >
      Powered by
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/claude-logo.webp"
        alt="Claude"
        height={45}
        style={{ height: 45, width: "auto", opacity: 0.7, flexShrink: 0, mixBlendMode: "multiply" }}
      />
    </span>
  );
}
