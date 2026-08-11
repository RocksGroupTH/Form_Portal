export default function Loading() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4"
      style={{ background: "var(--bg-page)" }}
    >
      <img
        src="/codexfamilylogo/logo_3_speed_128.png"
        alt="Form Portal"
        width={64}
        height={64}
        className="animate-pulse"
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
