import { Suspense } from "react";
import { Navbar } from "@/components/layout/Navbar";
import { RouteGuard } from "@/components/layout/RouteGuard";
import { BrandGate } from "@/components/BrandGate";
import { BrandUrlSync } from "@/components/BrandUrlSync";

const contentMax = "max-w-[2560px] mx-auto w-full";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen font-sans w-full min-w-0" style={{ background: "var(--bg-page)" }}>
      <RouteGuard>
        <Suspense fallback={null}>
          <BrandUrlSync>
            <BrandGate>
              <Navbar />
              <main className={`${contentMax} min-w-0 px-0 pt-14 md:pt-12 flex-1 sm:px-4 md:px-6 pb-24 md:pb-6`}>
                {children}
              </main>
            </BrandGate>
          </BrandUrlSync>
        </Suspense>
      </RouteGuard>
    </div>
  );
}
