"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Search } from "lucide-react";
import type { ClearAdvanceItem } from "@/features/clear-advance/types";
import { sameRegisteredName } from "@/lib/clr/rd-vat-core";
import { vendorMatches } from "@/lib/clr/tax-vendor-core";

/**
 * One receipt's seller: who the Revenue Department says they are, and which BC
 * vendor card they are.
 *
 * It used to be a strip of eleven-pixel controls under the table — a number, a
 * button, a name, a link, a text box, another button, a dropdown — all wrapping
 * into one line, under a heading that said "ตรวจผู้ขายกับกรมสรรพากร" while half
 * of what it held was the vendor picker. Nothing said which table row a strip
 * belonged to, or whether a line was finished.
 *
 * So: one card per line, the two questions labelled and separated, the line's
 * readiness stated at the top, and the registry checked on open rather than a
 * click per row — the answer is stored permanently on our side, so asking is
 * nearly free and waiting for a click was the expensive part.
 */

export interface VatRegistrant {
  nid: string;
  titleName: string | null;
  name: string | null;
  branchNumber: number | null;
  branchCode: string | null;
  vatRegisteredOn: string | null;
  address: string | null;
}

export interface TaxVendorCandidate {
  vendorNo: string;
  displayName: string | null;
  taxRegistrationNumber: string | null;
}

type RdState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "found"; registrant: VatRegistrant; checkedAt: string | null }
  | { state: "unregistered"; checkedAt: string | null }
  | { state: "unknown" };

interface Props {
  /** 0-based; shown as 1-based to match the table above. */
  index: number;
  item: ClearAdvanceItem;
  /** The claim brand — the route resolves it to the BC Company itself. */
  brandCode: string | null;
  onChange: (patch: Partial<ClearAdvanceItem>) => void;
}

const money = (n: number) =>
  n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDay = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
};

/**
 * One fetch per Company per page, shared by every card on it.
 *
 * A clearing with six receipts is six of these cards, and each needs the same
 * list — to filter when opened, and to show the name of a vendor already chosen
 * rather than a bare code. Without the cache that is six identical requests for
 * 93KB, on mount, every time the account step opens.
 */
const vendorListCache = new Map<string, Promise<TaxVendorCandidate[]>>();

function fetchVendors(brandCode: string | null): Promise<TaxVendorCandidate[]> {
  const key = brandCode ?? "";
  const hit = vendorListCache.get(key);
  if (hit) return hit;
  const p = (async () => {
    const res = await fetch(`/api/request/clear-advance/tax-vendors?brand=${encodeURIComponent(key)}`);
    const j = (await res.json()) as { ok: boolean; data?: TaxVendorCandidate[]; error?: string };
    if (!j.ok) {
      // Not cached: a failure now must not become this page's answer forever.
      vendorListCache.delete(key);
      throw new Error(j.error ?? "โหลดรายชื่อ Vendor ไม่สำเร็จ");
    }
    return j.data ?? [];
  })();
  vendorListCache.set(key, p);
  return p;
}

export function SellerVendorCard({ index, item, brandCode, onChange }: Props) {
  const tin = (item.taxId ?? "").replace(/\D/g, "");
  const hasTin = tin.length === 13;
  const vat = Number(item.vatAmount ?? 0);
  const total = Number(item.amountBeforeVat ?? 0) + vat;

  const [rd, setRd] = useState<RdState>({ state: "idle" });
  /** Every vendor in this Company, fetched once and filtered as the reader types. */
  const [vendors, setVendors] = useState<TaxVendorCandidate[] | "loading" | null>(null);
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const checkRd = useCallback(
    async (refresh = false) => {
      if (!hasTin) return;
      setRd({ state: "checking" });
      try {
        const res = await fetch(
          `/api/request/clear-advance/vat-registrant?taxId=${tin}${refresh ? "&refresh=1" : ""}`,
        );
        const j = (await res.json()) as {
          ok: boolean;
          data?: { registrant: VatRegistrant | null; checkedAt: string | null };
        };
        if (!j.ok) return setRd({ state: "unknown" });
        const checkedAt = j.data?.checkedAt ?? null;
        setRd(
          j.data?.registrant
            ? { state: "found", registrant: j.data.registrant, checkedAt }
            : { state: "unregistered", checkedAt },
        );
      } catch {
        setRd({ state: "unknown" });
      }
    },
    [hasTin, tin],
  );

  const loadVendors = useCallback(async () => {
    setVendors("loading");
    try {
      setVendors(await fetchVendors(brandCode));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดรายชื่อ Vendor ไม่สำเร็จ");
      setVendors([]);
    }
  }, [brandCode]);

  /* A vendor already chosen is stored as a number alone — its name lives in BC.
     The list is what carries the name, so a card that starts with one loads it
     without waiting to be opened; the cache makes that free after the first. */
  useEffect(() => {
    if (vendors !== null || !(item.taxVendorNo ?? "").trim()) return;
    void loadVendors();
  }, [item.taxVendorNo, vendors, loadVendors]);

  /* Ask the registry when the card opens, once per tax id. The answer is kept in
     our own table and never expires, so the ordinary case is a row read; making
     someone click for it bought nothing. */
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hasTin || askedFor.current === tin) return;
    askedFor.current = tin;
    void checkRd();
  }, [hasTin, tin, checkRd]);

  const reg = rd.state === "found" ? rd.registrant : null;
  const rdFullName = reg ? [reg.titleName, reg.name].filter(Boolean).join(" ") : "";
  const invoiceName = (item.payeeName ?? "").trim();
  const invoiceBranch = (item.taxBranchCode ?? "").trim();
  /* Spacing differs between the invoice, the card and the register for the same
     company, so only a real difference is shown — otherwise the panel cries wolf
     on every line and stops being read. */
  const differs =
    !!rdFullName &&
    (!sameRegisteredName(rdFullName, invoiceName) ||
      (reg?.branchCode ?? "") !== invoiceBranch);

  const chosenNo = (item.taxVendorNo ?? "").trim();

  const all = Array.isArray(vendors) ? vendors : [];
  const chosen = all.find((c) => c.vendorNo === chosenNo) ?? null;

  /* The cards whose tax id is the one on this receipt, first and marked. Every
     other card is still one keystroke away — the tax id is a strong hint, not a
     filter, because the seller may simply have no tax id on their card. */
  const shortlist = useMemo(() => {
    const matching = all.filter((c) => vendorMatches(c, term));
    if (!hasTin) return matching.slice(0, 80);
    const exact: TaxVendorCandidate[] = [];
    const rest: TaxVendorCandidate[] = [];
    for (const c of matching) {
      ((c.taxRegistrationNumber ?? "").replace(/\D/g, "") === tin ? exact : rest).push(c);
    }
    return [...exact, ...rest].slice(0, 80);
  }, [all, term, hasTin, tin]);

  const needsVendor = vat > 0 && !chosenNo;

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2.5"
      style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)" }}
    >
      {/* Which receipt this is, and whether it is finished. */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[12px] font-bold" style={{ color: "var(--text-heading)" }}>
          รายการที่ {index + 1}
        </span>
        {item.docNo && (
          <span className="text-[11px] font-mono" style={{ color: "var(--text-secondary)" }}>
            {item.docNo}
          </span>
        )}
        <span className="text-[11px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          ฿{money(total)}
        </span>
        <span className="flex-1" />
        <Pill
          tone={needsVendor ? "warn" : vat > 0 ? "ok" : "muted"}
          label={needsVendor ? "ต้องเลือก Vendor" : vat > 0 ? "พร้อม" : "ไม่มี VAT"}
        />
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
        {/* ── the registry ── */}
        <Field label="กรมสรรพากร">
          {!hasTin ? (
            <Muted>ยังไม่มีเลขผู้เสียภาษี 13 หลัก — กรอกในตารางด้านบนก่อน</Muted>
          ) : rd.state === "checking" ? (
            <Muted>กำลังตรวจกับกรมสรรพากร…</Muted>
          ) : rd.state === "unknown" ? (
            <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
              ตรวจไม่สำเร็จ
              <LinkButton onClick={() => void checkRd()}>ลองใหม่</LinkButton>
            </span>
          ) : rd.state === "unregistered" ? (
            <div className="flex flex-col gap-0.5">
              {/* Not being VAT registered is only a problem if VAT was charged.
                  A natural person selling on a plain receipt is not registered
                  and never will be — nearly every individual seller lands here,
                  and dressing that as a warning taught the reader to scroll past
                  the line where VAT really was claimed from a non-registrant. */}
              {vat > 0 ? (
                <span className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
                  ⚠ ไม่อยู่ในทะเบียน VAT แต่บรรทัดนี้มี VAT {money(vat)} — ภาษีซื้ออาจขอคืนไม่ได้ ตรวจใบกำกับอีกครั้ง
                </span>
              ) : (
                <Muted>ไม่อยู่ในทะเบียน VAT — ปกติสำหรับบุคคลธรรมดาหรือผู้ขายรายย่อย</Muted>
              )}
              <CheckedAt at={rd.checkedAt} onRefresh={() => void checkRd(true)} />
            </div>
          ) : rd.state === "found" && reg ? (
            <div className="flex flex-col gap-1">
              {differs ? (
                <>
                  {/* Both, side by side: the invoice is the document, the
                      registry is the record, and which to keep is a judgement. */}
                  <Compare label="ใบกำกับ" name={invoiceName || "—"} branch={invoiceBranch} />
                  <Compare
                    label="สรรพากร"
                    name={rdFullName}
                    branch={reg.branchCode ?? ""}
                    tone="ok"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() =>
                        onChange({ payeeName: rdFullName, taxBranchCode: reg.branchCode })
                      }
                      className="text-[11px] px-2 py-0.5 rounded-lg cursor-pointer"
                      style={{
                        background: "var(--nav-active-bg)",
                        color: "var(--nav-active-text)",
                        border: "none",
                      }}
                    >
                      ใช้ข้อมูลจากสรรพากร
                    </button>
                    <CheckedAt at={rd.checkedAt} onRefresh={() => void checkRd(true)} />
                  </div>
                </>
              ) : (
                <>
                  <span className="text-[11px]" style={{ color: "var(--text-info-green)" }}>
                    ✓ ตรงกับใบกำกับ — {rdFullName}
                    {reg.branchCode ? ` · สาขา ${reg.branchCode}` : ""}
                  </span>
                  <CheckedAt at={rd.checkedAt} onRefresh={() => void checkRd(true)} />
                </>
              )}
            </div>
          ) : null}
        </Field>

        {/* ── the BC vendor ── */}
        <Field
          label="Vendor (BC)"
          hint={vat > 0 ? "ต้องระบุ — ใช้เป็น Tax Vendor No. บนบรรทัด VAT" : "ไม่บังคับ — บรรทัดนี้ไม่มี VAT"}
        >
          {/* One control: a field that opens a list of the Company's vendors and
              filters as you type — the same shape the branch and G/L pickers on
              this form already use. It replaced a text box and a ค้นหา button,
              which asked the reader to run a query and then read whether it had
              found anything; 1,604 cards is small enough to send once and filter
              here, so there is nothing to run. */}
          <div className="relative flex flex-col gap-1">
            <button
              type="button"
              onClick={() => {
                const next = !open;
                setOpen(next);
                if (!next) return;
                if (vendors === null) void loadVendors();
                // Seeded with the seller off the receipt, so the common case is
                // open-and-pick rather than open-and-type. Not when one is
                // already chosen: an open then is a change of mind, and the
                // receipt's name is what it was changed away from.
                if (!chosenNo && !term) setTerm(invoiceName);
              }}
              className="text-[12px] px-2 py-1.5 rounded-lg w-full text-left flex items-center gap-1.5 cursor-pointer"
              style={{
                background: "var(--bg-input)",
                color: chosen || chosenNo ? "var(--text-primary)" : "var(--text-faint)",
                border: "1px solid var(--border-input)",
              }}
            >
              <span className="flex-1 min-w-0 truncate">
                {chosenNo
                  ? `${chosenNo}${chosen?.displayName ? ` · ${chosen.displayName}` : ""}`
                  : "— เลือก Vendor (เว้นว่างได้) —"}
              </span>
              <Search size={12} className="shrink-0" style={{ color: "var(--text-faint)" }} />
            </button>

            {open && (
              <div
                className="absolute z-30 top-full left-0 right-0 mt-1 rounded-lg overflow-hidden"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "0 8px 24px -8px rgba(0,0,0,0.35)" }}
              >
                <div className="p-2" style={{ borderBottom: "1px solid var(--border-light)" }}>
                  <input
                    autoFocus
                    value={term}
                    onChange={(e) => setTerm(e.target.value)}
                    placeholder="พิมพ์ชื่อ / เลขผู้เสียภาษี / รหัส Vendor"
                    className="text-[11px] px-2 py-1 rounded-lg w-full outline-none"
                    style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                  />
                </div>
                <div className="max-h-56 overflow-y-auto slim-scroll">
                  {vendors === "loading" ? (
                    <p className="px-3 py-2 text-[11px] m-0" style={{ color: "var(--text-muted)" }}>กำลังโหลด…</p>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => { onChange({ taxVendorNo: null }); setOpen(false); setTerm(""); }}
                        className="w-full text-left px-3 py-1.5 text-[11px] cursor-pointer border-none bg-transparent"
                        style={{ color: "var(--text-muted)" }}
                      >
                        — ไม่เลือก Vendor (เว้นว่าง) —
                      </button>
                      {shortlist.length === 0 ? (
                        <p className="px-3 py-2 text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                          ไม่พบ Vendor ที่ตรงกับที่พิมพ์
                        </p>
                      ) : (
                        shortlist.map((c) => {
                          const sameTin = hasTin && (c.taxRegistrationNumber ?? "").replace(/\D/g, "") === tin;
                          return (
                            <button
                              key={c.vendorNo}
                              type="button"
                              onClick={() => { onChange({ taxVendorNo: c.vendorNo }); setOpen(false); setTerm(""); }}
                              className="w-full text-left px-3 py-1.5 cursor-pointer border-none bg-transparent hover:bg-[var(--bg-badge)]"
                              style={{ background: c.vendorNo === chosenNo ? "var(--nav-active-bg)" : "transparent" }}
                            >
                              <span className="flex items-center gap-1.5">
                                <span className="text-[11px] font-mono shrink-0" style={{ color: "var(--nav-active-text)" }}>{c.vendorNo}</span>
                                {sameTin && (
                                  <span className="text-[9px] px-1 rounded shrink-0"
                                    style={{ background: "var(--bg-info-green)", color: "var(--text-info-green)" }}>
                                    ตรงเลขภาษี
                                  </span>
                                )}
                                <span className="text-[11px] truncate" style={{ color: "var(--text-primary)" }}>{c.displayName ?? "—"}</span>
                              </span>
                              {c.taxRegistrationNumber && (
                                <span className="block text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>
                                  {c.taxRegistrationNumber}
                                </span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {!chosenNo && vat > 0 && (
              <span className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
                ยังไม่ได้เลือก Vendor — บรรทัดนี้มี VAT จึงอนุมัติไม่ได้จนกว่าจะเลือก
              </span>
            )}
          </div>
        </Field>
      </div>
    </div>
  );
}

/* ── small parts ── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
        {label}
        {hint && (
          <span className="ml-1.5 font-normal normal-case tracking-normal" style={{ color: "var(--text-faint)" }}>
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function Compare({
  label,
  name,
  branch,
  tone,
}: {
  label: string;
  name: string;
  branch: string;
  tone?: "ok";
}) {
  return (
    <span className="text-[11px] flex items-baseline gap-1.5">
      <span className="shrink-0" style={{ color: "var(--text-faint)", minWidth: "3.5rem" }}>
        {label}
      </span>
      <span style={{ color: tone === "ok" ? "var(--text-info-green)" : "var(--text-primary)" }}>
        {name}
        {branch ? ` · สาขา ${branch}` : ""}
      </span>
    </span>
  );
}

function CheckedAt({ at, onRefresh }: { at: string | null; onRefresh: () => void }) {
  return (
    <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--text-faint)" }}>
      {at ? `ตรวจเมื่อ ${fmtDay(at)}` : ""}
      <LinkButton onClick={onRefresh}>ตรวจใหม่</LinkButton>
    </span>
  );
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="underline cursor-pointer border-none bg-transparent p-0 text-[10px]"
      style={{ color: "var(--nav-active-text)" }}
    >
      {children}
    </button>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
      {children}
    </span>
  );
}

function Pill({ tone, label }: { tone: "ok" | "warn" | "muted"; label: string }) {
  const c =
    tone === "ok"
      ? { bg: "var(--bg-info-green)", text: "var(--text-info-green)", border: "var(--border-info-green)" }
      : tone === "warn"
        ? { bg: "var(--bg-info-yellow)", text: "var(--text-info-yellow)", border: "var(--border-info-yellow)" }
        : { bg: "var(--bg-badge)", text: "var(--text-muted)", border: "var(--border-light)" };
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {label}
    </span>
  );
}
