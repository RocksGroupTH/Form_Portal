"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { useBrand } from "@/components/BrandProvider";
import {
  getBrandFromSearchParams,
  replaceSearchParams,
  setBrandInSearchParams,
} from "@/lib/brand-url";
import { useHomeData } from "@/features/home/useHomeData";
import { Search, FileText, Route, Luggage, ClipboardCheck, FilePen, ArrowRight } from "lucide-react";

const ACCOUNTING_FORMS = [
  {
    code: "AP-1",
    name: "เบิกค่าเดินทาง",
    desc: "ค่าน้ำมัน · ทางด่วน · ที่จอดรถ",
    href: "/request/travel-expense",
    Icon: Route,
  },
  {
    code: "AP-17",
    name: "จองที่พัก/ตั๋วโดยสาร",
    desc: "ไปทำงานต่างจังหวัด",
    href: "/request/travel-booking",
    Icon: Luggage,
  },
];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "สวัสดีตอนเช้า";
  if (h < 17) return "สวัสดีตอนบ่าย";
  return "สวัสดีตอนเย็น";
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "เมื่อสักครู่";
  if (diffMin < 60) return `${diffMin} นาทีที่แล้ว`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `${h} ชม.ที่แล้ว`;
  return `${Math.floor(h / 24)} วันที่แล้ว`;
}

function StatCard({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div
      className="p-3.5"
      style={{
        background: "var(--bg-card)",
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
        border: "1px solid var(--border-card)",
      }}
    >
      <div className="text-[19px] font-extrabold leading-none tabular-nums" style={{ color: tone }}>
        {value}
      </div>
      <div className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </div>
  );
}

function SectionLabel({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mt-6 mb-2.5">
      <h2 className="text-[13px] font-bold" style={{ color: "var(--text-heading)" }}>
        {title}
      </h2>
      {action}
    </div>
  );
}

export function HomeCatalogue() {
  const { data: session } = useSession();
  const { brand } = useBrand();
  const sp = useSearchParams();
  const [query, setQuery] = useState("");
  const { pendingCount, monthCount, draftCount, drafts, forms, isLoading } = useHomeData();

  const hrefWithBrand = (href: string) => {
    const current = new URLSearchParams(sp.toString());
    const urlBrand = getBrandFromSearchParams(current) ?? brand;
    if (!urlBrand) return href;
    return replaceSearchParams(href, setBrandInSearchParams(current, urlBrand));
  };

  const q = query.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) =>
    q === "" || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  const accounting = ACCOUNTING_FORMS.filter((f) => matches(f.code, f.name, f.desc));
  const general = useMemo(
    () => forms.filter((f) => matches(f.name, f.slug, f.description, f.category)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forms, q],
  );

  const name = session?.user?.nickname || session?.user?.name || "";

  return (
    <div>
      {/* Greeting + stats */}
      <div className="mb-1">
        <h1 className="text-[20px] font-extrabold tracking-tight" style={{ color: "var(--text-heading)" }}>
          {greeting()}{name ? `, ${name}` : ""} 👋
        </h1>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          มีงานรออนุมัติ {pendingCount} รายการ และฉบับร่างค้างไว้ {draftCount} ฉบับ
        </p>
      </div>

      {/* Search */}
      <div
        className="flex items-center gap-2.5 px-4 py-3 mt-4"
        style={{
          background: "var(--bg-card)",
          borderRadius: 999,
          boxShadow: "var(--shadow-card)",
          border: "1px solid var(--border-card)",
        }}
      >
        <Search size={15} style={{ color: "var(--text-faint)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='ค้นหาฟอร์ม… ลอง "เบิกค่าเดินทาง" หรือ "AP-17"'
          className="flex-1 bg-transparent border-none outline-none text-[13px]"
          style={{ color: "var(--text-primary)" }}
        />
      </div>

      {isLoading ? (
        <p className="text-[12px] mt-4" style={{ color: "var(--text-muted)" }}>
          กำลังโหลดข้อมูล...
        </p>
      ) : (
        <>
          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-2.5 mt-4">
            <StatCard value={pendingCount} label="รออนุมัติจากคุณ" tone="var(--status-pending-text)" />
            <StatCard value={monthCount} label="คำขอเดือนนี้" tone="var(--status-ok-text)" />
            <StatCard value={draftCount} label="ฉบับร่าง" tone="var(--status-draft-text)" />
          </div>

          {/* Continue where you left off */}
          {(drafts.length > 0 || pendingCount > 0) && (
            <>
              <SectionLabel title="ทำต่อจากที่ค้างไว้" />
              <div className="flex flex-col gap-2">
                {drafts.map((d) => (
                  <Link
                    key={d.key}
                    href={hrefWithBrand(d.href)}
                    className="flex items-center gap-3 px-3.5 py-3 no-underline"
                    style={{
                      background: "var(--bg-card)",
                      borderRadius: "var(--radius-card)",
                      boxShadow: "var(--shadow-card)",
                      border: "1px solid var(--border-card)",
                    }}
                  >
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 30, height: 30,
                        borderRadius: 10,
                        background: "var(--status-draft-bg)",
                        color: "var(--status-draft-text)",
                      }}
                    >
                      <FilePen size={15} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-bold" style={{ color: "var(--text-primary)" }}>
                        {d.formCode} · {d.label}
                      </span>
                      <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        {d.count} ฉบับร่าง · แก้ไขล่าสุด {timeAgo(d.updatedAt)}
                      </span>
                    </span>
                    <span
                      className="text-[10px] font-bold px-2.5 py-1 shrink-0"
                      style={{
                        borderRadius: 999,
                        background: "var(--status-draft-bg)",
                        color: "var(--status-draft-text)",
                      }}
                    >
                      ฉบับร่าง
                    </span>
                  </Link>
                ))}

                {pendingCount > 0 && (
                  <Link
                    href={hrefWithBrand("/my-work")}
                    className="flex items-center gap-3 px-3.5 py-3 no-underline"
                    style={{
                      background: "var(--bg-card)",
                      borderRadius: "var(--radius-card)",
                      boxShadow: "var(--shadow-card)",
                      border: "1px solid var(--border-card)",
                    }}
                  >
                    <span
                      className="flex items-center justify-center shrink-0"
                      style={{
                        width: 30, height: 30,
                        borderRadius: 10,
                        background: "var(--status-ok-bg)",
                        color: "var(--status-ok-text)",
                      }}
                    >
                      <ClipboardCheck size={15} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-bold" style={{ color: "var(--text-primary)" }}>
                        รออนุมัติจากคุณ
                      </span>
                      <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        ไปที่ My Work เพื่อตรวจและอนุมัติ
                      </span>
                    </span>
                    <span
                      className="text-[10px] font-bold px-2.5 py-1 shrink-0"
                      style={{
                        borderRadius: 999,
                        background: "var(--status-pending-bg)",
                        color: "var(--status-pending-text)",
                      }}
                    >
                      {pendingCount} รายการ
                    </span>
                  </Link>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Accounting forms */}
      {accounting.length > 0 && (
        <>
          <SectionLabel
            title="บัญชี"
            action={
              <Link
                href={hrefWithBrand("/request")}
                className="text-[11.5px] font-medium no-underline flex items-center gap-1"
                style={{ color: "var(--nav-active-text)" }}
              >
                ดูทั้งหมด <ArrowRight size={12} />
              </Link>
            }
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {accounting.map(({ code, name: formName, desc, href, Icon }) => (
              <Link
                key={code}
                href={hrefWithBrand(href)}
                className="flex gap-3 items-start p-3.5 no-underline"
                style={{
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 34, height: 34,
                    borderRadius: "var(--radius-tile)",
                    background: "var(--status-pending-bg)",
                    color: "var(--status-pending-text)",
                  }}
                >
                  <Icon size={17} />
                </span>
                <span className="min-w-0">
                  <span
                    className="inline-block text-[9.5px] font-extrabold px-1.5 py-0.5 mb-1"
                    style={{
                      borderRadius: 6,
                      background: "var(--bg-badge)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {code}
                  </span>
                  <span className="block text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {formName}
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {desc}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Form Builder forms — gated on isLoading too, same as the stat strip and
          continue section, so it doesn't pop in after the rest of the page has settled. */}
      {!isLoading && general.length > 0 && (
        <>
          <SectionLabel
            title="ฟอร์มทั่วไป"
            action={
              <Link
                href={hrefWithBrand("/forms")}
                className="text-[11.5px] font-medium no-underline flex items-center gap-1"
                style={{ color: "var(--nav-active-text)" }}
              >
                ดูทั้งหมด <ArrowRight size={12} />
              </Link>
            }
          />
          <div className="grid gap-2.5 sm:grid-cols-2">
            {general.map((f) => (
              <Link
                key={f.id}
                href={hrefWithBrand(`/forms/${f.slug}`)}
                className="flex gap-3 items-start p-3.5 no-underline"
                style={{
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-card)",
                  boxShadow: "var(--shadow-card)",
                  border: "1px solid var(--border-card)",
                }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{
                    width: 34, height: 34,
                    borderRadius: "var(--radius-tile)",
                    background: "var(--status-ok-bg)",
                    color: "var(--status-ok-text)",
                  }}
                >
                  <FileText size={17} />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {f.name}
                  </span>
                  <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {f.description || f.category || "ฟอร์มทั่วไป"}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {q !== "" && accounting.length === 0 && general.length === 0 && (
        <p className="text-[12px] mt-8 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่พบฟอร์มที่ตรงกับ &ldquo;{query}&rdquo;
        </p>
      )}
    </div>
  );
}
