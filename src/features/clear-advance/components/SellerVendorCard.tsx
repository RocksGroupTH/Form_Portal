"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClearAdvanceItem } from "@/features/clear-advance/types";
import { sameRegisteredName } from "@/lib/clr/rd-vat-core";

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

export function SellerVendorCard({ index, item, brandCode, onChange }: Props) {
  const tin = (item.taxId ?? "").replace(/\D/g, "");
  const hasTin = tin.length === 13;
  const vat = Number(item.vatAmount ?? 0);
  const total = Number(item.amountBeforeVat ?? 0) + vat;

  const [rd, setRd] = useState<RdState>({ state: "idle" });
  const [vendors, setVendors] = useState<TaxVendorCandidate[] | "loading" | null>(null);
  const [chosenName, setChosenName] = useState<string | null>(null);
  const [nameTerm, setNameTerm] = useState("");

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

  const search = useCallback(
    async (qs: string): Promise<TaxVendorCandidate[]> => {
      setVendors("loading");
      try {
        const res = await fetch(
          `/api/request/clear-advance/tax-vendors?brand=${encodeURIComponent(brandCode ?? "")}&${qs}`,
        );
        const j = (await res.json()) as { ok: boolean; data?: TaxVendorCandidate[]; error?: string };
        if (!j.ok) {
          toast.error(j.error ?? "ค้นหา Vendor ไม่สำเร็จ");
          setVendors([]);
          return [];
        }
        const data = j.data ?? [];
        setVendors(data);
        return data;
      } catch {
        setVendors([]);
        return [];
      }
    },
    [brandCode],
  );

  /* Ask the registry when the card opens, once per tax id. The answer is kept in
     our own table and never expires, so the ordinary case is a row read; making
     someone click for it bought nothing. */
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!hasTin || askedFor.current === tin) return;
    askedFor.current = tin;
    void checkRd();
  }, [hasTin, tin, checkRd]);

  /* A vendor already chosen arrives as a number alone — the name lives in BC.
     Resolve it once so the card names who was picked instead of showing a code
     nobody can check. */
  const namedFor = useRef<string | null>(null);
  useEffect(() => {
    const no = (item.taxVendorNo ?? "").trim();
    if (!no || !hasTin || chosenName || namedFor.current === no) return;
    namedFor.current = no;
    void (async () => {
      const found = await search(`taxId=${tin}`);
      const hit = found.find((c) => c.vendorNo === no);
      if (hit?.displayName) setChosenName(hit.displayName);
      setVendors(null); // the list was a lookup, not an offer to choose again
    })();
  }, [item.taxVendorNo, hasTin, tin, chosenName, search]);

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

  const needsVendor = vat > 0 && !(item.taxVendorNo ?? "").trim();

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
              <span className="text-[11px]" style={{ color: "var(--text-info-yellow)" }}>
                ไม่พบในทะเบียน VAT — ภาษีซื้อจากใบนี้อาจขอคืนไม่ได้
              </span>
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
        <Field label="Vendor (BC)" hint={vat > 0 ? "ต้องระบุ — ใช้เป็น Tax Vendor No. บนบรรทัด VAT" : "ไม่บังคับ — บรรทัดนี้ไม่มี VAT"}>
          {(item.taxVendorNo ?? "").trim() ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px]" style={{ color: "var(--text-info-green)" }}>
                ✓ {item.taxVendorNo}
                {chosenName ? ` · ${chosenName}` : ""}
              </span>
              <LinkButton
                onClick={() => {
                  onChange({ taxVendorNo: null });
                  setChosenName(null);
                  namedFor.current = null;
                  setVendors(null);
                }}
              >
                เปลี่ยน
              </LinkButton>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  disabled={!hasTin}
                  onClick={() => void search(`taxId=${tin}`)}
                  title={hasTin ? undefined : "ต้องมีเลขผู้เสียภาษี 13 หลักก่อน"}
                  className="text-[11px] px-2 py-1 rounded-lg"
                  style={{
                    background: "var(--bg-badge)",
                    color: "var(--text-secondary)",
                    border: "none",
                    opacity: hasTin ? 1 : 0.45,
                    cursor: hasTin ? "pointer" : "not-allowed",
                  }}
                >
                  ค้นจากเลขภาษี
                </button>
                <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                  หรือ
                </span>
                <input
                  value={nameTerm}
                  onChange={(e) => setNameTerm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const q = (nameTerm || invoiceName).trim();
                    if (q) void search(`name=${encodeURIComponent(q)}`);
                  }}
                  placeholder={invoiceName ? `ชื่อผู้ขาย — ว่างไว้ = ${invoiceName.slice(0, 18)}` : "ชื่อผู้ขาย"}
                  className="text-[11px] px-2 py-1 rounded-lg flex-1 outline-none"
                  style={{
                    background: "var(--bg-input)",
                    color: "var(--text-primary)",
                    border: "1px solid var(--border-input)",
                    minWidth: "12rem",
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    const q = (nameTerm || invoiceName).trim();
                    if (!q) return toast.error("พิมพ์ชื่อผู้ขายที่จะค้น");
                    void search(`name=${encodeURIComponent(q)}`);
                  }}
                  className="text-[11px] px-2 py-1 rounded-lg cursor-pointer"
                  style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", border: "none" }}
                >
                  ค้นจากชื่อ
                </button>
              </div>

              {vendors === "loading" && <Muted>กำลังค้น…</Muted>}
              {Array.isArray(vendors) && vendors.length === 0 && (
                <Muted>ไม่พบ Vendor — ลองค้นด้วยชื่อ หรือเปิดการ์ดผู้ขายใน BC ก่อน</Muted>
              )}
              {Array.isArray(vendors) && vendors.length > 0 && (
                <div
                  className="rounded-lg overflow-y-auto"
                  style={{ border: "1px solid var(--border-light)", maxHeight: "11rem" }}
                >
                  <p
                    className="text-[10px] m-0 px-2 py-1 sticky top-0"
                    style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
                  >
                    {vendors.length} รายการ — เลือกหนึ่ง
                  </p>
                  {vendors.map((c) => (
                    <button
                      key={c.vendorNo}
                      type="button"
                      onClick={() => {
                        onChange({ taxVendorNo: c.vendorNo });
                        setChosenName(c.displayName);
                        namedFor.current = c.vendorNo;
                        setVendors(null);
                      }}
                      className="w-full text-left px-2 py-1 text-[11px] flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-badge)]"
                      style={{ background: "transparent", border: "none", color: "var(--text-primary)" }}
                    >
                      <span className="font-mono shrink-0" style={{ color: "var(--nav-active-text)" }}>
                        {c.vendorNo}
                      </span>
                      <span className="truncate">{c.displayName ?? "—"}</span>
                      {c.taxRegistrationNumber && (
                        <span
                          className="ml-auto shrink-0 font-mono text-[10px]"
                          style={{ color: "var(--text-faint)" }}
                        >
                          {c.taxRegistrationNumber}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
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
