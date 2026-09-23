"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, RotateCcw, Trash2, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { CodeNamePicker, type CodeNameOption } from "@/components/ui/CodeNamePicker";
import { useErpInterfaceBrands } from "@/lib/hooks/useErpInterfaceBrands";
import { ErpSyncButton } from "@/features/clear-advance/components/admin/ErpSyncButton";
import {
  groupRulesByAccount,
  type BranchRuleRow,
  type BuRow,
  type BuRuleRow,
  type MemberKind,
} from "@/lib/acc/bu-gl-groups";

/**
 * **Fix G/L by BU or Branch** — which G/L account a shop's spend books to.
 * **AP-3's screen and AP-4's**, under that one name on both strips.
 *
 * **Grouped by the ACCOUNT, not by the shop**, which is the question an
 * accountant actually has: *which shops book to this receivable?* The rows are
 * `AccClrBuGlMap` and `AccClrBranchGlMap`, which carry **no `FormCode`
 * column** — which account an expense books to is a fact about a shop, not
 * about the form the expense arrived on — so both forms read and write the
 * same rules and the banner says so.
 *
 * **One screen, two paths.** `endpoint` is per form and is not decoration:
 * `ROUTE_RULES` classifies by path, and these rows are read through
 * `getAccPool()`, so a tester with AP-4 in UAT and AP-3 in production must not
 * edit production's rules from a UAT screen. AP-3's own `ClrBuGlMapSettings` —
 * a row per BU with a box to type into — was replaced by this on 2026-09-14
 * and deleted; it also put a `<p>` straight inside a `<tbody>`, which is what
 * the dev overlay was reporting as a hydration error on that tab.
 *
 * Three things about the shape that are consequences of the schema rather than
 * choices, and are said out loud on screen for the same reason:
 *
 * - **A group is not stored.** It is the set of accounts some rule names. So a
 *   group with no members cannot be saved — a new one lives on this screen
 *   until its first member is added — and removing the last member makes the
 *   group disappear.
 * - **Adding is an upsert, so adding IS moving.** The picker offers every BU
 *   and every branch, and labels the ones already ruled with the account they
 *   sit in, so choosing one visibly moves it rather than looking like a fresh
 *   assignment.
 * - **`ยังไม่ตั้งกฎ` lists BUs only.** A Company carries a handful of BUs and
 *   several hundred branches; listing the branches would bury everything else.
 *   A branch with no rule is reachable from the Add picker, which is the real
 *   BRANCH dimension list.
 *
 * Every list is a real one — BUs from the synced Locations, branches from the
 * BRANCH dimension, accounts from `ErpAccounts`. A rule typed against a code
 * that does not exist never fires and nothing would say so.
 */

interface Payload {
  rules: BuRuleRow[];
  bus: BuRow[];
  branchRules: BranchRuleRow[];
  branches: { code: string; displayName: string | null }[];
  glAccounts: { accountNo: string; displayName: string | null }[];
}

const EMPTY: Payload = { rules: [], bus: [], branchRules: [], branches: [], glAccounts: [] };

export function BuGlAccountSettings({
  endpoint,
  syncEndpoint,
  sharedNote,
}: {
  /** This form's own path onto the shared rows — see the component note. */
  endpoint: string;
  /** This form's own path for pulling the lists this screen picks from. */
  syncEndpoint: string;
  /** One line naming the other form these rules also apply to. */
  sharedNote: string;
}) {
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
  const [data, setData] = useState<Payload>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  /**
   * Accounts with a group on screen but no member yet.
   *
   * Client-side only, and it has to be: the database stores a rule per shop, so
   * an account nothing points at has nothing to store. Cleared on every reload,
   * which is honest — a group nobody filled in did not survive.
   */
  const [draftAccounts, setDraftAccounts] = useState<string[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<MemberKind>("bu");
  const [addCode, setAddCode] = useState<string | null>(null);
  const [newAccount, setNewAccount] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${endpoint}?company=${encodeURIComponent(company)}`);
      if (res.status === 401 || res.status === 403) {
        setForbidden(true);
        return;
      }
      const j = (await res.json()) as { ok: boolean; data?: Payload; error?: string };
      if (!j.ok || !j.data) {
        toast.error(j.error ?? "โหลดข้อมูลไม่สำเร็จ");
        return;
      }
      setForbidden(false);
      setData({ ...EMPTY, ...j.data });
      setDraftAccounts([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [company, endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  const { groups, unassignedBus, assignedAccountByCode } = useMemo(
    () =>
      groupRulesByAccount({
        buRules: data.rules,
        branchRules: data.branchRules,
        bus: data.bus,
        accounts: data.glAccounts,
      }),
    [data],
  );

  /** Stored groups plus the empty ones on screen, in one list, account order. */
  const shownGroups = useMemo(() => {
    const stored = new Set(groups.map((g) => g.accountNo));
    const extra = draftAccounts
      .filter((a) => !stored.has(a))
      .map((accountNo) => ({
        accountNo,
        displayName: data.glAccounts.find((a) => a.accountNo === accountNo)?.displayName ?? null,
        members: [],
      }));
    return [...groups, ...extra].sort((a, b) => a.accountNo.localeCompare(b.accountNo));
  }, [groups, draftAccounts, data.glAccounts]);

  const accountOptions: CodeNameOption[] = useMemo(
    () => data.glAccounts.map((a) => ({ code: a.accountNo, name: a.displayName ?? "" })),
    [data.glAccounts],
  );

  /**
   * What the Add picker offers for the kind being added.
   *
   * Everything, not just the unassigned: adding is an upsert, so a member
   * already in another group can simply be picked and it moves. The label says
   * which account it is moving out of, so that is a visible decision rather
   * than a surprise.
   */
  const memberOptions = useCallback(
    (kind: MemberKind, intoAccount: string): CodeNameOption[] => {
      // A BU carries no second line: its code IS its name, and the Location
      // count that used to sit there answered a question nobody asks while
      // picking one. It still appears in ยังไม่ตั้งกฎ, where it is the thing
      // that says whether a missing rule matters.
      const source =
        kind === "bu"
          ? data.bus.map((b) => ({ code: b.buCode, name: "" }))
          : data.branches.map((b) => ({ code: b.code, name: b.displayName ?? "" }));
      return source
        .map((o) => {
          const at = assignedAccountByCode.get(`${kind}:${o.code}`);
          if (!at) return o;
          if (at === intoAccount) return null;
          // Joined rather than concatenated, so a BU — which has no name of its
          // own — does not read as " · ตอนนี้อยู่ …" with a leading separator.
          return { code: o.code, name: [o.name, `ตอนนี้อยู่ ${at}`].filter(Boolean).join(" · ") };
        })
        .filter((o): o is CodeNameOption => o !== null);
    },
    [data.bus, data.branches, assignedAccountByCode],
  );

  /**
   * Write one rule. A blank account is the delete — the same POST, which is why
   * removing a member and moving one are the same call with different values.
   */
  const write = useCallback(
    async (kind: MemberKind, code: string, glAccountNo: string, label: string) => {
      const key = `${kind}:${code}`;
      setSaving(key);
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            company,
            ...(kind === "bu" ? { buCode: code } : { branchCode: code }),
            glAccountNo,
          }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!j.ok) {
          toast.error(j.error ?? "บันทึกไม่สำเร็จ");
          return false;
        }
        toast.success(label);
        await load();
        return true;
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
        return false;
      } finally {
        setSaving(null);
      }
    },
    [company, load, endpoint],
  );

  /**
   * Remove every rule pointing at one account, so the group goes away.
   *
   * **N writes, not one**, because the storage is a rule per shop and there is
   * no group row to delete — the same fact that makes an empty group
   * unsaveable. Sequential rather than `Promise.all`: each POST is an upsert on
   * one row, and a half-applied parallel batch would leave a group that is
   * neither deleted nor whole with no way to tell which.
   *
   * A draft group has nothing stored, so it is simply dropped from the screen.
   */
  const removeGroup = useCallback(
    async (accountNo: string, members: { kind: MemberKind; code: string }[]) => {
      if (members.length === 0) {
        setDraftAccounts((prev) => prev.filter((a) => a !== accountNo));
        if (adding === accountNo) setAdding(null);
        return;
      }
      if (
        !window.confirm(
          `ลบกลุ่ม ${accountNo}? ${members.length} รายการจะกลับไปใช้บัญชีตามค่าใช้จ่าย — และมีผลกับ AP-3 ด้วย`,
        )
      ) {
        return;
      }
      setSaving(`group:${accountNo}`);
      try {
        for (const m of members) {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              company,
              ...(m.kind === "bu" ? { buCode: m.code } : { branchCode: m.code }),
              glAccountNo: "",
            }),
          });
          const j = (await res.json()) as { ok: boolean; error?: string };
          if (!j.ok) {
            // Stop at the first refusal and say which member it was: carrying
            // on would leave a partly-deleted group and one message naming
            // none of it.
            toast.error(`${m.code}: ${j.error ?? "ลบไม่สำเร็จ"}`);
            return;
          }
        }
        toast.success(`ลบกลุ่ม ${accountNo} แล้ว`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "ลบไม่สำเร็จ");
      } finally {
        setSaving(null);
        await load();
      }
    },
    [company, load, adding, endpoint],
  );

  if (forbidden) {
    return (
      <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
        ไม่มีสิทธิ์เข้าถึงหน้านี้
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── the Company, as cards ── */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold" style={{ color: "var(--text-muted)" }}>
          Company (ปลายทางที่ลง Journal)
        </span>
        <div className="flex flex-wrap gap-2">
          {ifaceBrands.map((b) => {
            const active = b.id === company;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setCompany(b.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors"
                style={{
                  background: active ? "var(--nav-active-bg)" : "var(--bg-card)",
                  border: `1px solid ${active ? "var(--nav-active-text)" : "var(--border-card)"}`,
                  color: active ? "var(--nav-active-text)" : "var(--text-secondary)",
                }}
              >
                {b.logo ? (
                  <img src={b.logo} alt="" className="h-5 w-auto object-contain" />
                ) : null}
                <span className="text-[13px] font-bold">{b.id}</span>
              </button>
            );
          })}
          <Button variant="secondary" icon={<RotateCcw size={14} />} onClick={() => void load()}>
            โหลดใหม่
          </Button>
          {/* The BUs, the branches and the accounts this screen picks from are
              all a mirror of Business Central — โหลดใหม่ re-reads our copy, this
              refreshes the copy. */}
          <ErpSyncButton
            endpoint={syncEndpoint}
            company={company}
            target="buGlMap"
            onDone={load}
          />
        </div>
      </div>

      <p
        className="text-[12px] m-0 px-3 py-2 rounded-lg"
        style={{
          background: "var(--bg-info-yellow)",
          color: "var(--text-info-yellow)",
          border: "1px solid var(--border-info-yellow)",
        }}
      >
        {sharedNote}
      </p>

      <p
        className="text-[12px] m-0 px-3 py-2 rounded-lg"
        style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
      >
        ใช้กับ <b>บรรทัดค่าใช้จ่าย</b> เท่านั้น — บรรทัด VAT / ธนาคาร / หัก ณ ที่จ่าย มีบัญชีของตัวเอง ·
        <b> สาขาชนะ BU</b> เมื่อรายการนั้นมีทั้งคู่ · BU ที่ไม่อยู่ในกลุ่มไหนเลย = ใช้บัญชีตามค่าใช้จ่าย
      </p>

      {/* ── add a group ── */}
      <div
        className="flex flex-wrap items-center gap-2 px-3 py-2.5 rounded-xl"
        style={{ background: "var(--bg-card-alt)", border: "1px dashed var(--border-card)" }}
      >
        <Plus size={14} style={{ color: "var(--text-muted)" }} />
        <span className="text-[12px] font-semibold" style={{ color: "var(--text-secondary)" }}>
          เพิ่มกลุ่ม — เลือกบัญชี G/L
        </span>
        <div className="min-w-[260px]">
          <CodeNamePicker
            value={newAccount}
            onChange={setNewAccount}
            options={accountOptions}
            loading={loading}
            brandChosen
            ariaLabel="เลือกบัญชี G/L สำหรับกลุ่มใหม่"
            labels={{
              placeholder: "เลือกบัญชี G/L...",
              noBrand: "เลือก Company ก่อน",
              loading: "กำลังโหลด...",
              search: "ค้นหาเลขบัญชีหรือชื่อ",
              empty: "ไม่มีผังบัญชีของบริษัทนี้",
              noMatch: "ไม่พบบัญชีที่ค้นหา",
              clear: "ล้าง",
            }}
          />
        </div>
        <Button
          variant="secondary"
          disabled={!newAccount}
          onClick={() => {
            if (!newAccount) return;
            setDraftAccounts((prev) => (prev.includes(newAccount) ? prev : [...prev, newAccount]));
            setAdding(newAccount);
            setNewAccount(null);
          }}
        >
          เพิ่มกลุ่ม
        </Button>
      </div>

      {/* ── the groups ── */}
      {loading ? (
        <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
          กำลังโหลด...
        </p>
      ) : shownGroups.length === 0 ? (
        <p className="text-[13px] m-0" style={{ color: "var(--text-faint)" }}>
          — ยังไม่มีกลุ่ม ทุก BU ใช้บัญชีตามค่าใช้จ่าย —
        </p>
      ) : (
        shownGroups.map((g) => (
          <div
            key={g.accountNo}
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border-card)" }}
          >
            <div
              className="flex items-start gap-2 px-3 py-2.5"
              style={{ background: "var(--bg-card-alt)", borderBottom: "1px solid var(--border-light)" }}
            >
              {/* The NAME is what a reader recognises the group by; the account
                  number is the value, and it reads underneath — the same two
                  lines, in the same order, that CodeNamePicker uses for the
                  account that created this group. */}
              <div className="min-w-0">
                <span className="block text-[13px] font-bold leading-tight" style={{ color: "var(--text-primary)" }}>
                  {g.displayName ?? "— ไม่พบชื่อบัญชีในผังบัญชีปัจจุบัน —"}
                </span>
                <span
                  className="block text-[10.5px] leading-tight tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  {g.accountNo}
                </span>
              </div>
              <span className="ml-auto text-[11px] shrink-0" style={{ color: "var(--text-faint)" }}>
                {g.members.length} รายการ
              </span>
              <button
                type="button"
                aria-label={`ลบกลุ่ม ${g.accountNo}`}
                title="ลบกลุ่มนี้ — ทุกรายการกลับไปใช้บัญชีตามค่าใช้จ่าย"
                disabled={saving != null}
                onClick={() => void removeGroup(g.accountNo, g.members)}
                className="shrink-0 cursor-pointer border-none bg-transparent p-1 rounded-lg disabled:cursor-not-allowed disabled:opacity-50"
                style={{ color: "var(--text-muted)" }}
              >
                {saving === `group:${g.accountNo}` ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Trash2 size={13} />
                )}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 px-3 py-3">
              {g.members.length === 0 && (
                <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>
                  {/* Said rather than left blank: the group is not saved yet and
                      will not survive a reload until it has a member. */}
                  ยังไม่มีสมาชิก — กลุ่มนี้จะยังไม่ถูกบันทึกจนกว่าจะเพิ่ม BU หรือสาขา
                </span>
              )}
              {g.members.map((m) => (
                <span
                  key={m.key}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px]"
                  style={{
                    background: "var(--bg-badge)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border-light)",
                  }}
                >
                  <span
                    className="text-[9.5px] font-bold px-1 rounded"
                    style={{
                      background: m.kind === "bu" ? "var(--nav-active-bg)" : "var(--bg-info-yellow)",
                      color: m.kind === "bu" ? "var(--nav-active-text)" : "var(--text-info-yellow)",
                    }}
                  >
                    {m.kind === "bu" ? "BU" : "สาขา"}
                  </span>
                  <span className="font-semibold">{m.code}</span>
                  <button
                    type="button"
                    aria-label={`เอา ${m.code} ออกจาก ${g.accountNo}`}
                    title="เอาออกจากกลุ่ม — กลับไปใช้บัญชีตามค่าใช้จ่าย"
                    disabled={saving === m.key}
                    onClick={() =>
                      void write(m.kind, m.code, "", `${m.code} — ใช้บัญชีตามค่าใช้จ่าย`)
                    }
                    className="cursor-pointer border-none bg-transparent p-0 disabled:cursor-not-allowed"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {saving === m.key ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
                  </button>
                </span>
              ))}

              {adding === g.accountNo ? (
                <div className="flex flex-wrap items-center gap-1.5 w-full mt-1">
                  <div
                    className="inline-flex rounded-lg overflow-hidden"
                    style={{ border: "1px solid var(--border-input)" }}
                  >
                    {(["bu", "branch"] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => {
                          setAddKind(k);
                          setAddCode(null);
                        }}
                        className="px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer border-none"
                        style={{
                          background: addKind === k ? "var(--nav-active-bg)" : "var(--bg-card)",
                          color: addKind === k ? "var(--nav-active-text)" : "var(--text-muted)",
                        }}
                      >
                        {k === "bu" ? "BU" : "สาขา"}
                      </button>
                    ))}
                  </div>
                  <div className="min-w-[240px]">
                    <CodeNamePicker
                      value={addCode}
                      onChange={setAddCode}
                      options={memberOptions(addKind, g.accountNo)}
                      // The code IS the name here — a BU has no other — and on a
                      // branch it is still what is stored and what an admin
                      // scans for. The second line is a note about the code
                      // rather than the thing being chosen.
                      emphasis="code"
                      brandChosen
                      ariaLabel={`เลือก${addKind === "bu" ? " BU" : "สาขา"}เข้ากลุ่ม ${g.accountNo}`}
                      labels={{
                        placeholder: addKind === "bu" ? "เลือก BU..." : "เลือกสาขา...",
                        noBrand: "เลือก Company ก่อน",
                        loading: "กำลังโหลด...",
                        search: "ค้นหารหัสหรือชื่อ",
                        empty: addKind === "bu" ? "ไม่พบ BU ใน Location ของบริษัทนี้" : "ไม่พบสาขาของบริษัทนี้",
                        noMatch: "ไม่พบรายการที่ค้นหา",
                        clear: "ล้าง",
                      }}
                    />
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!addCode || saving != null}
                    onClick={async () => {
                      if (!addCode) return;
                      const ok = await write(
                        addKind,
                        addCode,
                        g.accountNo,
                        `${addKind === "bu" ? "BU" : "สาขา"} ${addCode} → ${g.accountNo}`,
                      );
                      if (ok) setAddCode(null);
                    }}
                  >
                    เพิ่ม
                  </Button>
                  <Button variant="secondary" onClick={() => setAdding(null)}>
                    ปิด
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setAdding(g.accountNo);
                    setAddCode(null);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[12px] font-medium cursor-pointer"
                  style={{
                    background: "transparent",
                    color: "var(--nav-active-text)",
                    border: "1px dashed var(--border-card)",
                  }}
                >
                  <Plus size={11} /> เพิ่ม BU / สาขา
                </button>
              )}
            </div>
          </div>
        ))
      )}

      {/* ── what no rule covers ── */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-faint)" }}>
          ยังไม่ตั้งกฎ
        </p>
        {unassignedBus.length === 0 ? (
          <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
            {loading ? "กำลังโหลด..." : "ทุก BU ของบริษัทนี้อยู่ในกลุ่มแล้ว"}
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {unassignedBus.map((b) => (
              <span
                key={b.buCode}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px]"
                style={{ background: "var(--bg-card-alt)", color: "var(--text-secondary)" }}
              >
                <span className="font-semibold">{b.buCode}</span>
                <span style={{ color: "var(--text-faint)" }}>{b.locations}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-[10px] m-0 mt-2" style={{ color: "var(--text-faint)" }}>
          {/* The asymmetry is deliberate — see the component's own note. */}
          BU เหล่านี้ใช้บัญชีตามค่าใช้จ่าย · รายการนี้แสดงเฉพาะ BU ไม่แสดงสาขา เพราะบริษัทหนึ่งมีสาขาหลายร้อยรายการ —
          เพิ่มสาขาเข้ากลุ่มได้จากปุ่ม “เพิ่ม BU / สาขา” ในกลุ่มที่ต้องการ
        </p>
      </div>
    </div>
  );
}
