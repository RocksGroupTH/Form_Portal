"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, FileText, History, IdCard, Loader2, Paperclip, ScanLine, Trash2 } from "lucide-react";
import type { TravelBookingFileMeta } from "@/features/travel-booking/types";
import { looksLikeThaiIdCard, type IdCardCheck } from "@/features/travel-booking/lib/idcard-check";
import { ImageLightbox } from "@/features/accounting/components/ImageLightbox";
import { errLabelStyle, labelClass, requiredStar } from "./shared";

/**
 * ข้อ17 — แนบบัตรประชาชน (≥1, images or PDF). Uploads go straight to the server
 * (SharePoint-backed) once the tab has a real request id, so the tab must be
 * saved as a draft first — this component surfaces that as an explicit
 * "บันทึกร่างก่อน" action rather than silently doing nothing.
 */
interface PreviousIdCard {
  fileId: number;
  requestId: number;
  fileName: string;
  contentType: string;
  uploadedAt: string;
}

export function IdCardUpload({
  files,
  requestId,
  requesterStaffId,
  pendingFile,
  onSelectPending,
  onRemove,
  hasError,
}: {
  files: TravelBookingFileMeta[];
  requestId?: number | null;
  /** ผู้ขอเบิก (self = null). Consent + previous-card lookup are keyed on this, not requestId,
   *  so reuse works on a brand-new trip before it's ever saved. */
  requesterStaffId?: number | null;
  /** Picked-but-not-yet-uploaded card (uploaded on save, like AP-1). */
  pendingFile: File | null;
  onSelectPending: (file: File | null) => void;
  onRemove: (fileId: number) => Promise<boolean>;
  hasError?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  /**
   * The refusal popup. `unavailable` separates "this photo is not a card" from
   * "the check could not be reached" — both refuse the file, but the title and
   * the button were hardcoded to the first, so somebody holding a perfectly
   * good ID card was told it was not one and offered another photo as the
   * remedy. Measured 2026-08-24 against a revoked key.
   */
  const [refusal, setRefusal] = useState<{ message: string; unavailable: boolean } | null>(null);
  // Reuse-a-previous-card (server-side, per requester consent).
  const [previousCard, setPreviousCard] = useState<PreviousIdCard | null>(null);
  const [reuseConsent, setReuseConsent] = useState<boolean | null>(null);
  const [reusing, setReusing] = useState(false);
  const [consentAsk, setConsentAsk] = useState(false);

  // Only one ID-card image allowed.
  const hasFile = files.length > 0;

  // Local preview for a picked-but-not-yet-uploaded card.
  const pendingUrl = useMemo(() => (pendingFile ? URL.createObjectURL(pendingFile) : null), [pendingFile]);
  useEffect(() => () => { if (pendingUrl) URL.revokeObjectURL(pendingUrl); }, [pendingUrl]);

  // Load the requester's reuse consent + latest previously-stored card. Keyed on the requester
  // (not requestId), so a brand-new unsaved trip still learns the consent state and gets the reuse
  // offer. Re-runs when the attached files change (a fresh save becomes the new "latest" card).
  useEffect(() => {
    let cancelled = false;
    const sid = requesterStaffId ?? "";
    const exclude = requestId ?? "";
    fetch(`/api/request/travel-booking/id-card/previous?requesterStaffId=${sid}&excludeRequestId=${exclude}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled || !json?.ok) return;
        setPreviousCard(json.data?.card ?? null);
        setReuseConsent(json.data?.consent ?? null);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [requesterStaffId, requestId, files.length]);

  // Ask consent the moment a NEW card is picked (pending null → set), unless the requester already
  // chose to KEEP their card (true → the reuse offer is shown instead of asking). "ไม่เก็บ" (false)
  // is a per-time choice, so a newly-picked card asks again.
  const prevPendingRef = useRef<boolean>(!!pendingFile);
  useEffect(() => {
    const has = !!pendingFile;
    if (has && !prevPendingRef.current && reuseConsent !== true) setConsentAsk(true);
    prevPendingRef.current = has;
  }, [pendingFile, reuseConsent]);

  const submitConsent = useCallback(async (consent: boolean) => {
    setConsentAsk(false);
    setReuseConsent(consent);
    try {
      await fetch(`/api/request/travel-booking/id-card/consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requesterStaffId: requesterStaffId ?? null, consent }),
      });
    } catch { /* best-effort — the local state already reflects the choice */ }
  }, [requesterStaffId]);

  // Reuse a stored card by pulling its bytes and holding them as the pending file — it uploads on
  // save exactly like a freshly-picked card, so no saved draft is required first.
  const handleReuse = useCallback(async () => {
    if (!previousCard) return;
    setReusing(true);
    try {
      const sid = requesterStaffId ?? "";
      const res = await fetch(
        `/api/request/travel-booking/id-card/previous/download?requesterStaffId=${sid}&fileId=${previousCard.fileId}`,
      );
      if (!res.ok) throw new Error("download failed");
      const blob = await res.blob();
      const file = new File([blob], previousCard.fileName, { type: previousCard.contentType || blob.type });
      onSelectPending(file);
    } catch {
      toast.error("ใช้บัตรเดิมไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setReusing(false);
    }
  }, [previousCard, requesterStaffId, onSelectPending]);

  const handleFiles = async (fileList: FileList | null) => {
    const file = fileList?.[0];
    if (!file) return;
    const reset = () => { if (inputRef.current) inputRef.current.value = ""; };
    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาแนบเป็นรูปภาพบัตรประชาชน");
      reset();
      return;
    }

    // Ask the server whether this really is a Thai national ID card.
    setChecking(true);
    let result: IdCardCheck;
    try {
      result = await looksLikeThaiIdCard(file);
    } catch {
      result = { ok: false, unavailable: true };
    } finally {
      setChecking(false);
    }

    // Nothing is attached without a verdict of "yes" — a failure to *reach* the
    // check refuses the file exactly like a "this is not a card" does. Decided
    // 2026-08-24 with the cost accepted: while the check cannot run, AP-17
    // cannot be filed, because this attachment is required to submit.
    // `result.reason` already says which remedy applies — wait, retry, tell IT,
    // or attach a different photo.
    if (!result.ok) {
      setRefusal({
        message: result.reason ?? "กรุณาอัปโหลดรูปบัตรประชาชนที่ชัดเจน",
        unavailable: !!result.unavailable,
      });
      reset();
      return;
    }

    // Held locally; it uploads when the draft is saved (like AP-1).
    onSelectPending(file);
    reset();
  };

  const handleRemove = async (fileId: number) => {
    setRemovingId(fileId);
    try {
      await onRemove(fileId);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div>
      <label className={labelClass} style={errLabelStyle(!!hasError)}>
        แนบรูปบัตรประชาชน (1 รูป){requiredStar}
      </label>

      <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          {!hasFile && !pendingFile && previousCard && (
            <div
              className="mb-2 rounded-xl p-2.5 flex items-center gap-3"
              style={{ border: "1px solid var(--nav-active-text)", background: "var(--nav-active-bg)" }}
            >
              <button
                type="button"
                onClick={() => { if (previousCard.contentType.startsWith("image/")) setLightboxSrc(`/api/request/travel-booking/files/${previousCard.fileId}`); }}
                title={previousCard.contentType.startsWith("image/") ? "แตะเพื่อดูรูปเต็ม" : undefined}
                aria-label="ดูรูปบัตรเต็ม"
                className={`relative w-12 h-12 rounded-lg overflow-hidden border shrink-0 flex items-center justify-center p-0 ${previousCard.contentType.startsWith("image/") ? "cursor-zoom-in" : ""}`}
                style={{ borderColor: "var(--border-card)", background: "var(--bg-card)" }}
              >
                <IdCard size={22} style={{ color: "var(--nav-active-text)" }} />
                {previousCard.contentType.startsWith("image/") && (
                  <img
                    src={`/api/request/travel-booking/files/${previousCard.fileId}`}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                    draggable={false}
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                  />
                )}
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-bold" style={{ color: "var(--nav-active-text)" }}>
                  ใช้บัตรประชาชนที่เคยแนบล่าสุด
                </div>
                <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {previousCard.fileName} · {new Date(previousCard.uploadedAt).toLocaleDateString("th-TH", { day: "2-digit", month: "short", year: "numeric" })}
                </div>
              </div>
              <button
                type="button"
                onClick={handleReuse}
                disabled={reusing}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-bold cursor-pointer border-none text-white disabled:opacity-60"
                style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
              >
                {reusing ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />} ใช้บัตรนี้
              </button>
            </div>
          )}
          {pendingFile ? (
            <div
              className="w-full rounded-2xl flex flex-col items-center gap-3.5 py-7 px-4"
              style={{ border: "1.5px dashed var(--border-card)", background: "var(--bg-card-alt)" }}
            >
              <div
                className="relative rounded-xl overflow-hidden border"
                style={{ borderColor: "var(--border-card)", background: "var(--bg-card)", width: 160, height: 160 }}
              >
                {pendingUrl && <img src={pendingUrl} alt="" className="block w-full h-full object-cover" draggable={false} />}
                <button
                  type="button"
                  onClick={() => onSelectPending(null)}
                  aria-label="เอารูปออก"
                  title="เอารูปออก"
                  className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-white cursor-pointer border-none"
                  style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", boxShadow: "var(--shadow-lg)" }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="text-center">
                {/* Unconditional again, and truthful: nothing becomes a pending
                    file without a positive verdict. */}
                <div className="inline-flex items-center gap-1.5 text-[12.5px] font-bold" style={{ color: "#4fa37a" }}>
                  <CheckCircle2 size={14} /> ตรวจสอบแล้วเป็นบัตรประชาชน
                </div>
                <div className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {pendingFile.name} · จะอัปโหลดเมื่อกดบันทึกร่าง/ส่งคำขอ · ชี้ที่รูปเพื่อเอาออก
                </div>
              </div>
            </div>
          ) : !hasFile ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={checking}
              onDragOver={(e) => {
                if (checking) return;
                e.preventDefault();
                if (!dragging) setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                if (checking) return;
                void handleFiles(e.dataTransfer.files);
              }}
              className="w-full rounded-2xl flex flex-col items-center gap-3.5 py-7 px-4 cursor-pointer transition-colors disabled:opacity-60"
              style={{
                border: `1.5px dashed ${dragging ? "var(--nav-active-text)" : "var(--border-card)"}`,
                background: dragging ? "var(--nav-active-bg)" : "var(--bg-card-alt)",
              }}
            >
              {checking ? (
                <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color: "var(--nav-active-text)" }}>
                  <ScanLine size={16} className="animate-pulse" /> กำลังตรวจสอบบัตรประชาชน...
                </span>
              ) : (
                <>
                  {/* ID-card scan frame */}
                  <div className="relative flex items-center justify-center" style={{ width: 140, height: 88 }}>
                    {[
                      "left-0 top-0 border-l-2 border-t-2 rounded-tl-md",
                      "right-0 top-0 border-r-2 border-t-2 rounded-tr-md",
                      "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-md",
                      "right-0 bottom-0 border-r-2 border-b-2 rounded-br-md",
                    ].map((c) => (
                      <span key={c} className={`absolute w-5 h-5 ${c}`} style={{ borderColor: "var(--nav-active-text)" }} />
                    ))}
                    <div className="flex flex-col items-center gap-1.5" style={{ color: "var(--nav-active-text)" }}>
                      <IdCard size={30} />
                      <div className="flex gap-1">
                        {[16, 24, 12].map((w, i) => (
                          <span key={i} className="h-1 rounded-full" style={{ width: w, background: "var(--nav-active-text)", opacity: 0.4 }} />
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="text-center">
                    <div className="text-[13.5px] font-bold" style={{ color: "var(--text-heading)" }}>
                      {dragging ? "วางรูปที่นี่" : "แนบรูปบัตรประชาชน"}
                    </div>
                    <div className="text-[11.5px] mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      ลากรูปมาวาง หรือกดเลือกรูป — เห็นเลข 13 หลักและตัวอักษรครบ ไม่เบลอ ไม่มีแสงสะท้อน
                    </div>
                  </div>

                  <span
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12.5px] font-bold text-white"
                    style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
                  >
                    <Paperclip size={14} /> เลือกรูป
                  </span>
                </>
              )}
            </button>
          ) : (
            <div className="flex flex-col gap-2">
              {files.map((f) => {
                const url = `/api/request/travel-booking/files/${f.id}`;
                const isImage = f.contentType.startsWith("image/");
                const removing = removingId === f.id;
                return (
                  // Same large boxed format as the pre-upload dropzone, now showing the attached card.
                  <div
                    key={f.id}
                    className="w-full rounded-2xl flex flex-col items-center gap-3.5 py-7 px-4"
                    style={{ border: "1.5px dashed var(--border-card)", background: "var(--bg-card-alt)" }}
                  >
                    {isImage ? (
                      <div
                        className="group relative rounded-xl overflow-hidden border"
                        style={{ borderColor: "var(--border-card)", background: "var(--bg-card)", width: 160, height: 160 }}
                      >
                        <img
                          src={url}
                          alt={f.fileName}
                          className="block w-full h-full object-cover"
                          draggable={false}
                        />
                        {/* tap the image to view full */}
                        <button
                          type="button"
                          onClick={() => setLightboxSrc(url)}
                          title="แตะเพื่อดูรูปเต็ม"
                          aria-label="ดูรูปเต็ม"
                          className="absolute inset-0 cursor-zoom-in border-none bg-transparent"
                        />
                        {/* delete (icon only) — top-right corner, leaves the rest of the image tappable to enlarge */}
                        <button
                          type="button"
                          onClick={() => handleRemove(f.id)}
                          disabled={removing}
                          aria-label="ลบรูป"
                          title="ลบรูป"
                          className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-white cursor-pointer border-none opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 transition-opacity disabled:opacity-60"
                          style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", boxShadow: "var(--shadow-lg)" }}
                        >
                          {removing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="group relative rounded-xl overflow-hidden border flex items-center justify-center"
                        style={{ borderColor: "var(--border-card)", background: "var(--bg-card)", width: 160, height: 160 }}
                      >
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="absolute inset-0 flex items-center justify-center no-underline"
                        >
                          <FileText size={36} style={{ color: "var(--text-muted)" }} />
                        </a>
                        <button
                          type="button"
                          onClick={() => handleRemove(f.id)}
                          disabled={removing}
                          aria-label="ลบไฟล์"
                          title="ลบไฟล์"
                          className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center text-white cursor-pointer border-none opacity-0 group-hover:opacity-100 focus:opacity-100 max-md:opacity-100 transition-opacity disabled:opacity-60"
                          style={{ background: "var(--btn-danger-bg)", color: "var(--btn-danger-text)", border: "1px solid var(--btn-danger-border)", boxShadow: "var(--shadow-lg)" }}
                        >
                          {removing ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                        </button>
                      </div>
                    )}

                    <div className="text-center">
                      <div className="inline-flex items-center gap-1.5 text-[13px] font-bold" style={{ color: "#4fa37a" }}>
                        <CheckCircle2 size={15} /> ตรวจสอบแล้วเป็นบัตรประชาชน
                      </div>
                      <div className="text-[11.5px] mt-1 leading-relaxed break-all" style={{ color: "var(--text-muted)" }}>
                        {f.fileName}{isImage ? " · แตะรูปเพื่อดูเต็ม · ชี้ที่รูปเพื่อลบ" : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </>

      {/* OCR checking overlay */}
      {checking && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div
              className="rounded-2xl px-7 py-6 flex flex-col items-center gap-3 text-center max-w-[90vw]"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
            >
              <style>{`
                @keyframes idcardScan { 0% { top: 16%; opacity: .25 } 50% { top: 80%; opacity: 1 } 100% { top: 16%; opacity: .25 } }
                @keyframes idcardBar { 0% { left: -42% } 100% { left: 100% } }
              `}</style>
              {/* scanning icon */}
              <div
                className="relative w-14 h-14 rounded-xl overflow-hidden flex items-center justify-center"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                <ScanLine size={28} />
                <span
                  aria-hidden
                  style={{
                    position: "absolute", left: "10%", right: "10%", height: 2, borderRadius: 2,
                    background: "linear-gradient(90deg, transparent, var(--nav-active-text), transparent)",
                    animation: "idcardScan 1.3s ease-in-out infinite",
                  }}
                />
              </div>
              <div className="text-[15px] font-bold" style={{ color: "var(--text-heading)" }}>กำลังตรวจสอบบัตรประชาชน...</div>
              <div className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
                กำลังอ่านข้อมูลบนบัตร (ครั้งแรกอาจใช้เวลาสักครู่)
              </div>
              {/* indeterminate progress bar */}
              <div className="relative w-44 h-1 rounded-full overflow-hidden mt-1" style={{ background: "var(--bg-card-alt)" }}>
                <span
                  aria-hidden
                  className="absolute top-0 bottom-0 rounded-full"
                  style={{ width: "42%", background: "var(--nav-active-text)", animation: "idcardBar 1.1s ease-in-out infinite" }}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* Refusal popup — the photo is not a card, or the check could not run */}
      {refusal && typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.5)" }}
            onClick={() => setRefusal(null)}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
              className="rounded-2xl px-7 py-6 flex flex-col items-center gap-3 text-center max-w-[92vw] w-[360px]"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: "color-mix(in srgb, var(--color-danger) 14%, transparent)", color: "var(--color-danger)" }}
              >
                <AlertTriangle size={28} />
              </div>
              <div className="text-[15.5px] font-bold" style={{ color: "var(--text-heading)" }}>
                {refusal.unavailable ? "ตรวจรูปบัตรไม่สำเร็จ" : "ไม่ใช่บัตรประชาชน"}
              </div>
              <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                {refusal.message}
              </div>
              <button
                type="button"
                onClick={() => setRefusal(null)}
                className="mt-1 w-full inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg text-[13px] font-bold text-white border-none cursor-pointer"
                style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
              >
                {/* Another photo is no remedy when the check itself is down. */}
                {refusal.unavailable ? "ปิด" : "เลือกรูปใหม่"}
              </button>
            </div>
          </div>,
          document.body,
        )}

      {/* Consent: remember this card for reuse (per requester) */}
      {consentAsk && typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
            <div
              role="alertdialog"
              aria-modal="true"
              className="rounded-2xl px-7 py-6 flex flex-col items-center gap-3 text-center max-w-[92vw] w-[380px]"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)", boxShadow: "var(--shadow-modal)" }}
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: "var(--nav-active-bg)", color: "var(--nav-active-text)" }}
              >
                <IdCard size={28} />
              </div>
              <div className="text-[15.5px] font-bold" style={{ color: "var(--text-heading)" }}>
                เก็บรูปบัตรไว้ใช้ครั้งถัดไปไหม?
              </div>
              <div className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                ครั้งหน้าที่เปิดทริป/คำขอใหม่ของผู้ขอเบิกคนนี้ จะมีปุ่มให้ใช้บัตรนี้ซ้ำได้ทันที ไม่ต้องแนบใหม่ (เก็บไว้ในระบบอย่างปลอดภัย)
              </div>
              <div className="flex gap-2 w-full mt-1">
                <button
                  type="button"
                  onClick={() => submitConsent(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg text-[13px] font-bold cursor-pointer"
                  style={{ background: "var(--bg-card-alt)", border: "1px solid var(--border-card)", color: "var(--text-secondary)" }}
                >
                  ไม่เก็บ
                </button>
                <button
                  type="button"
                  onClick={() => submitConsent(true)}
                  className="flex-1 px-4 py-2.5 rounded-lg text-[13px] font-bold text-white border-none cursor-pointer"
                  style={{ background: "var(--btn-primary-bg)", color: "var(--btn-primary-text)", border: "1px solid var(--btn-primary-border)" }}
                >
                  เก็บไว้ใช้ครั้งหน้า
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      <ImageLightbox open={!!lightboxSrc} src={lightboxSrc ?? ""} onClose={() => setLightboxSrc(null)} />
    </div>
  );
}
