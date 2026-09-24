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
import { formNameEn } from "@/lib/form-names";
import { sortByFormCode } from "@/lib/form-code-order";
// The shared hover affordance — accent border, focus ring, a 3px lift. Home's
// cards were plain <Link>s and the only card surface in the app without it, so
// the same tile felt inert here and interactive on /request.
import { HoverCard } from "@/components/ui/HoverCard";
// `Receipt` is AP-4's, `ReceiptText` is AP-3's — two forms, two icons, not a
// rename either side made.
import { Search, Route, Luggage, Receipt, ReceiptText, ClipboardCheck, FilePen, ArrowRight } from "lucide-react";

/**
 * The Accounting forms Home offers.
 *
 * Deliberately its own list rather than a filter over `REQUEST_CARDS`: Home
 * renders a different card (its own `Icon` component, a short one-line `desc`)
 * and never shows the management variants. The two lists must be kept in step
 * by hand — adding a form to `REQUEST_CARDS` alone puts it on `/request` and
 * *not* here. The `code` is the whole wiring: it feeds `isFormAvailable`,
 * `isFormComingSoon` and `FormEnvironmentChip`, and `/api/form-environment`
 * resolves every code any `REQUEST_CARDS` badge names, so a form already
 * carrying a management card needs nothing further to be filtered correctly.
 *
 * The *order* here is not one of the things kept by hand: write entries in
 * whatever order is convenient, and `sortByFormCode` renders them by form
 * number.
 */
/*
 * The English name is NOT here: it comes from `formNameEn`, keyed on the code.
 * AP-2's and AP-3's descriptions used to open with one ("Advance · …") and the
 * other three had none, which is the drift a shared table prevents — the
 * Request hub keeps its own copy of this list, so a name typed in both would
 * only ever be corrected in one.
 */
const ACCOUNTING_FORMS = [
  {
    code: "AP-1",
    name: "เบิกค่าเดินทาง",
    desc: "ค่าน้ำมัน · ทางด่วน · ที่จอดรถ",
    href: "/request/travel-expense",
    Icon: Route,
  },
  {
    code: "AP-2",
    name: "เบิกเงินทดรองจ่าย",
    desc: "ขอเงินล่วงหน้าก่อนไปใช้จ่าย",
    href: "/request/advance",
    Icon: FilePen,
  },
  {
    code: "AP-3",
    name: "เคลียร์คืนเงินทดรองจ่าย",
    desc: "ส่งคืนและสรุปเงินทดรองที่เบิกไป",
    href: "/request/clear-advance",
    Icon: ReceiptText,
  },
  {
    code: "AP-17",
    name: "จองที่พัก/ตั๋วโดยสาร",
    desc: "ไปทำงานต่างจังหวัด",
    href: "/request/travel-booking",
    Icon: Luggage,
  },
  {
    code: "AP-4",
    name: "ขอเบิกเงินคืนพนักงาน",
    desc: "เบิกเงินที่สำรองจ่ายไปก่อน",
    href: "/request/reimburse",
    Icon: Receipt,
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

/**
 * One tile of the stat strip.
 *
 * `href` makes it a link to the list it counted, with that filter already
 * applied — a number nobody can act on is a number nobody trusts. **Every tile
 * has one since 2026-09-24.**
 *
 * It stays optional because of what the last one cost to earn. ร่าง / ตีกลับ
 * had no link at first: it was counted from the two drafts endpoints while My
 * Requests pinned `Status <> 'Draft'`, so no destination could show what the
 * tile claimed. Linking it meant changing both — the query lists drafts now and
 * the count comes from the same rows as every tile beside it. That is the bar a
 * new tile has to clear before it gets an `href`, and the type is what makes
 * skipping it a deliberate act rather than an oversight.
 */
function StatCard({
  value,
  label,
  tone,
  href,
}: {
  value: number;
  label: string;
  tone: string;
  href?: string;
}) {
  const style = {
    background: "var(--bg-card)",
    borderRadius: "var(--radius-card)",
    boxShadow: "var(--shadow-card)",
    border: "1px solid var(--border-card)",
  } as const;

  const body = (
    <>
      <div className="text-[19px] font-extrabold leading-none tabular-nums" style={{ color: tone }}>
        {value}
      </div>
      <div className="text-[11px] mt-1.5" style={{ color: "var(--text-muted)" }}>
        {label}
      </div>
    </>
  );

  if (!href) {
    return (
      <div className="p-3.5" style={style}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="p-3.5 block transition-shadow hover:brightness-[0.99]"
      style={{ ...style, textDecoration: "none" }}
    >
      {body}
    </Link>
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
    <HoverCard
      href={href}
      className="flex items-center gap-3 px-3.5 py-3"
      style={{
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
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
    </HoverCard>
  );
}

/**
 * One accounting form on the catalogue.
 *
 * A form still in its UAT pilot is rendered rather than hidden: recessed,
 * watermarked `Soon`, and not a link. The state is "not yet", and a card that
 * is simply missing cannot say that — someone searching "AP-17" would read the
 * empty result as "no such form". The treatment matches the Request hub's
 * not-yet-available card so the same form looks the same in both places.
 */
function AccountingFormCard({
  code,
  name,
  desc,
  href,
  Icon,
  comingSoon,
}: {
  code: string;
  name: string;
  desc: string;
  href: string;
  Icon: React.ComponentType<{ size?: number }>;
  comingSoon: boolean;
}) {
  const nameEn = formNameEn(code);
  const body = (
    <>
      <span
        className="flex items-center justify-center shrink-0"
        style={{
          width: 34, height: 34,
          borderRadius: "var(--radius-tile)",
          // Same two mixes the Request hub's not-yet-available card uses, so
          // the icon tile and code chip read identically on both surfaces —
          // plain --bg-badge would nearly vanish against the recessed card.
          background: comingSoon
            ? "color-mix(in srgb, var(--text-faint) 22%, var(--bg-card-alt))"
            : "var(--status-pending-bg)",
          color: comingSoon ? "var(--text-faint)" : "var(--status-pending-text)",
        }}
      >
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span
          className="inline-block text-[9.5px] font-extrabold px-1.5 py-0.5 mb-1"
          style={{
            borderRadius: 6,
            // Recessed, but still legible. The card already reads as inactive
            // from its flat surface and the watermark; the form code is the one
            // thing on it that has to survive that, because finding out AP-17
            // is coming rather than missing is the whole point of the card.
            background: comingSoon
              ? "color-mix(in srgb, var(--text-muted) 18%, transparent)"
              : "var(--bg-badge)",
            color: comingSoon ? "var(--text-muted)" : "var(--text-secondary)",
          }}
        >
          {code}
        </span>
        <span
          className="block text-[13px] font-bold"
          style={{ color: comingSoon ? "var(--text-secondary)" : "var(--text-primary)" }}
        >
          {name}
        </span>
        {/* The English name sits between the Thai one and the description, and
            is styled as a name rather than as prose: it identifies the form,
            the line under it says what the form is for. A code this table does
            not know renders nothing rather than an empty line. */}
        {nameEn !== "" && (
          <span
            className="block text-[11px] font-semibold mt-0.5"
            style={{ color: comingSoon ? "var(--text-faint)" : "var(--text-secondary)" }}
          >
            {nameEn}
          </span>
        )}
        <span
          className="block text-[11px] mt-0.5"
          style={{ color: "var(--text-muted)" }}
        >
          {desc}
        </span>
      </span>
      {/* No environment chip while the form is coming soon: for this viewer the
          resolver answers "Production", and stamping PRO on a card production
          has not opened yet would contradict the watermark next to it. */}
      {!comingSoon && <FormEnvironmentChip formCode={code} className="self-start ml-auto" />}
    </>
  );

  if (comingSoon) {
    return (
      <div
        className="relative overflow-hidden flex gap-3 items-start p-3.5 cursor-default select-none"
        style={{
          background: "color-mix(in srgb, var(--bg-card-alt) 88%, var(--text-muted))",
          borderRadius: "var(--radius-card)",
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "color-mix(in srgb, var(--border-card) 55%, var(--text-faint))",
          boxShadow: "none",
        }}
        aria-disabled="true"
        title="ยังไม่เปิดให้ใช้งาน"
      >
        {body}
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
          <span
            className="text-[32px] sm:text-[38px] font-black uppercase tracking-[0.22em] -rotate-[16deg]"
            // Heavier than the hub's 0.22: this mark is 32-38px against the
            // hub's 52-64px, and at that size the same opacity reads as a
            // smudge rather than a word.
            style={{ color: "var(--text-muted)", opacity: 0.36 }}
          >
            Soon
          </span>
        </span>
        {/* The watermark is decorative and aria-disabled is inert on a plain
            div, so this sentence is the only thing a screen reader gets. */}
        <span className="sr-only">ยังไม่เปิดให้ใช้งาน</span>
      </div>
    );
  }

  return (
    <HoverCard
      href={href}
      className="flex gap-3 items-start p-3.5"
      style={{
        borderRadius: "var(--radius-card)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {body}
    </HoverCard>
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
    stats,
    monthRange,
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
  /**
   * Unavailable, but visibly so: a form in its UAT pilot. Defaults to false for
   * the same reason `isFormAvailable` defaults to true — a fetch failure must
   * never invent a state, and here the safe invention is "no watermark".
   */
  const isFormComingSoon = (code: string) => forms?.[code]?.comingSoon ?? false;

  const hrefWithBrand = (href: string) => {
    const current = new URLSearchParams(sp.toString());
    const urlBrand = getBrandFromSearchParams(current) ?? brand;
    if (!urlBrand) return href;
    return replaceSearchParams(href, setBrandInSearchParams(current, urlBrand));
  };

  const q = query.trim().toLowerCase();
  const matches = (...parts: Array<string | null | undefined>) =>
    q === "" || parts.some((p) => (p ?? "").toLowerCase().includes(q));

  // Everything this viewer gets a card for — usable now, or visibly not yet.
  // A coming-soon form is rendered, so it has to count as present here or the
  // "nothing is available" line below would appear on a page that is plainly
  // showing a card.
  //
  // Kept separate from the search-filtered list so the empty state can tell
  // "nothing matches your search" apart from "nothing is here at all" — a
  // tester in UAT mode who types anything into the search box must still see
  // the UAT explanation, not a false "no match" for their query.
  const shownAccounting = sortByFormCode(
    ACCOUNTING_FORMS.filter((f) => isFormAvailable(f.code) || isFormComingSoon(f.code)),
    (f) => f.code,
  );
  // The English name is searchable as well, or adding it would put a word on
  // screen that typing finds nothing for.
  const accounting = shownAccounting.filter((f) =>
    matches(f.code, f.name, f.desc, formNameEn(f.code)),
  );

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
            มีงานรออนุมัติ {pendingCount} รายการ และคำขอที่ยังทำไม่เสร็จ {stats.unfinished} รายการ
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
          {/* Stat strip.
              Two rows of four rather than one row of eight: at eight across a
              tile is narrower than its own Thai label, and the labels are what
              make the numbers mean anything. The first tile is the only one
              about OTHER people's requests — it is this viewer's approval queue
              — and the seven after it are their own, which is why it links to
              My Work and they link to My Requests. */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
            <StatCard
              value={pendingCount}
              label="รออนุมัติจากคุณ"
              tone="var(--status-pending-text)"
              href="/my-work"
            />
            <StatCard
              value={stats.total}
              label="คำขอทั้งหมด"
              tone="var(--text-primary)"
              href="/my-request?status=all"
            />
            {/* `submittedAt` on both sides: `countHomeStats` measures it and
                `inDateRange` filters on it, so this link opens exactly the rows
                the tile counted. */}
            <StatCard
              value={stats.month}
              label="คำขอเดือนนี้"
              tone="var(--status-ok-text)"
              href={`/my-request?status=all&from=${monthRange.from}&to=${monthRange.to}`}
            />
            <StatCard
              value={stats.pending}
              label="คำขอที่รออนุมัติ"
              tone="var(--status-pending-text)"
              href="/my-request?status=pending"
            />
            <StatCard
              value={stats.approved}
              label="อนุมัติแล้ว"
              tone="var(--status-ok-text)"
              href="/my-request?status=Approved"
            />
            <StatCard
              value={stats.rejected}
              label="ไม่อนุมัติ"
              tone="var(--color-danger)"
              href="/my-request?status=Rejected"
            />
            <StatCard
              value={stats.cancelled}
              label="ยกเลิก"
              tone="var(--text-muted)"
              href="/my-request?status=Cancelled"
            />
            {/* It links now (the user, 2026-09-24). It could not before: it was
                counted from the two drafts endpoints while My Requests pinned
                `Status <> 'Draft'`, so every destination showed a shorter list
                than the tile promised. Both halves moved — the count comes from
                the same rows as every tile beside it, and the page lists
                drafts — so the number and the list are now the same set. */}
            <StatCard
              value={stats.unfinished}
              label="ร่าง / ตีกลับ"
              tone="var(--status-draft-text)"
              href="/my-request?status=Draft,Returned"
            />
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
              <AccountingFormCard
                key={code}
                code={code}
                name={formName}
                desc={desc}
                href={hrefWithBrand(href)}
                Icon={Icon}
                comingSoon={isFormComingSoon(code)}
              />
            ))}
          </div>
        </>
      )}

      {/* Branch on shownAccounting, not on q: a search that matches nothing
          among the forms this viewer gets a card for is a real "no match"
          (search reason), but if there was nothing to show before the search
          even ran, that's true regardless of what was typed — a tester in UAT
          mode who types anything must still see why, not a false "no match for
          your search". A coming-soon form counts as shown, so searching
          "AP-17" while it is being piloted finds the Soon card rather than
          this line. */}
      {accounting.length === 0 && shownAccounting.length > 0 && (
        <p className="text-[12px] mt-8 text-center" style={{ color: "var(--text-muted)" }}>
          ไม่พบฟอร์มที่ตรงกับ &ldquo;{query}&rdquo;
        </p>
      )}

      {shownAccounting.length === 0 && (
        <p className="text-[12px] mt-8 text-center" style={{ color: "var(--text-muted)" }}>
          {viewer?.uatMode
            ? "คุณอยู่ในโหมด UAT แต่ยังไม่มีฟอร์มบัญชีใดเปิดให้ทดสอบในขณะนี้"
            : "ยังไม่มีฟอร์มบัญชีที่เปิดให้ใช้งาน"}
        </p>
      )}
    </div>
  );
}
