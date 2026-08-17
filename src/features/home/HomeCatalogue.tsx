"use client";

import { useState } from "react";
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
import { useFormEnvironments } from "@/lib/hooks/useFormEnvironments";
import { FormEnvironmentChip } from "@/components/EnvironmentBadge";
import { Search, Route, Luggage, ClipboardCheck, FilePen, ArrowRight } from "lucide-react";

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

/**
 * Inline load-failure line — same shape the accounting queues use in place of
 * their content (see request/accounting/travel-booking/queue/page.tsx:120-123).
 * A dashboard strip does not warrant a toast on every background revalidation;
 * it only has to stop claiming a number it does not have.
 */
function LoadError({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] mt-0.5" style={{ color: "var(--color-danger)" }}>
      {children}
    </p>
  );
}

/** One "waiting on you" row. Each approval system gets its own row and its own queue link. */
function PendingLink({ href, Icon, title, subtitle, count }: {
  href: string;
  Icon: React.ComponentType<{ size?: number }>;
  title: string;
  subtitle: string;
  count: number;
}) {
  return (
    <Link
      href={href}
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
        <Icon size={15} />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-bold" style={{ color: "var(--text-primary)" }}>
          {title}
        </span>
        <span className="block text-[11px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          {subtitle}
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
        {count} รายการ
      </span>
    </Link>
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
  const {
    pendingCount,
    monthCount,
    resumableCount,
    resumable,
    summaryError,
    isLoading,
  } = useHomeData();
  const { data: formEnvData } = useFormEnvironments();
  const viewer = formEnvData?.viewer;
  const forms = formEnvData?.forms;
  // Unknown (still loading, or the payload failed to load) always counts as
  // available — a fetch failure must never hide a form that would otherwise
  // show. Only an explicit `available: false` filters a form out.
  const isFormAvailable = (code: string) => forms?.[code]?.available ?? true;

  const hrefWithBrand = (href: string) => {
    const current = new URLSearchParams(sp.toString());
    const urlBrand = getBrandFromSearchParams(current) ?? brand;
    if (!urlBrand) return href;
    return replaceSearchParams(href, setBrandInSearchParams(current, urlBrand));
  };

  const q = query.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) =>
    q === "" || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  // Kept separate from the search-filtered list below so the empty state can
  // tell "nothing matches your search" apart from "nothing is available at
  // all" — a tester in UAT mode who types anything into the search box must
  // still see the UAT explanation, not a false "no match" for their query.
  const availableAccounting = ACCOUNTING_FORMS.filter((f) => isFormAvailable(f.code));
  const accounting = availableAccounting.filter((f) => matches(f.code, f.name, f.desc));

  const name = session?.user?.nickname || session?.user?.name || "";

  return (
    <div>
      {/* Greeting + stats */}
      <div className="mb-1">
        <h1 className="text-[20px] font-extrabold tracking-tight" style={{ color: "var(--text-heading)" }}>
          {greeting()}{name ? `, ${name}` : ""} 👋
        </h1>
        {summaryError ? (
          <LoadError>โหลดข้อมูลสรุปไม่สำเร็จ — ลองรีเฟรชหน้าอีกครั้ง</LoadError>
        ) : isLoading ? null : (
          // "คำขอที่ยังทำไม่เสร็จ" covers both statuses the drafts endpoints return
          // (Draft and Returned) — AP-17 cannot tell them apart, so the wording must
          // be true for either. See ResumableGroup.returnedCount.
          <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
            มีงานรออนุมัติ {pendingCount} รายการ และคำขอที่ยังทำไม่เสร็จ {resumableCount} รายการ
          </p>
        )}
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

      {summaryError ? null : isLoading ? (
        <p className="text-[12px] mt-4" style={{ color: "var(--text-muted)" }}>
          กำลังโหลดข้อมูล...
        </p>
      ) : (
        <>
          {/* Stat strip */}
          <div className="grid grid-cols-3 gap-2.5 mt-4">
            <StatCard value={pendingCount} label="รออนุมัติจากคุณ" tone="var(--status-pending-text)" />
            <StatCard value={monthCount} label="คำขอเดือนนี้" tone="var(--status-ok-text)" />
            {/* Draft + Returned — the drafts endpoints return both and AP-17 cannot
                separate them, so the label names both rather than under-reporting. */}
            <StatCard value={resumableCount} label="ร่าง / ตีกลับ" tone="var(--status-draft-text)" />
          </div>

          {/* Continue where you left off */}
          {(resumable.length > 0 || pendingCount > 0) && (
            <>
              <SectionLabel title="ทำต่อจากที่ค้างไว้" />
              <div className="flex flex-col gap-2">
                {resumable.map((d) => (
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
                        {/* AP-1 knows the split; AP-17 does not, so it says the neutral
                            thing rather than calling returned requests drafts. */}
                        {d.returnedCount === null
                          ? `${d.count} รายการ`
                          : d.returnedCount === 0
                            ? `${d.count} ฉบับร่าง`
                            : d.returnedCount === d.count
                              ? `${d.count} รายการที่ถูกตีกลับ`
                              : `${d.count - d.returnedCount} ฉบับร่าง · ${d.returnedCount} ตีกลับ`}
                        {" · แก้ไขล่าสุด "}
                        {timeAgo(d.updatedAt)}
                      </span>
                    </span>
                    {/* Drafts are read from their own form's database, so the
                        form's flag is the row's environment. */}
                    <FormEnvironmentChip formCode={d.formCode} className="self-center" />
                    <span
                      className="text-[10px] font-bold px-2.5 py-1 shrink-0"
                      style={{
                        borderRadius: 999,
                        background: d.returnedCount ? "var(--status-bad-bg)" : "var(--status-draft-bg)",
                        color: d.returnedCount ? "var(--status-bad-text)" : "var(--status-draft-text)",
                      }}
                    >
                      {d.returnedCount ? "ตีกลับ" : d.returnedCount === null ? "ทำต่อ" : "ฉบับร่าง"}
                    </span>
                  </Link>
                ))}

                {pendingCount > 0 && (
                  <PendingLink
                    href={hrefWithBrand("/my-work")}
                    Icon={ClipboardCheck}
                    title="รออนุมัติจากคุณ"
                    subtitle="ไปที่ My Work เพื่อตรวจและอนุมัติ"
                    count={pendingCount}
                  />
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
                <FormEnvironmentChip formCode={code} className="self-start ml-auto" />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Branch on availableAccounting, not on q: a search that matches nothing
          among the forms actually available to this viewer is a real "no
          match" (search reason), but if nothing was available before the
          search even ran, that's true regardless of what was typed — a
          tester in UAT mode who types anything must still see why, not a
          false "no match for your search". */}
      {accounting.length === 0 && availableAccounting.length > 0 && (
        <p className="text-[12px] mt-8 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่พบฟอร์มที่ตรงกับ &ldquo;{query}&rdquo;
        </p>
      )}

      {availableAccounting.length === 0 && (
        <p className="text-[12px] mt-8 text-center" style={{ color: "var(--text-muted)" }}>
          {viewer?.uatMode
            ? "คุณอยู่ในโหมด UAT แต่ยังไม่มีฟอร์มบัญชีใดเปิดให้ทดสอบในขณะนี้"
            : "ยังไม่มีฟอร์มบัญชีที่เปิดให้ใช้งาน"}
        </p>
      )}
    </div>
  );
}
