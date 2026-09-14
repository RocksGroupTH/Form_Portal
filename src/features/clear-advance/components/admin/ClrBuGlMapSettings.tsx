"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Save, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import { EmptyRow, LoadingRow, ForbiddenState, isForbiddenStatus } from "./shared";

/**
 * BU → G/L for the expense line.
 *
 * A store the company owns books its expense to the account it was coded to; a
 * franchised or managed one books it to a receivable, because the money is
 * charged back. The BU dimension already sits on every journal line, so that is
 * what the rule keys on.
 *
 * The screen lists every BU the Company's Locations actually carry — not a
 * free-text box — because a rule typed against a BU no Location uses is a rule
 * that never fires and nothing would say so. Blank means no rule: that BU keeps
 * the account the expense was coded to, which is what every line did before this
 * table existed.
 */

interface Rule {
  id: number;
  company: string;
  buCode: string;
  glAccountNo: string;
  isActive: boolean;
  note: string | null;
}
interface Bu {
  buCode: string;
  locations: number;
}
interface BranchRule {
  id: number;
  branchCode: string;
  glAccountNo: string;
  isActive: boolean;
  note: string | null;
}

export function ClrBuGlMapSettings() {
  const [company, setCompany] = useState(ERP_INTERFACE_BRANDS[0]?.id ?? "PCTH");
  const [rules, setRules] = useState<Rule[]>([]);
  const [bus, setBus] = useState<Bu[]>([]);
  const [branchRules, setBranchRules] = useState<BranchRule[]>([]);
  const [newBranch, setNewBranch] = useState("");
  const [newBranchGl, setNewBranchGl] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [savingBu, setSavingBu] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/request/clear-advance/settings/bu-gl-map?company=${encodeURIComponent(company)}`,
      );
      if (isForbiddenStatus(res.status)) {
        setForbidden(true);
        return;
      }
      const j = (await res.json()) as {
        ok: boolean;
        data?: { rules: Rule[]; bus: Bu[]; branchRules: BranchRule[] };
        error?: string;
      };
      if (!j.ok) {
        toast.error(j.error ?? "โหลดไม่สำเร็จ");
        return;
      }
      setRules(j.data?.rules ?? []);
      setBus(j.data?.bus ?? []);
      setBranchRules(j.data?.branchRules ?? []);
      setDraft({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    void load();
  }, [load]);

  const stored = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of rules) if (r.isActive) m[r.buCode.toUpperCase()] = r.glAccountNo;
    return m;
  }, [rules]);

  const save = useCallback(
    async (buCode: string) => {
      const value = (draft[buCode] ?? stored[buCode] ?? "").trim();
      setSavingBu(buCode);
      try {
        const res = await fetch("/api/request/clear-advance/settings/bu-gl-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company, buCode, glAccountNo: value }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!j.ok) {
          toast.error(j.error ?? "บันทึกไม่สำเร็จ");
          return;
        }
        toast.success(value ? `${buCode} → ${value}` : `${buCode} — ใช้บัญชีตามค่าใช้จ่าย`);
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
      } finally {
        setSavingBu(null);
      }
    },
    [company, draft, stored, load],
  );

  const saveBranch = useCallback(
    async (branchCode: string, glAccountNo: string) => {
      const code = branchCode.trim().toUpperCase();
      if (!code) return toast.error("ระบุรหัสสาขา");
      setSavingBu(`branch:${code}`);
      try {
        const res = await fetch("/api/request/clear-advance/settings/bu-gl-map", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ company, branchCode: code, glAccountNo: glAccountNo.trim() }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!j.ok) return void toast.error(j.error ?? "บันทึกไม่สำเร็จ");
        toast.success(glAccountNo.trim() ? `สาขา ${code} → ${glAccountNo.trim()}` : `ลบกฎสาขา ${code}`);
        setNewBranch("");
        setNewBranchGl("");
        await load();
      } finally {
        setSavingBu(null);
      }
    },
    [company, load],
  );

  if (forbidden) return <ForbiddenState />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
            Company (ปลายทางที่ลง Journal)
          </span>
          <select
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="text-[13px] px-3 py-2 rounded-lg outline-none cursor-pointer"
            style={{ background: "var(--bg-card)", border: "1px solid var(--border-input)", color: "var(--text-primary)" }}
          >
            {ERP_INTERFACE_BRANDS.map((b) => (
              <option key={b.id} value={b.id}>{b.id}</option>
            ))}
          </select>
        </label>
        <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void load()}>
          โหลดใหม่
        </Button>
      </div>

      <p className="text-[12px] m-0 px-3 py-2 rounded-lg"
        style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}>
        ใช้กับ <b>บรรทัดค่าใช้จ่าย</b> เท่านั้น — บรรทัด VAT / ธนาคาร / เวนเดอร์ / หัก ณ ที่จ่าย
        มีบัญชีของตัวเอง · <b>เว้นว่าง = ใช้บัญชีตามค่าใช้จ่าย</b> (เหมือนก่อนมีตารางนี้) ·
        แบรนด์ที่ไม่ใช่ ROCKS PC ถูกบังคับเป็น 110723001 ตั้งแต่ตอนบันทึกอยู่แล้ว กฎนี้จึงไม่ถูกใช้
      </p>

      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}>
              {["BU", "จำนวน Location", "บัญชี G/L", "", ""].map((h, i) => (
                <th key={h + i} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap"
                  style={{ color: "var(--text-secondary)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <LoadingRow />
            ) : bus.length === 0 ? (
              <EmptyRow label="— ไม่พบ BU ใน Location ของบริษัทนี้ (sync Location ก่อน) —" />
            ) : (
              bus.map((b) => {
                const key = b.buCode.toUpperCase();
                const current = stored[key] ?? "";
                const value = draft[key] ?? current;
                const dirty = value.trim() !== current;
                return (
                  <tr key={b.buCode} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {b.buCode}
                    </td>
                    <td className="px-3 py-2 tabular-nums whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                      {b.locations}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        value={value}
                        onChange={(e) => setDraft((p) => ({ ...p, [key]: e.target.value }))}
                        onKeyDown={(e) => { if (e.key === "Enter" && dirty) void save(b.buCode); }}
                        placeholder="ว่าง = บัญชีตามค่าใช้จ่าย"
                        className="text-[13px] px-2 py-1 rounded-lg outline-none w-48 font-mono"
                        style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }}
                      />
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {dirty && (
                        <Button variant="primary" size="sm" icon={<Save size={13} />}
                          loading={savingBu === b.buCode} onClick={() => void save(b.buCode)}>
                          บันทึก
                        </Button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap" style={{ color: "var(--text-faint)" }}>
                      {current ? `ปัจจุบัน ${current}` : "ยังไม่ตั้งกฎ"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Branch rules. Separate from the BU table because they answer a
          different question — which shop, not which kind of shop — and because
          some branches have no BU at all: RFM is a BRANCH dimension value with
          no Location behind it, so no BU rule could ever reach it. */}
      <div className="flex flex-col gap-2">
        <p className="text-[13px] font-bold m-0" style={{ color: "var(--text-heading)" }}>
          กฎรายสาขา (ชนะกฎ BU)
        </p>
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          สาขาที่ระบุไว้ที่นี่จะใช้บัญชีนี้เสมอ ไม่สนใจ BU · สาขาที่ไม่มีในตารางนี้จะไปใช้กฎ BU ต่อ
        </p>

        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-card)" }}>
          <table className="w-full text-[13px] border-collapse">
            <thead>
              <tr style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}>
                {["สาขา", "บัญชี G/L", "หมายเหตุ", ""].map((h, i) => (
                  <th key={h + i} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap"
                    style={{ color: "var(--text-secondary)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branchRules.length === 0 ? (
                <EmptyRow label="— ยังไม่มีกฎรายสาขา —" />
              ) : (
                branchRules.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border-light)" }}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap font-mono" style={{ color: "var(--text-primary)" }}>
                      {r.branchCode}
                    </td>
                    <td className="px-3 py-2 font-mono whitespace-nowrap" style={{ color: "var(--text-primary)" }}>
                      {r.glAccountNo}
                    </td>
                    <td className="px-3 py-2 text-[12px]" style={{ color: "var(--text-muted)" }}>{r.note ?? "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm"
                        loading={savingBu === `branch:${r.branchCode.toUpperCase()}`}
                        onClick={() => void saveBranch(r.branchCode, "")}>
                        ลบกฎ
                      </Button>
                    </td>
                  </tr>
                ))
              )}
              <tr style={{ background: "var(--bg-card-alt)" }}>
                <td className="px-3 py-2">
                  <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)}
                    placeholder="รหัสสาขา เช่น RFM"
                    className="text-[13px] px-2 py-1 rounded-lg outline-none w-40 font-mono"
                    style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }} />
                </td>
                <td className="px-3 py-2">
                  <input value={newBranchGl} onChange={(e) => setNewBranchGl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveBranch(newBranch, newBranchGl); }}
                    placeholder="บัญชี G/L"
                    className="text-[13px] px-2 py-1 rounded-lg outline-none w-40 font-mono"
                    style={{ background: "var(--bg-input)", color: "var(--text-primary)", border: "1px solid var(--border-input)" }} />
                </td>
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <Button variant="primary" size="sm" icon={<Save size={13} />}
                    loading={savingBu === `branch:${newBranch.trim().toUpperCase()}`}
                    onClick={() => void saveBranch(newBranch, newBranchGl)}>
                    เพิ่มกฎ
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}