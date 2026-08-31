"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, Check, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { toast } from "sonner";
import { COUNTRIES, countryNames } from "@/lib/acc/country-currency";

/**
 * AP-17's จังหวัด/เมือง master.
 *
 * Deliberately **not** `TravelOptionSettings`. That component drives the four
 * dual-written option tables through a `[kind]` route with a `SortOrder` and a
 * drag reorder; `TravelProvince` has no `SortOrder`, lives in production only,
 * and must never go near `writeBothPools`. Reuse would drag all of that in
 * behind it.
 *
 * There is no delete, only on/off: every trip ever filed points at one of these
 * ids and the report filters on it.
 */

const ENDPOINT = "/api/request/travel-booking/settings/provinces";
const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PlaceRow {
  id: number;
  nameTh: string;
  nameEn: string | null;
  countryCode: string;
  isActive: boolean;
}

type Draft = { id: number | null; nameTh: string; nameEn: string; countryCode: string };

const EMPTY: Draft = { id: null, nameTh: "", nameEn: "", countryCode: "TH" };

/** The SVG assets in `public/flags/`, the same set the AP-1 country band uses. */
function Flag({ code }: { code: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={"/flags/" + code.toUpperCase() + ".svg"}
      alt=""
      width={18}
      height={13}
      className="rounded-[2px] shrink-0"
      style={{ objectFit: "cover", boxShadow: "0 0 0 1px var(--border-card)" }}
      onError={(e) => {
        (e.target as HTMLImageElement).style.visibility = "hidden";
      }}
    />
  );
}

export function TravelPlaceSettings() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: PlaceRow[] }>(ENDPOINT, fetcher);
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const rows = useMemo(() => data?.data ?? [], [data]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => {
      const names = countryNames(r.countryCode);
      return (
        r.nameTh.toLowerCase().indexOf(needle) >= 0 ||
        (r.nameEn ?? "").toLowerCase().indexOf(needle) >= 0 ||
        r.countryCode.toLowerCase().indexOf(needle) >= 0 ||
        (names?.th ?? "").toLowerCase().indexOf(needle) >= 0 ||
        (names?.en ?? "").toLowerCase().indexOf(needle) >= 0
      );
    });
  }, [rows, q]);

  const save = async () => {
    if (!draft) return;
    if (!draft.nameTh.trim()) {
      toast.error("กรุณากรอกชื่อภาษาไทย");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: draft.id,
          nameTh: draft.nameTh.trim(),
          nameEn: draft.nameEn.trim() || null,
          countryCode: draft.countryCode,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      toast.success(draft.id ? "แก้ไขแล้ว" : "เพิ่มแล้ว");
      setDraft(null);
      await mutate();
    } catch {
      toast.error("บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row: PlaceRow) => {
    setBusyId(row.id);
    try {
      const res = await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: row.id, isActive: !row.isActive }),
      });
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "เปลี่ยนสถานะไม่สำเร็จ");
        return;
      }
      await mutate();
    } catch {
      toast.error("เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* The honest statement of the shared-rows problem, and the only mechanism
          available: nothing in this repository can see or enforce the sibling's
          query. Rocks Fast selects these rows with no country filter, so a city
          added here appears in its own จังหวัด dropdown. */}
      <div
        className="flex items-start gap-2.5 rounded-xl px-3.5 py-3"
        style={{
          background: "color-mix(in srgb, var(--status-pending-bg) 70%, var(--bg-card-alt))",
          border: "1px solid var(--border-card)",
        }}
      >
        <AlertTriangle
          size={15}
          className="shrink-0 mt-0.5"
          style={{ color: "var(--text-warning)" }}
        />
        <p className="text-[12px] leading-relaxed m-0" style={{ color: "var(--text-secondary)" }}>
          รายการนี้ใช้ร่วมกับระบบ <strong>Rocks Fast</strong> — เมืองที่เพิ่มที่นี่จะไปปรากฏในแบบฟอร์มของระบบนั้นด้วย
        </p>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: "var(--text-faint)" }}
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ค้นหาจังหวัด เมือง หรือประเทศ..."
            className="w-full text-[13px] rounded-xl pl-9 pr-3 py-2.5 outline-none"
            style={{
              background: "var(--bg-card-alt)",
              border: "1px solid var(--border-card)",
              color: "var(--text-primary)",
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setDraft({ ...EMPTY })}
          className="flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-3.5 py-2.5 cursor-pointer shrink-0"
          style={{ background: "var(--color-action)", color: "#fff" }}
        >
          <Plus size={15} /> เพิ่ม
        </button>
      </div>

      {isLoading ? (
        <div
          className="flex items-center gap-2 text-[13px] py-8 justify-center"
          style={{ color: "var(--text-muted)" }}
        >
          <Loader2 size={15} className="animate-spin" /> กำลังโหลด...
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] text-center py-8 m-0" style={{ color: "var(--text-faint)" }}>
          {rows.length === 0 ? "ยังไม่มีข้อมูล" : "ไม่พบรายการที่ตรงกับการค้นหา"}
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((row) => {
            const names = countryNames(row.countryCode);
            return (
              <div
                key={row.id}
                className="flex items-center gap-3 rounded-xl px-3.5 py-2.5"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  opacity: row.isActive ? 1 : 0.55,
                }}
              >
                <Flag code={row.countryCode} />
                <div className="min-w-0 flex-1">
                  <span
                    className="text-[13px] font-semibold block truncate"
                    style={{ color: "var(--text-heading)" }}
                  >
                    {row.nameTh}
                  </span>
                  <span
                    className="text-[11px] block truncate"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {row.nameEn ? row.nameEn + " · " : ""}
                    {names ? names.th + " · " + names.en : row.countryCode}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setDraft({
                      id: row.id,
                      nameTh: row.nameTh,
                      nameEn: row.nameEn ?? "",
                      countryCode: row.countryCode,
                    })
                  }
                  aria-label={"แก้ไข " + row.nameTh}
                  className="p-1.5 rounded-lg cursor-pointer shrink-0"
                  style={{ color: "var(--text-muted)" }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => toggle(row)}
                  disabled={busyId === row.id}
                  className="text-[11px] font-semibold rounded-lg px-2.5 py-1.5 cursor-pointer shrink-0"
                  style={{
                    background: row.isActive ? "var(--status-ok-bg)" : "var(--bg-card)",
                    color: row.isActive ? "var(--status-ok-text)" : "var(--text-faint)",
                    border: "1px solid var(--border-card)",
                  }}
                >
                  {busyId === row.id ? "..." : row.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.35)" }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-5 flex flex-col gap-3.5"
            style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-[15px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
                {draft.id ? "แก้ไขจังหวัด/เมือง" : "เพิ่มจังหวัด/เมือง"}
              </h3>
              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="ปิด"
                className="p-1 rounded-lg cursor-pointer"
                style={{ color: "var(--text-muted)" }}
              >
                <X size={16} />
              </button>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                ชื่อภาษาไทย <span style={{ color: "var(--text-danger)" }}>*</span>
              </span>
              <input
                value={draft.nameTh}
                onChange={(e) => setDraft({ ...draft, nameTh: e.target.value })}
                placeholder="เช่น ลอนดอน"
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                ชื่อภาษาอังกฤษ
              </span>
              <input
                value={draft.nameEn}
                onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
                placeholder="London"
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              />
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
                ประเทศ <span style={{ color: "var(--text-danger)" }}>*</span>
              </span>
              <select
                value={draft.countryCode}
                onChange={(e) => setDraft({ ...draft, countryCode: e.target.value })}
                className="text-[13px] rounded-xl px-3 py-2.5 outline-none cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  border: "1px solid var(--border-card)",
                  color: "var(--text-primary)",
                }}
              >
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.nameTh} · {c.nameEn}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2 justify-end mt-1">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="text-[13px] font-semibold rounded-xl px-4 py-2.5 cursor-pointer"
                style={{
                  background: "var(--bg-card-alt)",
                  color: "var(--text-secondary)",
                  border: "1px solid var(--border-card)",
                }}
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving}
                className="flex items-center gap-1.5 text-[13px] font-semibold rounded-xl px-4 py-2.5 cursor-pointer"
                style={{
                  background: "var(--color-action)",
                  color: "#fff",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                บันทึก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
