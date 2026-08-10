export default function DashboardsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="text-center text-[11px] py-1.5 px-3" style={{ background: "#dbeafe", color: "#1e40af" }}>
        BETA — You may encounter issues. Your feedback helps us improve. Contact <strong>Muh</strong> or <strong>Oab</strong> (IT)
      </div>
      {children}
    </>
  );
}
