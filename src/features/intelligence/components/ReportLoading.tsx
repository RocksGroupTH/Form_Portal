"use client";

export function ReportLoading() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <img
        src="/codexfamilylogo/logo_3_speed_128.png"
        alt="Loading"
        width={72}
        height={72}
        className="animate-pulse"
      />
      <div className="w-48 h-1 rounded-full overflow-hidden" style={{ background: "var(--bg-badge)" }}>
        <div
          className="h-full rounded-full"
          style={{
            background: "var(--nav-active-text)",
            animation: "reportLoadBar 1.2s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}
