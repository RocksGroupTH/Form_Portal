"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Circle, Search } from "lucide-react";
import { useErpInterfaceBrands } from "@/lib/hooks/useErpInterfaceBrands";
import {
  dimensionChecks,
  nextDimension,
  type DimensionKind,
  type DimensionType,
} from "@/lib/clr/gl-dimension";
import { nameOverrideFor } from "@/lib/clr/gl-name";
import { ErpSyncButton } from "./ErpSyncButton";
import {
  fetchList,
  postJson,
  ForbiddenState,
  LoadingRow,
  EmptyRow,
} from "./shared";

/**
 * One category as ONE company sees it.
 *
 * `dimensionType: null` means this company has no rule for the category yet —
 * the state a company added after migration 151's backfill is in, and the one
 * every company but the creator is in for a new category. It is not a default
 * of Employee: a tick nobody made would hide exactly the gap this screen
 * exists to close.
 */
interface GlCompanyRow {
  id: number;
  glAccountNo: string;
  nameTh: string | null;
  nameEn: string | null;
  sortOrder: number;
  dimensionType: DimensionType | null;
  isActive: boolean;
  /** The stored Thai override, or null where `nameTh` is Business Central's. */
  nameThCustom: string | null;
  /** Business Central's own wording, which `nameTh` falls back to. */
  nameErp: string | null;
  /** A rule on an account the sync no longer returns — live, and said so on the row. */
  missingFromErp?: boolean;
}

/*
 * `AddGlDialog` lived here and is deleted (2026-09-14).
 *
 * The screen lists the company's whole postable chart of accounts now, so
 * there is nothing to add: ticking a Dimension on an account IS what makes it
 * a category, and `setGlCompanyRule` creates the register row on that first
 * tick. A dialog that typed an account number by hand could only ever name one
 * of the rows already on screen — or one that does not exist.
 */

/**
 * One name box.
 *
 * **Uncontrolled, and committed on blur.** A controlled input would re-render
 * all 584 rows on every keystroke, and a save per keystroke would be a write
 * per letter. `key` is what makes a reload show the saved value: an
 * uncontrolled input keeps whatever was typed unless React replaces the
 * element, so the key carries the value the server last answered with.
 */
function NameInput({
  defaultValue,
  placeholder,
  disabled,
  ariaLabel,
  onCommit,
}: {
  defaultValue: string;
  placeholder: string;
  disabled?: boolean;
  ariaLabel: string;
  onCommit: (value: string) => void;
}) {
  return (
    <input
      key={defaultValue}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      maxLength={200}
      onBlur={(e) => {
        // One handler: the style reset and the commit are the same event, and
        // splitting them across onBlur/onBlurCapture only made the order a
        // thing a reader has to work out.
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.borderColor = "var(--border-light)";
        onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      // A faint border at rest, a real one on focus. Invisible until clicked,
      // these read as plain text and nobody discovers the column can be
      // edited at all — which is what happened.
      className="w-full text-[12px] px-2 py-1 rounded-lg outline-none"
      style={{
        background: "transparent",
        color: "var(--text-primary)",
        border: "1px solid var(--border-light)",
      }}
      onFocus={(e) => {
        e.currentTarget.style.background = "var(--bg-input)";
        e.currentTarget.style.borderColor = "var(--border-input)";
      }}
    />
  );
}

export function ClrGlAccountSettings({
  endpoint = "/api/request/clear-advance/settings/gl-accounts",
  syncEndpoint = "/api/request/clear-advance/settings/erp-sync",
}: {
  /**
   * This form's own path onto the shared rows. AP-3 and AP-4 show the same
   * screen over the same categories; only the path differs, because
   * `ROUTE_RULES` classifies by path and these rows are read through
   * `getAccPool()` — a tester with one form in UAT must not edit production's
   * rows from a UAT screen.
   */
  endpoint?: string;
  syncEndpoint?: string;
} = {}) {
  // PCTH by default, as asked — it is the company nearly every AP-3 clearing
  // posts into, ROCKS claims included.
  /* The Company list is fetched now rather than imported — it is whichever
     brands have a complete Config BC. So the initial value cannot name one:
     it starts empty and the effect below adopts the first brand the moment the
     list lands, which is also what re-seeds the screen if an admin completes a
     brand's Config BC in another tab and the list comes back longer. */
  const { brands: ifaceBrands } = useErpInterfaceBrands();
  const [company, setCompany] = useState("");
  useEffect(() => {
    if (!company && ifaceBrands.length > 0) setCompany(ifaceBrands[0].id);
  }, [company, ifaceBrands]);
  const [rows, setRows] = useState<GlCompanyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  /** Which rows to show. 584 accounts is too many to read without it. */
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");

  const load = useCallback(async () => {
    const { data, forbidden } = await fetchList<GlCompanyRow>(
      `${endpoint}?company=${encodeURIComponent(company)}`,
    );
    setForbidden(forbidden);
    setRows(data);
  }, [company, endpoint]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  /**
   * Write one company's rule for one category.
   *
   * Both halves always travel together — the dimension and the switch are one
   * row, and sending only the one that changed would need the server to read
   * the other back, which is a second answer to the same question.
   */
  async function saveRule(row: GlCompanyRow, dimensionType: DimensionType, isActive: boolean) {
    setBusy(true);
    try {
      await postJson(endpoint, {
        mode: "rule",
        company,
        glAccountNo: row.glAccountNo,
        dimensionType,
        isActive,
        // What the row is showing — Business Central's name, unless accounting
        // has given this account one of its own. Used only on a first tick.
        nameTh: row.nameTh,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Rename one category — **on blur, not on every keystroke**, and shared by
   * every company.
   *
   * The Thai box holds the stored OVERRIDE and shows Business Central's name as
   * its placeholder, so an empty box means "follow BC" and clearing it removes
   * an override. Pre-filling it with BC's name would freeze today's wording
   * into the register the first time somebody tabbed through the row.
   */
  async function saveNames(row: GlCompanyRow, nameTh: string, nameEn: string) {
    // **Typing Business Central's own wording back is not an override.** The box
    // is filled with it, so tabbing through a row must store nothing — and
    // clearing the box means the same thing, "follow BC", which is why both
    // resolve to null. Without this the first tab through the column would
    // freeze today's BC wording into the register on every row it touched.
    const stored = nameOverrideFor(nameTh, row.nameErp);
    if (stored === (row.nameThCustom ?? null) && (row.nameEn ?? "") === nameEn.trim()) return;
    setBusy(true);
    try {
      await postJson(endpoint, {
        mode: "names",
        glAccountNo: row.glAccountNo,
        // `stored`, not what was typed: the register holds an override or
        // nothing, and "the same as BC" is nothing.
        nameTh: stored ?? "",
        nameEn,
        // Only used if this account has no register row yet, so naming an
        // account nobody has ticked does not lose BC's own wording.
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * One click on one dimension box.
   *
   * **Unticking the last box is refused**, with the reason — see
   * `nextDimension`. A category nobody should charge is switched off with
   * ใช้งาน, which is what the message says.
   */
  function toggleDimension(row: GlCompanyRow, kind: DimensionKind, checked: boolean) {
    // Passed straight through, null and all: a stand-in here turned one tick
    // into two — see `nextDimension`.
    const change = nextDimension(row.dimensionType, kind, checked);
    if (change.kind === "clear") return void clearRule(row);
    void saveRule(row, change.dimensionType, row.isActive);
  }

  /**
   * Unticking the last box removes this company's rule outright — the account
   * goes back to "ยังไม่ได้ตั้งค่า", which is where it was before anybody ticked
   * it. Said in a toast rather than behind a confirm: it is the way OUT of a
   * mistaken tick, and a dialog in front of an undo is a dialog in the way.
   */
  async function clearRule(row: GlCompanyRow) {
    setBusy(true);
    try {
      await postJson(endpoint, { mode: "clear", company, glAccountNo: row.glAccountNo });
      toast.success(`${row.glAccountNo} — ล้างการตั้งค่าของ ${company} แล้ว`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "ล้างการตั้งค่าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * One click on ใช้งาน.
   *
   * **A category with no dimension cannot be switched on** — there would be
   * nothing saying what a line charging it must carry. The box is disabled in
   * that state as well, so this is the second of two layers rather than the
   * only one.
   */
  function toggleActive(row: GlCompanyRow, isActive: boolean) {
    if (!row.dimensionType) {
      return void toast.error("เลือก Dimension อย่างน้อย 1 อย่างก่อนเปิดใช้งาน");
    }
    void saveRule(row, row.dimensionType, isActive);
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "on" && !r.isActive) return false;
      if (filter === "off" && r.isActive) return false;
      if (!q) return true;
      return (
        r.glAccountNo.toLowerCase().includes(q) ||
        (r.nameTh ?? "").toLowerCase().includes(q) ||
        (r.nameEn ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, filter]);

  const activeCount = useMemo(() => rows.filter((r) => r.isActive).length, [rows]);

  if (forbidden) return <ForbiddenState />;
  if (loading) return <LoadingRow />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-[14px] font-bold" style={{ color: "var(--text-heading)" }}>
          หมวดบัญชี G/L (AP-3.2)
        </h3>
        <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
          รายการบัญชีแยกประเภทที่เลือกได้ตอนเคลียร์เงินทดรอง · Dimension และการใช้งาน{" "}
          <b>แยกตามบริษัท</b> · เลขบัญชีและชื่อใช้ร่วมกันทุกบริษัท
        </p>
      </div>

      {/* The BC company, not the claim brand: a ROCKS clearing posts into
          PCTH's books and reads PCTH's rules. */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
          Company (ปลายทางที่ลง Journal)
        </span>
        <div className="flex flex-wrap gap-2">
          {ifaceBrands.map((b) => {
            const on = b.id === company;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setCompany(b.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                style={{
                  background: on ? "var(--nav-active-bg)" : "var(--bg-card)",
                  border: `1px solid ${on ? "var(--nav-active-text)" : "var(--border-card)"}`,
                  color: on ? "var(--nav-active-text)" : "var(--text-secondary)",
                }}
              >
                {b.logo ? (
                  <img src={b.logo} alt="" className="h-5 w-auto object-contain" />
                ) : null}
                <span className="text-[13px] font-bold">{b.id}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
          {company}: {activeCount} หมวดที่ใช้งานอยู่ / {rows.length} หมวดทั้งหมด
        </p>
      </div>

      {/* Toolbar: search + add */}
      <div className="flex items-center gap-2">
        <ErpSyncButton
          endpoint={syncEndpoint}
          company={company}
          target="glAccounts"
          onDone={load}
        />
        <div
          className="flex items-center gap-2 flex-1 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)" }}
        >
          <Search size={14} style={{ color: "var(--text-muted)" }} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเลขบัญชี / ชื่อ..."
            className="flex-1 text-[13px] outline-none bg-transparent"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        {/* Not a dropdown: three states, and which one is showing has to be
            readable at a glance on a list this long. */}
        <div
          className="inline-flex rounded-lg overflow-hidden shrink-0"
          style={{ border: "1px solid var(--border-input)" }}
        >
          {([
            ["all", "ทั้งหมด", rows.length],
            ["on", "ใช้งานอยู่", activeCount],
            ["off", "ยังไม่ใช้งาน", rows.length - activeCount],
          ] as const).map(([key, label, n]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="px-3 py-2 text-[12px] font-semibold cursor-pointer border-none whitespace-nowrap"
              style={{
                background: filter === key ? "var(--nav-active-bg)" : "var(--bg-card)",
                color: filter === key ? "var(--nav-active-text)" : "var(--text-muted)",
              }}
            >
              {label} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] m-0" style={{ color: "var(--text-faint)" }}>
        {/* Said once, where somebody wondering "where is 610xxxxx?" will read
            it, rather than left to be discovered. */}
        แสดงผังบัญชีของ {company} ที่ลงรายการได้จริง — หัวบัญชีและยอดรวมไม่อยู่ในรายการนี้ ·
        ติ๊ก Dimension คือการเปิดบัญชีนั้นให้ AP-3 ใช้ · <b>ชื่อใช้ร่วมกันทุกบริษัท</b> —
        แก้ที่นี่มีผลกับทุกบริษัท · ชื่อไทยเริ่มต้นมาจาก Business Central — พิมพ์ทับได้ ลบให้ว่างคือกลับไปใช้ของ BC
      </p>

      {/* Table */}
      <div
        className="rounded-xl overflow-x-auto"
        style={{ border: "1px solid var(--border-card)" }}
      >
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr style={{ background: "var(--bg-badge)" }}>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                เลขที่บัญชี
              </th>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                ชื่อ (ไทย)
              </th>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                ชื่อ (อังกฤษ)
              </th>
              <th className="text-left font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                Dimension
              </th>
              <th className="text-center font-bold px-3 py-2.5" style={{ color: "var(--text-secondary)" }}>
                ใช้งาน
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              // The helper builds its own row now — see `EmptyRow`'s note on
              // why one that does NOT is a hydration error waiting to happen.
              <EmptyRow label="— ไม่พบหมวดบัญชี —" colSpan={5} />
            ) : (
              filtered.map((r) => (
                <tr
                  key={r.glAccountNo}
                  // No fade on an inactive row any more: with the whole chart
                  // of accounts listed, OFF is most rows rather than the
                  // exception, and fading them would grey out the page.
                  style={{ borderTop: "1px solid var(--border-card)" }}
                >
                  <td
                    className="px-3 py-2.5 font-bold whitespace-nowrap"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {r.glAccountNo}
                    {r.missingFromErp && (
                      <span
                        className="block text-[10px] font-normal"
                        style={{ color: "var(--text-warning)" }}
                        title="มีกฎอยู่ แต่ไม่พบบัญชีนี้ในผังบัญชีที่ sync มา"
                      >
                        ไม่อยู่ในผังบัญชีแล้ว
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <NameInput
                      // The name the row actually shows, override or Business
                      // Central's. It held only the override before, so 541 of
                      // 584 boxes rendered as grey placeholder text and read as
                      // missing data rather than as "following BC".
                      defaultValue={r.nameTh ?? ""}
                      placeholder="—"
                      disabled={busy}
                      ariaLabel={`ชื่อไทยของ ${r.glAccountNo}`}
                      onCommit={(v) => void saveNames(r, v, r.nameEn ?? "")}
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <NameInput
                      defaultValue={r.nameEn ?? ""}
                      // Nothing to fall back to: Business Central carries one
                      // name and it is Thai. An empty box with a visible border
                      // says "type here" better than a dash does.
                      placeholder=""
                      disabled={busy}
                      ariaLabel={`ชื่ออังกฤษของ ${r.glAccountNo}`}
                      onCommit={(v) => void saveNames(r, r.nameTh ?? "", v)}
                    />
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-3">
                      {(["branch", "employee"] as const).map((kind) => (
                        <label key={kind} className="inline-flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={r.dimensionType ? dimensionChecks(r.dimensionType)[kind] : false}
                            disabled={busy}
                            onChange={(e) => toggleDimension(r, kind, e.target.checked)}
                            aria-label={`${kind === "branch" ? "สาขา" : "พนักงาน"} — ${r.glAccountNo}`}
                          />
                          <span style={{ color: "var(--text-secondary)" }}>
                            {kind === "branch" ? "Branch" : "Employee"}
                          </span>
                        </label>
                      ))}
                      {!r.dimensionType && (
                        <span className="text-[11px]" style={{ color: "var(--text-warning)" }}>
                          ยังไม่ได้ตั้งค่าให้ {company}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {/* A button rather than a checkbox: on a list this long the
                        eye needs to find the ON rows without reading, and a
                        native checkbox is the same grey square either way.
                        Disabled — not merely refused on click — while the row
                        has no Dimension, because a control that cannot do
                        anything should not invite the click. */}
                    <button
                      type="button"
                      disabled={busy || !r.dimensionType}
                      onClick={() => toggleActive(r, !r.isActive)}
                      aria-pressed={r.isActive}
                      aria-label={`${r.isActive ? "ปิด" : "เปิด"}ใช้งาน ${r.glAccountNo}`}
                      title={
                        r.dimensionType
                          ? r.isActive
                            ? "ใช้งานอยู่ — กดเพื่อปิด"
                            : "ปิดอยู่ — กดเพื่อเปิด"
                          : "เลือก Dimension อย่างน้อย 1 อย่างก่อน"
                      }
                      className="inline-flex items-center justify-center rounded-full cursor-pointer border-none p-1 disabled:cursor-not-allowed disabled:opacity-40"
                      style={{ background: "transparent" }}
                    >
                      {r.isActive ? (
                        <CheckCircle2 size={18} style={{ color: "var(--color-success)" }} />
                      ) : (
                        <Circle size={18} style={{ color: "var(--text-faint)" }} />
                      )}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

    </div>
  );
}
