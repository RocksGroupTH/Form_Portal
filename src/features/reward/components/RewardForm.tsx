"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, Info, Loader2, Paperclip, Send, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui";
import { BrandChips } from "@/features/reward/components/BrandChips";
import { RewardCardPicker } from "@/features/reward/components/RewardCardPicker";
import { REWARD_FORM_MESSAGE_TH } from "@/features/reward/constants";
import type { RewardOption, RewardRequest } from "@/features/reward/types";

/**
 * The AP-11 request form.
 *
 * Follows the brief's numbered order top to bottom — who you are, what you want,
 * how many, and the evidence — because that is also the order the requester can
 * answer in: the quantity cap is meaningless before a reward is chosen, and the
 * evidence is about the activity the reward is for.
 *
 * The quantity cap shown here is advisory. Nothing is reserved until submit, and
 * the server re-tests availability inside a conditional UPDATE — so a requester
 * who sits on this page while somebody else takes the last item gets a clean 409
 * rather than a promise the stock cannot keep.
 */

interface EmployeeInfo {
  staffId: number | null;
  firstName: string | null;
  lastName: string | null;
  fullName: string | null;
  position: string | null;
  departmentName: string | null;
}

interface BrandOption {
  brandCode: string;
  brandName: string;
  brandLogo?: string | null;
}

/** A file the requester picked, still in the browser. */
interface PendingFile {
  key: number;
  file: File;
}

interface UploadedFile {
  id: number;
  fileName: string;
  fileSize: number | null;
}

function fileSizeLabel(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Section({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-[14px] p-4 sm:p-5"
      style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-baseline gap-2.5 mb-3">
        <span
          className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-extrabold shrink-0"
          style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
        >
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
            {title}
          </h2>
          {hint && (
            <p className="text-[11.5px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {hint}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] mb-1" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <p
        className="text-[13px] font-semibold rounded-lg px-3 py-2"
        style={{ background: "var(--bg-subtle)", color: "var(--text-primary)" }}
      >
        {value || "—"}
      </p>
    </div>
  );
}

export function RewardForm({
  initial,
  onSaved,
  onSubmitted,
}: {
  initial: RewardRequest | null;
  onSaved: (id: number) => void;
  onSubmitted: (id: number) => void;
}) {
  const [requestId, setRequestId] = useState<number | null>(initial?.id ?? null);
  const [employee, setEmployee] = useState<EmployeeInfo | null>(null);
  const [managerName, setManagerName] = useState<string | null>(null);

  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [brandCode, setBrandCode] = useState<string>(initial?.brandCode ?? "");

  const [rewards, setRewards] = useState<RewardOption[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(initial?.rewardId ?? null);
  const [qty, setQty] = useState<string>(initial?.qty ? String(initial.qty) : "");
  const [note, setNote] = useState<string>(initial?.note ?? "");

  const [files, setFiles] = useState<UploadedFile[]>(
    (initial?.attachments ?? []).map((a) => ({
      id: a.id,
      fileName: a.fileName,
      fileSize: a.fileSize,
    })),
  );
  /**
   * Files chosen but not yet sent anywhere.
   *
   * Picking a file used to create the draft on the spot, because the upload
   * route needs a request row to attach to. That made "แนบไฟล์" a hidden save —
   * one click on a file dialog and a row existed in AccRequest that the
   * requester never asked for, which is where the stray drafts came from. They
   * are held here instead and uploaded by the two buttons that mean "write
   * this": Save and Submit.
   */
  const [pending, setPending] = useState<PendingFile[]>([]);
  /**
   * The same queue, readable synchronously.
   *
   * `setPending` does not change `pending` until the next render, so anything
   * that both uploads a file and then asks "what is left?" inside one event
   * handler reads a list that still contains what it just sent. That is how one
   * attachment was uploaded twice: `save()` uploads, then the submit path asked
   * again and the stale array still held the file.
   */
  const pendingRef = useRef<PendingFile[]>([]);
  const pendingKey = useRef(0);

  /** Queue a file. Ref first, so a read in this same tick already sees it. */
  const queueFile = useCallback((file: File) => {
    pendingKey.current += 1;
    const next = pendingRef.current.concat({ key: pendingKey.current, file });
    pendingRef.current = next;
    setPending(next);
  }, []);

  /** Drop one queued file — uploaded, or taken back out by the requester. */
  const dropPending = useCallback((key: number) => {
    const next = pendingRef.current.filter((p) => p.key !== key);
    pendingRef.current = next;
    setPending(next);
  }, []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => rewards.find((r) => r.id === selectedId) ?? null,
    [rewards, selectedId],
  );

  /* ── Requester identity (brief §1-2) ── */
  useEffect(() => {
    const params = new URLSearchParams({ form: "AP-11" });
    if (requestId) params.set("id", String(requestId));
    fetch(`/api/me/employee?${params}`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const e = json.data?.employee;
        if (e) {
          setEmployee({
            staffId: e.staffId ?? null,
            firstName: e.firstName ?? null,
            lastName: e.lastName ?? null,
            fullName: e.fullName ?? null,
            position: e.position ?? null,
            departmentName: e.departmentName ?? null,
          });
        }
        setManagerName(json.data?.manager?.fullName ?? null);
      })
      .catch(() => {});
  }, [requestId]);

  /* ── Brands AP-11 is open for ── */
  useEffect(() => {
    fetch("/api/request/reward/options/brands")
      .then((r) => r.json())
      .then((json) => {
        if (!json.ok) return;
        const list = (json.data ?? []) as BrandOption[];
        setBrands(list);
        // One choice is not a choice — preselect it so the catalogue appears
        // without a click that has no alternative.
        if (!brandCode && list.length === 1) setBrandCode(list[0].brandCode);
      })
      .catch(() => {});
    // Intentionally once: the allowed-brand list does not change mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── The catalogue, per brand ── */
  useEffect(() => {
    if (!brandCode) {
      setRewards([]);
      return;
    }
    let cancelled = false;
    setRewardsLoading(true);
    // `all=1` so an already-chosen reward that has since sold out still renders
    // on a resumed draft, instead of silently vanishing from under the choice.
    fetch(`/api/request/reward/options/rewards?brand=${encodeURIComponent(brandCode)}&all=1`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json.ok) return;
        const all = (json.data ?? []) as RewardOption[];
        setRewards(all.filter((r) => r.selectable || r.id === selectedId));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setRewardsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [brandCode, selectedId]);

  const qtyNumber = Number(qty);
  const qtyValid = Number.isInteger(qtyNumber) && qtyNumber > 0;
  const overBalance = !!selected && qtyValid && qtyNumber > selected.balanceQty;

  const missing = useMemo(() => {
    const out: string[] = [];
    if (!brandCode) out.push("บริษัท");
    if (!selectedId) out.push("ของรางวัล");
    if (!qtyValid) out.push("จำนวนที่ขอเบิก");
    if (overBalance) out.push("จำนวนเกินคงเหลือ");
    if (files.length + pending.length === 0) out.push("เอกสารประกอบ");
    return out;
  }, [brandCode, selectedId, qtyValid, overBalance, files.length, pending.length]);

  /**
   * Send everything still held in the browser to a request that now exists.
   *
   * Sequential, not parallel: the upload route writes a placeholder
   * `AccRequestFile` row, pushes the bytes to SharePoint and then rewrites the
   * row with the driveItem id, so several at once contend for the same request.
   * Returns false on the first failure and leaves the rest pending — the file
   * is still on the requester's disk and still listed, so retrying is pressing
   * the button again.
   */
  const uploadPending = useCallback(async (id: number): Promise<boolean> => {
    if (pendingRef.current.length === 0) return true;
    setUploading(true);
    try {
      // Snapshot: `dropPending` rewrites the ref as each one lands.
      for (const p of pendingRef.current.slice()) {
        const fd = new FormData();
        fd.append("file", p.file);
        const res = await fetch(`/api/request/reward/requests/${id}/files`, {
          method: "POST",
          body: fd,
        });
        const json = await res.json();
        if (!json.ok) {
          toast.error(json.error ?? `อัปโหลด ${p.file.name} ไม่สำเร็จ`);
          return false;
        }
        setFiles((prev) => [
          ...prev,
          { id: json.data.id, fileName: json.data.fileName, fileSize: json.data.fileSize },
        ]);
        dropPending(p.key);
      }
      return true;
    } catch {
      toast.error("อัปโหลดไฟล์ไม่สำเร็จ");
      return false;
    } finally {
      setUploading(false);
    }
  }, [dropPending]);

  /**
   * Persist the draft, creating it on first save. Returns the id, or null.
   *
   * `syncUrl` is what a submit turns off. `onSaved` puts the new id in the
   * address bar so a reload resumes the draft, which is right for an explicit
   * Save — but a submit calls this on its way past, and that URL change makes
   * the page re-read the request, show its loading screen and rebuild the form,
   * all of it visible for a moment before the redirect. The submit path
   * restores the URL itself if it fails to get past this point.
   */
  const save = useCallback(
    async (silent = false, syncUrl = true): Promise<number | null> => {
      if (!brandCode) {
        if (!silent) toast.error("กรุณาเลือกบริษัทก่อน");
        return null;
      }
      setSaving(true);
      try {
        const body = {
          brandCode,
          rewardId: selectedId,
          qty: qtyValid ? qtyNumber : 0,
          note: note.trim() || null,
        };
        const res = requestId
          ? await fetch(`/api/request/reward/requests/${requestId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch("/api/request/reward/requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
        const json = await res.json();
        if (!json.ok) {
          if (!silent) toast.error(json.error ?? "บันทึกไม่สำเร็จ");
          return null;
        }
        const id = requestId ?? (json.data?.id as number);
        if (!requestId && id) {
          setRequestId(id);
          if (syncUrl) onSaved(id);
        }
        // Attachments need a request row, so they ride along with the save that
        // creates one. A failed upload does not fail the save — the draft is
        // written either way, and the files stay listed to retry.
        if (id) await uploadPending(id);
        if (!silent) toast.success("บันทึกฉบับร่างแล้ว");
        return id;
      } catch {
        if (!silent) toast.error("บันทึกไม่สำเร็จ");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [brandCode, selectedId, qty, qtyValid, qtyNumber, note, requestId, onSaved, uploadPending],
  );

  /**
   * Queue evidence. Writes nothing — see `pending`.
   *
   * On a draft that already exists the file could be uploaded straight away,
   * but it is queued there too: one rule is easier to reason about than two,
   * and it keeps "แนบไฟล์" meaning the same thing on every visit.
   */
  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    queueFile(file);
  }

  async function handleFileRemove(fileId: number) {
    if (!requestId) return;
    try {
      const res = await fetch(
        `/api/request/reward/requests/${requestId}/files?fileId=${fileId}`,
        { method: "DELETE" },
      );
      const json = await res.json();
      if (!json.ok) {
        toast.error(json.error ?? "ลบไฟล์ไม่สำเร็จ");
        return;
      }
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
    } catch {
      toast.error("ลบไฟล์ไม่สำเร็จ");
    }
  }

  async function handleSubmit() {
    if (missing.length > 0) {
      toast.error(`ยังกรอกไม่ครบ: ${missing.join(", ")}`);
      return;
    }
    setSubmitting(true);
    // A draft created here and then not submitted has to end up in the URL, or
    // a reload starts a second one. Tracked rather than synced up front so the
    // successful path never navigates twice.
    const wasNew = requestId == null;
    let strandedId: number | null = null;
    try {
      const id = await save(true, false);
      if (!id) {
        toast.error("บันทึกก่อนส่งไม่สำเร็จ");
        return;
      }
      if (wasNew) strandedId = id;
      // `save` has already uploaded the queue. Anything still in it failed
      // there and said so, and retrying here would be a second attempt at a
      // file the server may well have stored before the error — stop instead.
      if (pendingRef.current.length > 0) return;
      const res = await fetch(`/api/request/reward/requests/${id}/submit`, { method: "POST" });
      const json = await res.json();
      if (!json.ok) {
        // 409 means the stock went while this page was open — the message says
        // so, and a reload is the only useful next step.
        toast.error(json.error ?? "ส่งคำขอไม่สำเร็จ");
        if (res.status === 409) {
          setRewards([]);
          setSelectedId(null);
        }
        return;
      }
      // The detail page is no longer where this lands, so the running number —
      // the thing a requester quotes when they ask about their request — is
      // said here instead of only being rendered there.
      const requestNo = (json.data?.requestNo as string | null) ?? null;
      toast.success(requestNo ? `ส่งคำขอแล้ว · ${requestNo}` : "ส่งคำขอแล้ว");
      // Submitted: the page is leaving for /my-request, so there is nothing to
      // strand and no URL worth writing on the way out.
      strandedId = null;
      onSubmitted(id);
    } catch {
      toast.error("ส่งคำขอไม่สำเร็จ");
    } finally {
      setSubmitting(false);
      if (strandedId != null) onSaved(strandedId);
    }
  }

  const fullName =
    [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") ||
    employee?.fullName ||
    "";

  return (
    <div className="space-y-4">
      {/* Header message — brief's "Message" block, verbatim. */}
      <div
        className="rounded-[14px] px-4 py-3 flex gap-2.5"
        style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
      >
        <Info size={16} className="shrink-0 mt-0.5" />
        <div className="text-[12px] leading-relaxed space-y-0.5">
          {REWARD_FORM_MESSAGE_TH.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>

      {/* 1-2. Requester (brief §1-2) — read-only, straight from HR. */}
      <Section step={1} title="ผู้ขอเบิก" hint="ดึงจากระบบ HR โดยอัตโนมัติ">
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
          <ReadOnlyField label="รหัสพนักงาน" value={employee?.staffId ? String(employee.staffId) : ""} />
          <ReadOnlyField label="ชื่อ-สกุล" value={fullName} />
          <ReadOnlyField label="แผนก" value={employee?.departmentName ?? ""} />
          <ReadOnlyField label="ผู้อนุมัติ (ผู้จัดการ)" value={managerName ?? ""} />
        </div>
        {!managerName && (
          <p className="text-[11.5px] mt-2 flex items-center gap-1.5" style={{ color: "var(--text-warning)" }}>
            <UserRound size={13} />
            ยังไม่พบผู้จัดการในระบบ HR — จะส่งคำขอไม่ได้จนกว่าจะตั้งค่าเรียบร้อย
          </p>
        )}
      </Section>

      {/* Brand — rewards are brand-scoped stock, so this gates the catalogue. */}
      {brands.length > 1 && (
        <Section step={2} title="บริษัท" hint="ของรางวัลแยกตามบริษัท">
          <BrandChips
            brands={brands}
            isActive={(code) => brandCode === code}
            onSelect={(code) => {
              setBrandCode(code);
              setSelectedId(null);
            }}
          />
        </Section>
      )}

      {/* 3. The catalogue (brief §3). */}
      <Section
        step={brands.length > 1 ? 3 : 2}
        title="เลือกของรางวัล"
        hint="แสดงเฉพาะรายการที่ยังเบิกได้ พร้อมจำนวนคงเหลือและมูลค่าต่อชิ้น"
      >
        {!brandCode ? (
          <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            เลือกบริษัทก่อนเพื่อดูของรางวัล
          </p>
        ) : rewardsLoading ? (
          <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={14} className="animate-spin" />
            กำลังโหลดของรางวัล...
          </div>
        ) : (
          <RewardCardPicker
            rewards={rewards}
            selectedId={selectedId}
            onSelect={(r) => {
              setSelectedId(r.id);
              // Snap an over-cap quantity down rather than leaving an invalid
              // number sitting in the field after a change of reward.
              if (qtyValid && qtyNumber > r.balanceQty) setQty(String(r.balanceQty));
            }}
          />
        )}
      </Section>

      {/* 4. Quantity (brief §4). */}
      <Section
        step={brands.length > 1 ? 4 : 3}
        title="จำนวนที่ขอเบิก"
        hint="ไม่เกินจำนวนคงเหลือของรางวัลที่เลือก"
      >
        {!selected ? (
          <p className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
            เลือกของรางวัลก่อน
          </p>
        ) : (
          <div className="space-y-3">
            <div
              className="flex items-center justify-between rounded-xl px-3.5 py-2.5"
              style={{ background: "var(--bg-subtle)" }}
            >
              <div className="min-w-0">
                <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-primary)" }}>
                  {selected.name}
                </p>
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {selected.code}
                </p>
              </div>
              <div className="text-right shrink-0 ml-3">
                <p className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                  คงเหลือ
                </p>
                <p className="text-[16px] font-extrabold" style={{ color: "var(--text-primary)" }}>
                  {selected.balanceQty}
                </p>
              </div>
            </div>

            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label
                  className="text-[11px] block mb-1"
                  style={{ color: "var(--text-muted)" }}
                  htmlFor="reward-qty"
                >
                  จำนวน (ชิ้น)
                </label>
                <input
                  id="reward-qty"
                  type="number"
                  min={1}
                  max={selected.balanceQty}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  className="w-28 text-[15px] font-bold rounded-lg px-3 py-2 outline-none"
                  style={{
                    background: "var(--bg-card)",
                    color: "var(--text-primary)",
                    border: `1.5px solid ${overBalance ? "var(--text-danger)" : "var(--border-card)"}`,
                  }}
                />
              </div>
              {qtyValid && selected.unitActualValue != null && !overBalance && (
                <div className="pb-2">
                  <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                    มูลค่ารวม
                  </p>
                  <p className="text-[14px] font-bold" style={{ color: "var(--text-primary)" }}>
                    {(selected.unitActualValue * qtyNumber).toLocaleString("th-TH", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    บาท
                  </p>
                </div>
              )}
            </div>

            {overBalance && (
              <p className="text-[11.5px] font-semibold" style={{ color: "var(--text-danger)" }}>
                เกินจำนวนคงเหลือ — เบิกได้สูงสุด {selected.balanceQty} ชิ้น
              </p>
            )}

            <div>
              <label
                className="text-[11px] block mb-1"
                style={{ color: "var(--text-muted)" }}
                htmlFor="reward-note"
              >
                หมายเหตุ (ถ้ามี)
              </label>
              <textarea
                id="reward-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full text-[13px] rounded-lg px-3 py-2 outline-none resize-y"
                style={{
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  border: "1.5px solid var(--border-card)",
                }}
              />
            </div>
          </div>
        )}
      </Section>

      {/* 5. Evidence (brief §5). */}
      <Section
        step={brands.length > 1 ? 5 : 4}
        title="เอกสารประกอบการเบิก"
        hint="เช่น ภาพหน้าจอกิจกรรมที่จัด หรือหน้าจอ Token Redeem — ต้องแนบอย่างน้อย 1 ไฟล์"
      >
        <div className="space-y-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2"
              style={{ background: "var(--bg-subtle)" }}
            >
              <FileText size={15} style={{ color: "var(--text-muted)" }} className="shrink-0" />
              <span
                className="text-[12.5px] font-semibold truncate flex-1"
                style={{ color: "var(--text-primary)" }}
              >
                {f.fileName}
              </span>
              <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                {fileSizeLabel(f.fileSize)}
              </span>
              <button
                type="button"
                onClick={() => handleFileRemove(f.id)}
                className="shrink-0 p-1 rounded-md"
                style={{ color: "var(--text-danger)" }}
                aria-label={`ลบไฟล์ ${f.fileName}`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          {pending.map((p) => (
            <div
              key={p.key}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2"
              style={{
                background: "var(--bg-card-alt)",
                border: "1px dashed var(--border-card)",
              }}
            >
              <FileText size={15} style={{ color: "var(--text-muted)" }} className="shrink-0" />
              <span
                className="text-[12.5px] font-semibold truncate flex-1"
                style={{ color: "var(--text-primary)" }}
              >
                {p.file.name}
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0"
                style={{ background: "var(--status-draft-bg)", color: "var(--status-draft-text)" }}
              >
                รอบันทึก
              </span>
              <span className="text-[11px] shrink-0" style={{ color: "var(--text-muted)" }}>
                {fileSizeLabel(p.file.size)}
              </span>
              <button
                type="button"
                onClick={() => dropPending(p.key)}
                className="shrink-0 p-1 rounded-md"
                style={{ color: "var(--text-danger)" }}
                aria-label={`เอาไฟล์ ${p.file.name} ออก`}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,application/pdf"
            hidden
            onChange={handleFilePick}
          />
          <Button
            variant="secondary"
            size="md"
            loading={uploading}
            icon={<Paperclip size={14} />}
            onClick={() => fileInputRef.current?.click()}
          >
            แนบไฟล์
          </Button>
          <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            รองรับรูปภาพและ PDF
            {pending.length > 0 && " — ไฟล์จะถูกอัปโหลดเมื่อกดบันทึกฉบับร่างหรือส่งคำขอ"}
          </p>
        </div>
      </Section>

      {/* Actions */}
      <div
        className="rounded-[14px] p-4 flex flex-wrap items-center gap-3"
        style={{ background: "var(--bg-card)", boxShadow: "var(--shadow-card)" }}
      >
        <Button variant="secondary" size="lg" loading={saving} onClick={() => save(false)}>
          บันทึกฉบับร่าง
        </Button>
        <Button
          variant="primary"
          size="lg"
          loading={submitting}
          icon={<Send size={14} />}
          onClick={handleSubmit}
          disabled={missing.length > 0}
        >
          ส่งคำขอ
        </Button>
        {missing.length > 0 && (
          <p className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            ยังขาด: {missing.join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}
