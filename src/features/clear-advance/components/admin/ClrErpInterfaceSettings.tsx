"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Circle, Pencil, Save } from "lucide-react";
import { Button } from "@/components/ui";
import { SearchableSelect } from "@/features/accounting/components/settings/SearchableSelect";
import { Dialog } from "@/components/ui/Dialog";
import { ERP_INTERFACE_BRANDS } from "@/lib/acc/erp-interface-brands";
import {
  groupByTargetIncludingEmpty,
  groupValue,
  type GroupValue,
} from "@/lib/acc/erp-target-groups";

interface ViewRow {
  brandCode: string;
  brandName: string;
  brandLogo: string | null;
  interfaceTarget: string;
  bcName: string | null;
  bcConnectionName: string | null;
  bcProfileComplete: boolean;
  environment: string | null;
  journalBatchName: string | null;
  vatInputGlAccountNo: string | null;
  whtPayableGlAccountNo: string | null;
  ready: boolean;
  active: boolean;
}
interface BatchOpt { batchName: string; displayName: string | null; templateName: string | null }
interface GlOpt { accountNo: string; displayName: string | null }
type SelectOption = { value: string; label: string; subLabel?: string };

const fetcher = (url: string) => fetch(url).then((r) => r.json());

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

function glOptions(items: GlOpt[], current?: string | null): SelectOption[] {
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

function ReadonlyField({ label, value }: { label: string; value: string | null | undefined }) {
  const empty = !value?.trim();
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
      <p className="text-[12px] m-0 truncate font-medium" title={value ?? ""}
        style={{ color: empty ? "var(--text-muted)" : "var(--text-primary)" }}>{empty ? "—" : value}</p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-1" style={{ color: "var(--text-faint)" }}>{children}</p>;
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
function MemberChip({ row }: { row: ViewRow }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[12px]"
      style={{ background: "var(--bg-badge)", color: "var(--text-secondary)", opacity: row.active ? 1 : 0.55 }}
      title={row.active ? undefined : "แบรนด์นี้ปิดใช้งานอยู่ — เปิด/ปิดที่แท็บ แบรนด์ที่เบิกได้"}>
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
 * disagree — which is refused rather than picked, because picking overwrites
 * somebody's decision about where money posts.
 */
function GroupFieldSummary({ label, state }: { label: string; state: GroupValue }) {
  if (state.kind === "conflict") {
    return (
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
        <p className="text-[12px] m-0 inline-flex items-center gap-1" style={{ color: "var(--text-warning)" }}>
          <AlertTriangle size={12} /> ไม่ตรงกัน — {state.values.map((v) => `${v.brandCode}: ${v.value}`).join(" · ")}
        </p>
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-0.5" style={{ color: "var(--text-faint)" }}>{label}</p>
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
 * What one brand's own two accounts are set to.
 *
 * **The Journal Batch is not here**, and that is the one asymmetry on this
 * screen: it is a group control at the top of the dialog, exactly where AP-2
 * puts it (user, 2026-09-14: "Journal Batch * ของ AP-3 ต้องอยู่ด้านบนสุดของ
 * group เหมือน AP-2"). The two tax accounts stay per brand.
 */
interface BrandDraft { vatGl: string; whtGl: string }

const draftOf = (row: ViewRow): BrandDraft => ({
  vatGl: row.vatInputGlAccountNo ?? "",
  whtGl: row.whtPayableGlAccountNo ?? "",
});
const sameDraft = (a: BrandDraft, b: BrandDraft) =>
  a.vatGl.trim() === b.vatGl.trim() && a.whtGl.trim() === b.whtGl.trim();

/**
 * One target Company: the claim brands posting into it, each carrying its own
 * three values.
 *
 * **AP-2's layout exactly** (user, 2026-09-14): the Journal Batch is one
 * control at the TOP of the dialog, shared by the group and fanned out to every
 * member on save; the two tax accounts sit in each brand's own row.
 *
 * Getting here took two corrections in one afternoon and both are worth
 * keeping. All three fields shipped group-shared, which was wrong for the tax
 * accounts for a measured reason — PCMY sits in the PCTH group carrying neither,
 * so "one value for the group" made an unset brand and a deliberately different
 * one the same thing. All three then went per brand, which put the Journal Batch
 * somewhere AP-2 does not have it. The split is the answer to both: a batch is a
 * property of the books being posted into, and an input-tax account, as it turns
 * out, is not.
 *
 * **The batch therefore keeps the fan-out's guard and the accounts need none.**
 * A group whose members disagree on the batch starts that box EMPTY, and saving
 * it empty would null out every member's working configuration in one click — so
 * Save is blocked while it is empty and any member has one, and the dialog names
 * whose value a save replaces. A tax account can only ever be cleared in its own
 * brand's box, by somebody looking at it.
 *
 * **The card summary speaks for the group** through `groupValue` on all three:
 * one value where everybody agrees, "ยังไม่มีค่า" naming the members missing it,
 * ไม่ตรงกัน where two real values disagree.
 *
 * **No membership control, deliberately.** AP-3 inherits its target from AP-2;
 * a brand moves between these cards on AP-2's tab. A control that looked
 * editable here and silently was not would be worse than not having one, so the
 * card says where membership is set instead.
 */
function GroupCard({
  target,
  members,
  onSaved,
}: {
  target: string;
  members: ViewRow[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const batchState = useMemo(
    () => groupValue(members.map((m) => ({ brandCode: m.brandCode, value: m.journalBatchName }))),
    [members],
  );
  const vatState = useMemo(
    () => groupValue(members.map((m) => ({ brandCode: m.brandCode, value: m.vatInputGlAccountNo }))),
    [members],
  );
  const whtState = useMemo(
    () => groupValue(members.map((m) => ({ brandCode: m.brandCode, value: m.whtPayableGlAccountNo }))),
    [members],
  );

  /**
   * The group's Journal Batch.
   *
   * A conflict has no single value to put in the box, so it starts empty and
   * whatever is chosen is written to every member — the admin resolving it
   * deliberately, rather than the screen choosing for them. The dependency is
   * the resolved string, not the state object, which is rebuilt every render.
   */
  const batchAgreed = batchState.kind === "conflict" ? "" : batchState.value;
  const [batch, setBatch] = useState(batchAgreed);
  useEffect(() => { setBatch(batchAgreed); }, [batchAgreed]);

  /**
   * Each brand's own two accounts, keyed on its code.
   *
   * Rebuilt whenever `members` changes — which is the refetch after a save, and
   * nothing else — so an edit is never clobbered mid-typing and a saved value is
   * never left stale behind the dialog.
   */
  const saved = useMemo(() => {
    const out: Record<string, BrandDraft> = {};
    for (const m of members) out[m.brandCode] = draftOf(m);
    return out;
  }, [members]);
  const [draft, setDraft] = useState<Record<string, BrandDraft>>(saved);
  useEffect(() => { setDraft(saved); }, [saved]);

  const valueFor = (code: string): BrandDraft =>
    draft[code] ?? saved[code] ?? { vatGl: "", whtGl: "" };
  const setFor = (code: string, patch: Partial<BrandDraft>) =>
    setDraft((p) => ({ ...p, [code]: { ...valueFor(code), ...patch } }));

  const first = members[0];
  /* One fetch per group, not per member: every brand in a group posts into the
     same Company, so they pick from the same batches and the same chart. */
  const { data: liveBatch, isLoading } = useSWR<{ ok: boolean; error?: string; data?: BatchOpt[] }>(
    target ? `/api/request/clear-advance/settings/erp-journal-batches?company=${encodeURIComponent(target)}` : null,
    fetcher,
  );
  const { data: liveGl, isLoading: glLoading } = useSWR<{ ok: boolean; data?: GlOpt[] }>(
    first ? `/api/request/clear-advance/settings/erp-gl-accounts?brand=${encodeURIComponent(first.brandCode)}` : null,
    fetcher,
  );
  const batchErr = liveBatch && !liveBatch.ok ? (liveBatch.error ?? "ดึง batch ไม่สำเร็จ") : null;
  const noBatches = !isLoading && !batchErr && (liveBatch?.data?.length ?? 0) === 0;

  const ready = members.length > 0 && members.every((m) => m.ready);

  /**
   * Which members the group's batch would REPLACE, and whether it would CLEAR
   * one. Measured 2026-09-14, PCMY carries no batch while PCTH and ROCKS carry
   * `Q` — so this group opens as a fill, and an empty box saved as-is on a group
   * that DID disagree would take three working batches out together.
   */
  const batchReplacing = members.filter((m) => {
    const cur = (m.journalBatchName ?? "").trim();
    return cur !== "" && cur !== batch.trim();
  });
  const batchWouldClear = !batch.trim() && batchReplacing.length > 0;
  const batchDirty = members.some((m) => (m.journalBatchName ?? "").trim() !== batch.trim());

  /** Brands whose own two accounts changed. The batch is the group's, above. */
  const dirty = members.filter((m) => !sameDraft(valueFor(m.brandCode), saved[m.brandCode]));
  /* A batch change touches every member, so it makes the whole group dirty. */
  const toWrite = batchDirty ? members : dirty;

  /**
   * Write only the brands whose values changed — one POST each, in order,
   * stopping at the first refusal and naming the brand it stopped on.
   *
   * The route is per claim brand and every guard on it is too, so a bulk
   * endpoint would have to re-implement them; and a half-applied save has to say
   * which brand it stopped on, or nobody can tell what state the group is in.
   */
  async function save() {
    if (batchWouldClear) {
      toast.error(`กรุณาเลือก Journal Batch — ค้างว่างไว้จะลบของ ${batchReplacing.map((m) => m.brandCode).join(", ")}`);
      return;
    }
    if (toWrite.length === 0) { setOpen(false); return; }
    setBusy(true);
    try {
      for (const m of toWrite) {
        const v = valueFor(m.brandCode);
        const res = await fetch("/api/request/clear-advance/settings/erp-interface", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brandCode: m.brandCode,
            journalBatchName: batch.trim(),
            vatInputGlAccountNo: v.vatGl.trim() || null,
            whtPayableGlAccountNo: v.whtGl.trim() || null,
          }),
        });
        const j = (await res.json()) as { ok: boolean; error?: string };
        if (!j.ok) {
          toast.error(`${m.brandCode}: ${j.error ?? "บันทึกไม่สำเร็จ"}`);
          return;
        }
      }
      toast.success(`บันทึกการตั้งค่า ERP แล้ว (${toWrite.map((m) => m.brandCode).join(", ")})`);
      setOpen(false);
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "บันทึกไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  const iface = ERP_INTERFACE_BRANDS.find((b) => b.id === target);
  const bcLine = [first?.bcName, first?.bcConnectionName, first?.environment]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3"
      style={{
        background: "var(--bg-card-alt)",
        border: `1px solid ${ready ? "var(--border-info-green)" : "var(--border-card)"}`,
      }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {iface && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={iface.logo} alt="" className="h-6 w-auto object-contain" />
          )}
          <span className="text-[14px] font-bold truncate" style={{ color: "var(--text-heading)" }}>{target}</span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {members.length} แบรนด์เบิก
          </span>
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

      <div className="grid grid-cols-3 gap-3 pt-2" style={{ borderTop: "1px solid var(--border-light)" }}>
        <GroupFieldSummary label="Journal Batch" state={batchState} />
        <GroupFieldSummary label="ภาษีซื้อ (VAT input)" state={vatState} />
        <GroupFieldSummary label="WHT payable" state={whtState} />
      </div>
      <ReadonlyField label="การเชื่อมต่อ BC" value={bcLine} />

      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
          {/* Not a control: AP-3 inherits its target from AP-2. */}
          แบรนด์ในกลุ่มตั้งที่ AP-2 → ตั้งค่า → Interface ERP
        </p>
        <Button variant="secondary" size="sm" icon={<Pencil size={14} />}
          disabled={members.length === 0} onClick={() => setOpen(true)}>
          แก้ไข
        </Button>
      </div>

      {open && (
        <Dialog
          open
          onOpenChange={(v) => { if (!v) setOpen(false); }}
          title={`ตั้งค่า Interface ERP — ${target}`}
          description={`${members.length} แบรนด์เบิก · Journal Batch ใช้ร่วมกันทั้งกลุ่ม · บัญชีภาษีแยกรายแบรนด์`}
        >
          <div className="flex flex-col gap-3">
            {batchErr && (
              <p className="text-[11px] m-0" style={{ color: "var(--color-danger)" }}>{batchErr}</p>
            )}
            {noBatches && (
              <p className="text-[11px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                ไม่พบ Journal Batch ของ {target} ใน ERP (sync ErpGeneralJournalBatch ก่อน)
              </p>
            )}

            {batchState.kind === "conflict" && (
              <p className="text-[11px] m-0 px-3 py-2 rounded-lg"
                style={{ background: "var(--bg-info-yellow)", color: "var(--text-info-yellow)", border: "1px solid var(--border-info-yellow)" }}>
                แบรนด์ในกลุ่มนี้ใช้ Journal Batch ไม่ตรงกัน — เลือกค่าที่ถูกต้องแล้วบันทึก จะเขียนให้ทุกแบรนด์ในกลุ่ม
              </p>
            )}

            {/* At the TOP and shared, like AP-2's (user, 2026-09-14). */}
            <div>
              <FieldLabel>Journal Batch * (ใช้ร่วมกันทั้งกลุ่ม)</FieldLabel>
              <SearchableSelect
                value={batch} onChange={setBatch}
                options={batchOptions(liveBatch?.data ?? [], batch)}
                disabled={busy || isLoading}
                placeholder={isLoading ? "กำลังโหลด batch..." : "เลือก Journal Batch"}
                emptyLabel="— ไม่ระบุ —"
                searchPlaceholder="ค้นหา Batch..."
                triggerBackground="var(--bg-card)"
              />
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
            </div>

            <FieldLabel>บัญชีภาษีของแต่ละแบรนด์เบิก</FieldLabel>

            {members.map((m) => {
              const v = valueFor(m.brandCode);
              const changed = !sameDraft(v, saved[m.brandCode]);
              return (
                <div key={m.brandCode} className="rounded-xl p-3 flex flex-col gap-2"
                  style={{
                    background: "var(--bg-card)",
                    border: `1px solid ${changed ? "var(--border-info-yellow)" : "var(--border-card)"}`,
                  }}>
                  <div className="flex items-center gap-2 min-w-0">
                    {m.brandLogo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.brandLogo} alt="" className="h-4 w-auto object-contain" />
                    )}
                    <span className="text-[12px] font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                      {m.brandName}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-faint)" }}>{m.brandCode}</span>
                    {!m.active && (
                      <span className="text-[10px]" style={{ color: "var(--text-faint)" }}>· ปิดใช้งานอยู่</span>
                    )}
                    {changed && (
                      <span className="text-[10px] ml-auto" style={{ color: "var(--text-info-yellow)" }}>แก้ไขแล้ว</span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <FieldLabel>ภาษีซื้อ (VAT input)</FieldLabel>
                      <SearchableSelect
                        value={v.vatGl} onChange={(x) => setFor(m.brandCode, { vatGl: x })}
                        options={glOptions(liveGl?.data ?? [], v.vatGl)}
                        disabled={busy || glLoading}
                        placeholder={glLoading ? "กำลังโหลดบัญชี..." : "เลือกบัญชีภาษีซื้อ"}
                        emptyLabel="— ไม่ระบุ —"
                        searchPlaceholder="ค้นหาบัญชี..."
                        triggerBackground="var(--bg-card-alt)"
                      />
                    </div>
                    <div className="min-w-0">
                      <FieldLabel>WHT payable</FieldLabel>
                      <SearchableSelect
                        value={v.whtGl} onChange={(x) => setFor(m.brandCode, { whtGl: x })}
                        options={glOptions(liveGl?.data ?? [], v.whtGl)}
                        disabled={busy || glLoading}
                        placeholder={glLoading ? "กำลังโหลดบัญชี..." : "เลือกบัญชี WHT payable"}
                        emptyLabel="— ไม่ระบุ —"
                        searchPlaceholder="ค้นหาบัญชี..."
                        triggerBackground="var(--bg-card-alt)"
                      />
                    </div>
                  </div>
                </div>
              );
            })}

            <p className="text-[10px] m-0" style={{ color: "var(--text-faint)" }}>
              {/* Says what the save does, because it is no longer "all of them". */}
              {batchDirty
                ? `Journal Batch เปลี่ยน — จะเขียนให้ทุกแบรนด์ในกลุ่ม: ${members.map((m) => m.brandCode).join(", ")}`
                : dirty.length > 0
                  ? `บันทึกเฉพาะแบรนด์ที่แก้ไข: ${dirty.map((m) => m.brandCode).join(", ")}`
                  : "ยังไม่มีการแก้ไข"}
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>ปิด</Button>
              <Button variant="primary" size="sm" icon={<Save size={14} />}
                onClick={save} loading={busy} disabled={busy || toWrite.length === 0 || batchWouldClear}>บันทึก</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/**
 * AP-3 Interface ERP — grouped by the target Company, like AP-1's and AP-4's.
 *
 * Company, G/L, bank and branch are inherited from the AP-2 entries being
 * cleared; what AP-3 configures is the clearing journal's batch and its two tax
 * accounts, and all three belong to the company whose books it posts into.
 */
export function ClrErpInterfaceSettings() {
  const { data, isLoading, mutate } = useSWR<{ ok: boolean; data?: ViewRow[] }>(
    "/api/request/clear-advance/settings/erp-interface", fetcher,
  );
  const rows = useMemo(() => data?.data ?? [], [data]);

  /**
   * Grouped by the Company the journal posts into, with every interface company
   * shown — an empty card is the only place a company's first brand can be
   * added.
   *
   * **`interfaceTarget` is never blank, so the leftovers have to be derived
   * here.** `listClrInterfaceConfigView` resolves it with a final `?? code`, so a brand with no
   * `AccBrandErpInterface` row is reported as posting into ITSELF. Measured
   * 2026-09-14: PLM is exactly that. Taken at face value it renders a card for a
   * Company that is not an interface target at all — and AP-3 cannot fix it
   * from here either, since membership is AP-2's.
   *
   * A target outside the four that is NOT the brand's own code is a different
   * thing — somebody mapped it somewhere unexpected — and keeps its group,
   * because that is precisely what needs to be seen.
   */
  const { groups, unassigned } = useMemo(() => {
    const known = new Set(ERP_INTERFACE_BRANDS.map((b) => b.id));
    const targetByClaim: Record<string, string> = {};
    for (const r of rows) {
      const t = (r.interfaceTarget ?? "").trim().toUpperCase();
      const unmapped = !known.has(t) && t === r.brandCode.trim().toUpperCase();
      targetByClaim[r.brandCode] = unmapped ? "" : t;
    }
    return groupByTargetIncludingEmpty(rows, targetByClaim, ERP_INTERFACE_BRANDS.map((b) => b.id));
  }, [rows]);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
        จัดกลุ่มตาม Company ปลายทาง — AP-3 กลับรายการจาก AP-2 · G/L · ธนาคาร · สาขา มาจากรายการที่เคลียร์เอง
        ตั้งค่าที่นี่: <b>Journal Batch</b> (ใช้ร่วมกันทั้งกลุ่ม) · บัญชี<b>ภาษีซื้อ (VAT input)</b> ·
        บัญชี<b>WHT payable</b> (แยกรายแบรนด์เบิก)
      </p>

      {isLoading ? (
        <p className="text-[13px] py-8 text-center" style={{ color: "var(--text-muted)" }}>กำลังโหลด...</p>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {groups.map((g) => (
              <GroupCard key={g.target} target={g.target} members={g.members} onSaved={() => mutate()} />
            ))}
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide m-0 mb-2" style={{ color: "var(--text-faint)" }}>
              ยังไม่ได้จัดกลุ่ม
            </p>
            {unassigned.length === 0 ? (
              <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
                ทุกแบรนด์เบิกถูกจัดกลุ่มแล้ว
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {unassigned.map((r) => <MemberChip key={r.brandCode} row={r} />)}
              </div>
            )}
            <p className="text-[10px] m-0 mt-2" style={{ color: "var(--text-faint)" }}>
              แบรนด์ที่ยังไม่มี Company ปลายทางตั้งค่าที่ AP-2 → ตั้งค่า → Interface ERP
            </p>
          </div>
        </>
      )}
    </div>
  );
}
