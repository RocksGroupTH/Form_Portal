"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { ErpEnvironmentNotice } from "@/components/settings/ErpEnvironmentNotice";
import { toast } from "sonner";
import { AlertTriangle, Pencil, CheckCircle2, Circle, Link2, Save, RefreshCw, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";
import { Dialog } from "@/components/ui/Dialog";
import { ErpAccountSyncPopup, type ErpSyncPopupState } from "@/features/accounting/components/settings/ErpAccountSyncPopup";
import { useErpInterfaceBrands } from "@/lib/hooks/useErpInterfaceBrands";
import { membersToWrite } from "@/lib/adv/interface-group-members";
import {
  groupByTargetIncludingEmpty,
  groupValue,
  type GroupValue,
} from "@/lib/acc/erp-target-groups";

interface ConfigRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  targetFromAp2: boolean;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  branchCode: string | null;
  bankAccountNo: string | null;
  journalBatchName: string | null;
  ready: boolean;
  active: boolean;
}

type SelectOption = { value: string; label: string; subLabel?: string };
interface AcctOpt { accountNo: string; displayName: string | null }
interface BatchOpt { batchName: string; displayName: string | null; templateName: string | null }
interface BranchOpt { code: string; displayName: string | null }
interface CompanyErp { gl: AcctOpt[]; bank: AcctOpt[]; journalBatch: BatchOpt[]; branch: BranchOpt[] }

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function decode(v: string | null | undefined): string {
  if (!v?.trim()) return "—";
  try { return decodeURIComponent(v.trim()); } catch { return v.trim(); }
}

function acctOptions(items: AcctOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.accountNo)) continue;
    seen.add(o.accountNo);
    const sub = o.displayName?.trim() && o.displayName.trim() !== o.accountNo ? o.displayName.trim() : undefined;
    out.push({ value: o.accountNo, label: o.accountNo, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function branchOptions(items: BranchOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.code)) continue;
    seen.add(o.code);
    const sub = o.displayName?.trim() && o.displayName.trim() !== o.code ? o.displayName.trim() : undefined;
    out.push({ value: o.code, label: o.code, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function batchOptions(items: BatchOpt[], current?: string | null): SelectOption[] {
  const seen = new Set<string>();
  const out: SelectOption[] = [];
  for (const o of items ?? []) {
    if (seen.has(o.batchName)) continue;
    seen.add(o.batchName);
    const sub = [
      o.templateName?.trim(),
      o.displayName?.trim() && o.displayName.trim() !== o.batchName ? o.displayName.trim() : null,
    ].filter(Boolean).join(" · ") || undefined;
    out.push({ value: o.batchName, label: o.batchName, subLabel: sub });
  }
  if (current && !seen.has(current)) out.push({ value: current, label: current });
  return out.sort((a, b) => a.label.localeCompare(b.label));
}

function ReadonlyField({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = !value?.trim() || value === "—";
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[12px] m-0 truncate font-medium"
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }} title={value ?? ""}>
        {empty ? "—" : value}
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: "var(--text-faint)" }}>{children}</p>;
}

function StatusBadge({ ready }: { ready: boolean }) {
  const Icon = ready ? CheckCircle2 : Circle;
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={ready
        ? { background: "rgba(79,163,122,0.15)", color: "var(--text-info-green)" }
        : { background: "var(--bg-badge)", color: "var(--text-muted)" }}>
      <Icon size={12} />{ready ? "พร้อมส่ง" : "ยังไม่ครบ"}
    </span>
  );
}

/** One claim brand as a chip on a group card. */
function MemberChip({ row }: { row: ConfigRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px]"
      style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", opacity: row.active ? 1 : 0.55 }}
      title={row.active ? undefined : "แบรนด์นี้ปิดใช้งานอยู่"}>
      {row.brandLogo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={row.brandLogo} alt="" className="h-3.5 w-auto object-contain" />
      )}
      <span className="font-semibold">{row.brandName}</span>
      <span style={{ color: "var(--text-faint)" }}>{row.brandCode}</span>
    </span>
  );
}

/**
 * What a group's shared field is, said in one line.
 *
 * The three states `groupValue` answers are three different things to a reader
 * and the screen must not flatten them: a value everybody has, a value some
 * members are missing and will be given on save, and two real values that
 * disagree — which is refused rather than picked.
 */
function GroupFieldSummary({ label, state }: { label: string; state: GroupValue }) {
  if (state.kind === "conflict") {
    return (
      <div className="min-w-0">
        <FieldLabel>{label}</FieldLabel>
        <p className="text-[12px] m-0 inline-flex items-center gap-1" style={{ color: "var(--text-warning)" }}>
          <AlertTriangle size={12} /> ไม่ตรงกัน — {state.values.map((v) => `${v.brandCode}: ${v.value}`).join(" · ")}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <FieldLabel>{label}</FieldLabel>
      <p className="text-[12px] m-0 truncate font-medium" title={state.value}
        style={{ color: state.value ? "var(--text-primary)" : "var(--text-muted)" }}>
        {state.value || "—"}
      </p>
      {state.kind === "fill" && (
        <p className="text-[10px] m-0" style={{ color: "var(--text-info-yellow)" }}>
          {state.blankMembers.join(", ")} ยังไม่มีค่า — บันทึกแล้วจะเติมให้
        </p>
      )}
    </div>
  );
}

/**
 * One target Company: the claim brands posting into it, what they share, and
 * what each sets for itself.
 *
 * The shape AP-1 and AP-4's Interface ERP tabs already use — summary on the
 * card, form behind แก้ไข — brought to AP-2 (user, 2026-09-14). Spec:
 * `docs/superpowers/specs/2026-09-14-ap2-ap3-erp-interface-groups-design.md`.
 *
 * **Nothing is stored against the target.** Every value is written per claim
 * brand, and the Journal Batch — the one field the group shares — is written to
 * each member on save. `resolveJournalBatchName` reads a target-keyed row
 * FIRST and would beat every per-brand row; this repository has shipped that bug
 * once already, on this very form.
 *
 * **Adding a brand to a group is how its target is changed**, which is what the
 * per-brand Company dropdown used to do. **There is no remove**, and that is the
 * route rather than the screen: `POST .../settings/erp-interface` refuses an
 * empty `interfaceBrandCode` outright, so a brand cannot be un-mapped from here
 * — only moved to another Company. The card says so.
 *
 * **The Active switch is GONE from this screen** (user, 2026-09-14). It lived on
 * the card, then on the member row, and now on a tab of its own — แบรนด์ที่เบิก
 * ได้ — because it is not posting configuration: it decides whether a brand may
 * be claimed against at all, on BOTH AP-2 and AP-3, and every sibling form gives
 * that its own tab. An inactive member still reads as ปิดใช้งาน here, since a
 * group whose brands are switched off explains a queue that looks empty.
 */
function GroupCard({ target, members, all, erpByCompany, onSaved }: {
  target: string;
  members: ConfigRow[];
  /** Every claim brand, for the "add a brand" picker — including other groups'. */
  all: ConfigRow[];
  erpByCompany: Record<string, CompanyErp>;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const batchState = useMemo(
    () => groupValue(members.map((m) => ({ brandCode: m.brandCode, value: m.journalBatchName }))),
    [members],
  );
  // A conflict has no single value to put in the box, so the box starts empty
  // and whatever is chosen is written to every member — the admin resolving it
  // deliberately, rather than the screen choosing for them.
  const batchAgreed = batchState.kind === "conflict" ? "" : batchState.value;
  const [batch, setBatch] = useState(batchAgreed);
  // Re-sync when the rows reload after a save. The dependency is the resolved
  // string rather than the state object, which is rebuilt every render.
  useEffect(() => { setBatch(batchAgreed); }, [batchAgreed]);

  /** Per-member Bank and Branch, edited in the dialog and saved together. */
  const [draft, setDraft] = useState<Record<string, { bank: string; branch: string }>>({});
  const [added, setAdded] = useState<string[]>([]);
  const [addCode, setAddCode] = useState("");

  const erp = erpByCompany[target];
  const noOpts = !erp;
  const batchOpts = useMemo(() => batchOptions(erp?.journalBatch ?? [], batch), [erp, batch]);

  const shown = useMemo(() => {
    const extra = added
      .map((c) => all.find((a) => a.brandCode === c))
      .filter((r): r is ConfigRow => Boolean(r));
    return members.concat(extra);
  }, [members, added, all]);

  const valueFor = (row: ConfigRow) =>
    draft[row.brandCode] ?? { bank: row.bankAccountNo ?? "", branch: row.branchCode ?? "" };
  const setFor = (code: string, patch: Partial<{ bank: string; branch: string }>) =>
    setDraft((p) => ({ ...p, [code]: { ...(p[code] ?? { bank: "", branch: "" }), ...patch } }));
  /**
   * The members this save writes — active, or already carrying a Bank Account.
   *
   * A brand switched off cannot be claimed against, so it needs no posting
   * account and must not block the group; one that is already configured is
   * still written so the shared Journal Batch reaches it. See
   * `membersToWrite` for the whole argument.
   */
  const toWrite = useMemo(
    () => membersToWrite(shown, (m) => valueFor(m).bank),
    // `draft` rather than `valueFor`, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, draft],
  );

  /**
   * Every claim brand not already in this group, labelled with where it is now
   * — adding one MOVES it, and that has to be readable before the click rather
   * than discovered after.
   */
  const addOptions = useMemo(
    () =>
      all
        .filter((a) => !shown.some((m) => m.brandCode === a.brandCode))
        .map((a) => ({
          value: a.brandCode,
          label: `${a.brandName} (${a.brandCode})`,
          subLabel: a.interfaceTarget?.trim() ? `ตอนนี้อยู่ ${a.interfaceTarget}` : "ยังไม่ได้จัดกลุ่ม",
        })),
    [all, shown],
  );

  /**
   * Write the group: one POST per member, in order, stopping at the first
   * refusal and naming the member it stopped on.
   *
   * Every guard on that route is per claim brand, so a bulk endpoint would have
   * to re-implement them; and a half-applied group nobody can identify is worse
   * than one that says where it stopped. The shape AP-3's group save uses.
   */
  async function save() {
    if (batchWouldClear) {
      toast.error(`กรุณาเลือก Journal Batch — ค้างว่างไว้จะลบของ ${batchReplacing.map((m) => m.brandCode).join(", ")}`);
      return;
    }
    if (toWrite.length === 0) {
      toast.error("ทุกแบรนด์ในกลุ่มนี้ปิดใช้งานและยังไม่มี Bank Account — ไม่มีอะไรให้บันทึก");
      return;
    }
    for (const m of toWrite) {
      if (!valueFor(m).bank.trim()) {
        toast.error(`${m.brandCode}: กรุณาเลือก Bank Account`);
        return;
      }
    }
    setBusy(true);
    try {
      for (const m of toWrite) {
        const v = valueFor(m);
        const res = await fetch("/api/request/advance/settings/erp-interface", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandCode: m.brandCode,
            interfaceBrandCode: target,
            bankAccountNo: v.bank.trim(),
            branchCode: v.branch.trim(),
            journalBatchName: batch.trim(),
          }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!j.ok) { toast.error(`${m.brandCode}: ${j.error ?? "บันทึกไม่สำเร็จ"}`); return; }
      }
      toast.success(`บันทึกกลุ่ม ${target} แล้ว (${toWrite.length} แบรนด์)`);
      setOpen(false);
      setAdded([]);
      setDraft({});
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Which members' Journal Batch this save would REPLACE, and whether it would
   * CLEAR one.
   *
   * Not defensive decoration — measured 2026-09-14, PCMY posts into PCTH with
   * its own `TRANSFER` batch while PCTH and ROCKS use `Q`, so the live PCTH
   * group is a real set-vs-set conflict. A group field written to every member
   * is the shape the user asked for, but writing it must be an act somebody
   * chose: the conflict box starts empty, and an empty box saved as-is would
   * null out three working configurations in one click.
   */
  const batchReplacing = useMemo(
    // Over `toWrite`, not `shown`: a member this save skips cannot have its
    // Journal Batch replaced or cleared, so warning about it would be false.
    () => toWrite.filter((m) => {
      const cur = (m.journalBatchName ?? "").trim();
      return cur !== "" && cur !== batch.trim();
    }),
    [toWrite, batch],
  );
  const batchWouldClear = !batch.trim() && batchReplacing.length > 0;

  const { brands: ifaceBrands } = useErpInterfaceBrands();
  const iface = ifaceBrands.find((b) => b.id === target);
  const first = members[0];
  const bcLine = [decode(first?.bcName), first?.bcConnectionName?.trim(), first?.environment ?? undefined]
    .filter((v) => v && v !== "—").join(" · ");
  const ready = members.length > 0 && members.every((m) => m.ready);
  const bcIncomplete = members.some((m) => !m.bcProfileComplete);

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: "var(--bg-card-alt)",
        border: `1px solid ${ready ? "var(--border-info-green)" : "var(--border-card)"}`,
      }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {iface?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iface.logo} alt="" className="h-6 w-auto object-contain" />
          ) : null}
          <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{target}</span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>{members.length} แบรนด์เบิก</span>
        </div>
        <StatusBadge ready={ready} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {members.length === 0 ? (
          <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>ยังไม่มีแบรนด์เบิก</span>
        ) : (
          members.map((m) => <MemberChip key={m.brandCode} row={m} />)
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
        <GroupFieldSummary label="Journal Batch" state={batchState} />
        <ReadonlyField label="การเชื่อมต่อ BC" value={bcLine} />
      </div>

      {bcIncomplete && (
        <p className="text-[11px] m-0 px-3 py-2 rounded-lg"
          style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
          ⚠️ การเชื่อมต่อ BC ของ Company นี้ยังไม่ครบ — ตั้งค่าที่ Accounting → Interface ERP ก่อน
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
          AP-2 กำหนดเอง: Company ปลายทาง · Bank · Branch · Journal Batch
        </p>
        <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={() => setOpen(true)}>
          แก้ไข
        </Button>
      </div>

      {open && (
        <Dialog
          open
          onOpenChange={(v) => { if (!v) setOpen(false); }}
          title={`ตั้งค่า Interface ERP — ${target}`}
          description={`${shown.length} แบรนด์เบิก · Journal Batch ใช้ร่วมกันทั้งกลุ่ม`}
        >
          <div className="flex flex-col gap-4">
            {batchState.kind === "conflict" && (
              <p className="text-[11px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                แบรนด์ในกลุ่มนี้ใช้ Journal Batch ไม่ตรงกัน — เลือกค่าที่ถูกต้องแล้วบันทึก จะเขียนให้ทุกแบรนด์ในกลุ่ม
              </p>
            )}

            <div>
              <FieldLabel>Journal Batch (ใช้ร่วมกันทั้งกลุ่ม)</FieldLabel>
              <SearchableSelect value={batch} onChange={setBatch} options={batchOpts} disabled={busy}
                placeholder={noOpts ? "ไม่มีข้อมูล ERP ของ Company นี้" : "— เลือก Batch —"}
                emptyLabel={noOpts ? "ไม่มีข้อมูล ERP ของ Company นี้" : "— เลือก Batch —"}
                searchPlaceholder="ค้นหา Batch..." triggerBackground="var(--bg-card)" />
              {batchState.kind === "fill" && (
                <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-info-yellow)" }}>
                  {batchState.blankMembers.join(", ")} ยังไม่มีค่า — บันทึกแล้วจะเติมให้
                </p>
              )}
              {batchReplacing.length > 0 && (
                <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-warning)" }}>
                  จะเขียนทับของเดิม: {batchReplacing.map((m) => `${m.brandCode} (${(m.journalBatchName ?? "").trim() || "ว่าง"})`).join(" · ")}
                </p>
              )}
              {!noOpts && batchOpts.length === 0 && (
                <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
                  ไม่พบ Journal Batch ของ {target} ใน ERP
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <FieldLabel>แบรนด์เบิกในกลุ่มนี้</FieldLabel>
              {shown.length === 0 && (
                <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                  ยังไม่มีแบรนด์ — เพิ่มด้านล่างก่อนบันทึก
                </p>
              )}
              {shown.map((m) => {
                const v = valueFor(m);
                return (
                  <div key={m.brandCode} className="rounded-xl p-3 flex flex-col gap-2"
                    style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {m.brandLogo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.brandLogo} alt="" className="h-4 w-auto object-contain" />
                        )}
                        <span className="text-[12px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                          {m.brandName}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>{m.brandCode}</span>
                      </div>
                      {!m.active && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
                          title="เปิด/ปิดแบรนด์ที่แท็บ แบรนด์ที่เบิกได้">
                          ปิดใช้งาน
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <FieldLabel>Bank Account</FieldLabel>
                        <SearchableSelect value={v.bank} onChange={(x) => setFor(m.brandCode, { bank: x })}
                          options={acctOptions(erp?.bank ?? [], v.bank)} disabled={busy}
                          placeholder={noOpts ? "ไม่มีข้อมูล ERP" : "— เลือก Bank —"}
                          emptyLabel={noOpts ? "ไม่มีข้อมูล ERP" : "— เลือก Bank —"}
                          searchPlaceholder="ค้นหา Bank..." triggerBackground="var(--bg-card-alt)" />
                      </div>
                      <div className="min-w-0">
                        <FieldLabel>Branch · ไม่บังคับ</FieldLabel>
                        <SearchableSelect value={v.branch} onChange={(x) => setFor(m.brandCode, { branch: x })}
                          options={branchOptions(erp?.branch ?? [], v.branch)} disabled={busy}
                          placeholder={noOpts ? "ไม่มีข้อมูล ERP" : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
                          emptyLabel={noOpts ? "ไม่มีข้อมูล ERP" : "— ไม่ระบุ · ใช้แผนกผู้ขอ —"}
                          searchPlaceholder="ค้นหา Branch..." triggerBackground="var(--bg-card-alt)" />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div>
              <FieldLabel>เพิ่มแบรนด์เข้ากลุ่มนี้</FieldLabel>
              <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                  <SearchableSelect value={addCode} onChange={setAddCode} options={addOptions} disabled={busy}
                    placeholder={addOptions.length === 0 ? "ไม่มีแบรนด์ให้เพิ่ม" : "เลือกแบรนด์เบิก..."}
                    emptyLabel={addOptions.length === 0 ? "ไม่มีแบรนด์ให้เพิ่ม" : "เลือกแบรนด์เบิก..."}
                    searchPlaceholder="ค้นหาแบรนด์..." triggerBackground="var(--bg-card)" />
                </div>
                <Button variant="secondary" size="sm" icon={<Plus size={14} />} disabled={!addCode || busy}
                  onClick={() => { if (addCode) { setAdded((p) => p.concat([addCode])); setAddCode(""); } }}>
                  เพิ่ม
                </Button>
              </div>
              <p className="text-[10px] m-0 mt-1" style={{ color: "var(--text-faint)" }}>
                {/* Not an omission: the route refuses an empty Company outright. */}
                เพิ่มแล้วบันทึก = ย้ายแบรนด์นั้นมาลง {target} · เอาออกจากกลุ่มไม่ได้ ต้องย้ายไป Company อื่นแทน
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>ปิด</Button>
              <Button variant="primary" size="sm" icon={<Save size={14} />} onClick={save}
                loading={busy} disabled={busy || shown.length === 0 || batchWouldClear}>บันทึก</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function AdvanceErpInterfaceSettings() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/request/advance/settings/erp-interface")
      .then((r) => r.json())
      .then((j: { ok: boolean; data?: ConfigRow[] }) => setRows(j.ok && j.data ? j.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  // Bank · Branch · Journal Batch — read straight from Rocks_ERP_Data
  // (Erp* tables), keyed by Company (interface target).
  const { data: erpData, isLoading: erpLoading, mutate: mutateErp } =
    useSWR<{ ok: boolean; data?: Record<string, CompanyErp> }>(
      "/api/request/advance/settings/erp-master",
      fetcher,
    );
  const erpByCompany = erpData?.data ?? {};

  /**
   * Grouped by the Company the journal posts into, with every interface company
   * shown — an empty card is the only place a company's first brand can be
   * added.
   *
   * **`interfaceTarget` is never blank, so the leftovers have to be derived
   * here.** `listAdvanceInterfaceConfigView` resolves it with a final `?? code`, so a brand with no
   * `AccBrandErpInterface` row is reported as posting into ITSELF. Measured
   * 2026-09-14: PLM is exactly that. Taken at face value it renders a card for a
   * Company that is not an interface target at all, whose Save the route
   * refuses outright (`isErpInterfaceBrandCode` → "Company ปลายทางไม่ถูกต้อง"), so
   * the card would be a dead end rather than a configuration.
   *
   * A target outside the four that is NOT the brand's own code is a different
   * thing — somebody mapped it somewhere unexpected — and keeps its group,
   * because that is precisely what needs to be seen.
   */
  const { brands: ifaceBrands } = useErpInterfaceBrands();
  const { groups, unassigned } = useMemo(() => {
    const known = new Set(ifaceBrands.map((b) => b.id));
    const targetByClaim: Record<string, string> = {};
    for (const r of rows) {
      const t = (r.interfaceTarget ?? "").trim().toUpperCase();
      const unmapped = !known.has(t) && t === r.brandCode.trim().toUpperCase();
      targetByClaim[r.brandCode] = unmapped ? "" : t;
    }
    return groupByTargetIncludingEmpty(rows, targetByClaim, ifaceBrands.map((b) => b.id));
  }, [rows, ifaceBrands]);

  const [refreshing, setRefreshing] = useState(false);
  async function refreshErp() {
    setRefreshing(true);
    try {
      await mutateErp();
      toast.success("รีเฟรชข้อมูล ERP แล้ว");
    } catch {
      toast.error("รีเฟรชไม่สำเร็จ");
    } finally {
      setRefreshing(false);
    }
  }

  const [syncingVendor, setSyncingVendor] = useState(false);
  const [syncPopup, setSyncPopup] = useState<ErpSyncPopupState>({
    open: false, brandCode: "", part: "", percent: 0, status: "running",
  });
  async function syncVendor() {
    const brands = ifaceBrands;
    const total = brands.length;
    let done = 0;
    let totalRows = 0;
    const errors: string[] = [];

    setSyncingVendor(true);
    setSyncPopup({ open: true, brandCode: "", part: "เตรียมข้อมูล", percent: 0, status: "running" });

    try {
      for (const brand of brands) {
        setSyncPopup({
          open: true, brandCode: brand.id, part: "Vendor Master",
          percent: Math.round((done / total) * 100), status: "running",
        });
        try {
          const res = await fetch("/api/request/advance/settings/vendors/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ brandCode: brand.id }),
          });
          const j = (await res.json()) as {
            ok: boolean;
            error?: string;
            data?: { results: { vendorRows: number }[]; errors: unknown[] };
          };
          if (!j.ok) errors.push(`${brand.id}: ${j.error ?? "Sync failed"}`);
          else totalRows += j.data?.results.reduce((s, r) => s + (r.vendorRows ?? 0), 0) ?? 0;
        } catch {
          errors.push(`${brand.id}: Sync failed`);
        }
        done += 1;
        setSyncPopup({
          open: true, brandCode: brand.id, part: "Vendor Master",
          percent: Math.round((done / total) * 100), status: "running",
        });
      }

      await mutateErp();

      if (errors.length > 0) {
        setSyncPopup({
          open: true, brandCode: "", part: "", percent: 100, status: "error",
          detail: errors.slice(0, 3).join(" · "),
        });
        toast.warning(`Sync Vendor บางรายการไม่สำเร็จ (${errors.length}) — ดึงได้ ${totalRows} รายการ`);
      } else {
        setSyncPopup({
          open: true, brandCode: "", part: "", percent: 100, status: "done",
          detail: `ดึง Vendor สำเร็จ ${totalRows} รายการ`,
        });
        toast.success(`Sync Vendor สำเร็จ — ${totalRows} รายการ`);
      }
      window.setTimeout(() => setSyncPopup((p) => ({ ...p, open: false })), errors.length > 0 ? 3500 : 1800);
    } catch {
      setSyncPopup({ open: true, brandCode: "", part: "", percent: 0, status: "error", detail: "Sync Vendor ไม่สำเร็จ" });
      toast.error("Sync Vendor ไม่สำเร็จ");
      window.setTimeout(() => setSyncPopup((p) => ({ ...p, open: false })), 2500);
    } finally {
      setSyncingVendor(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ErpAccountSyncPopup state={syncPopup} />
      <div className="rounded-xl px-4 py-3 flex flex-wrap items-start justify-between gap-3"
        style={{ background: "var(--nav-active-bg)", border: "1px solid var(--border-card)" }}>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold m-0 flex items-center gap-1.5" style={{ color: "var(--text-heading)" }}>
            <Link2 size={15} style={{ color: "var(--nav-active-text)" }} /> Interface ERP (AP-2)
          </p>
          <p className="text-[11px] m-0 mt-1" style={{ color: "var(--text-muted)" }}>
            จัดกลุ่มตาม Company ปลายทาง · Journal Batch ใช้ร่วมกันทั้งกลุ่ม · Bank และ Branch ตั้งรายแบรนด์ — Dr ลง Vendor (G/L มาจาก Posting Group)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            icon={<Download size={15} className={syncingVendor ? "animate-pulse" : ""} />}
            onClick={() => void syncVendor()}
            loading={syncingVendor}
            disabled={syncingVendor}
          >
            Sync Vendor
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<RefreshCw size={15} className={refreshing || erpLoading ? "animate-spin" : ""} />}
            onClick={() => void refreshErp()}
            loading={refreshing}
            disabled={rows.length === 0}
          >
            รีเฟรช
          </Button>
        </div>
      </div>

      <ErpEnvironmentNotice />

      {loading ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
          ยังไม่มีแบรนด์ที่ map Company (ตั้งค่าที่ Accounting → Interface ERP)
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {groups.map((g) => (
              <GroupCard key={g.target} target={g.target} members={g.members} all={rows}
                erpByCompany={erpByCompany} onSaved={load} />
            ))}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-faint)" }}>
              ยังไม่ได้จัดกลุ่ม
            </p>
            {unassigned.length === 0 ? (
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>ทุกแบรนด์เบิกถูกจัดกลุ่มแล้ว</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unassigned.map((r) => <MemberChip key={r.brandCode} row={r} />)}
              </div>
            )}
            <p className="text-[10px] m-0 mt-2" style={{ color: "var(--text-faint)" }}>
              เพิ่มแบรนด์เหล่านี้เข้ากลุ่มได้จากปุ่ม “แก้ไข” บนการ์ด Company ปลายทางที่ต้องการ
            </p>
          </div>
        </>
      )}
    </div>
  );
}
