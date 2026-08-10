export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed top-12 bottom-0 left-0 right-0 overflow-hidden flex flex-col sm:px-4 md:px-6">
      <div className="shrink-0 text-center text-[11px] py-1.5 px-3" style={{ background: "#dbeafe", color: "#1e40af" }}>
        BETA — You may encounter issues. Your feedback helps us improve. Contact <strong>Muh</strong> or <strong>Oab</strong> (IT)
      </div>
      <div className="flex-1 min-h-0 flex flex-col max-w-[2560px] mx-auto w-full">
        {children}
      </div>
    </div>
  );
}
