"use client";

/**
 * Shared building blocks for the AP-3 (Clear Advance) admin pages.
 *
 * These mirror the AP-1 / AP-2 admin idioms (card surfaces, CSS-var colors,
 * lucide icons) so the AP-3 back-office pages read identically. Kept lean:
 * a forbidden state, a small table shell, a fetch helper, and a couple of
 * display formatters that avoid `toISOString` for on-screen dates.
 */

import Link from "next/link";
import { Lock } from "lucide-react";

/* ── API envelope ── */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

/** True when a fetch Response is an authz failure (show the friendly state). */
export function isForbiddenStatus(status: number): boolean {
  return status === 403;
}

/**
 * GET an { ok, data } | { ok, error } endpoint.
 * Returns { forbidden: true } on a 403 so callers can render the friendly
 * "ไม่มีสิทธิ์เข้าถึง" state instead of crashing.
 */
export async function fetchList<T>(
  url: string,
): Promise<{ data: T[]; forbidden: boolean }> {
  const res = await fetch(url);
  if (isForbiddenStatus(res.status)) return { data: [], forbidden: true };
  const json = (await res.json().catch(() => null)) as ApiResult<T[]> | null;
  if (!json || !json.ok) return { data: [], forbidden: false };
  return { data: json.data ?? [], forbidden: false };
}

/** POST JSON to an { ok } | { ok:false, error } endpoint; throws on failure. */
export async function postJson(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; error?: string }
    | null;
  if (!json || !json.ok) {
    throw new Error(json?.error ?? "บันทึกไม่สำเร็จ");
  }
}

/** DELETE an { ok } | { ok:false, error } endpoint; throws on failure. */
export async function deleteJson(url: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE" });
  const json = (await res.json().catch(() => null)) as
    | { ok: boolean; error?: string }
    | null;
  if (!json || !json.ok) {
    throw new Error(json?.error ?? "ลบไม่สำเร็จ");
  }
}

/* ── Display formatters (local getters, no toISOString) ── */

/** "dd/MM/yyyy HH:mm" from an ISO string, using local date getters. */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(
    d.getHours(),
  )}:${p(d.getMinutes())}`;
}

/** Money with thousands separators (2 dp), or "—" when null. */
export function fmtMoney(v: number | null): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ── Forbidden state ── */

/**
 * Friendly "no access" card shown when a settings/queue API returns 403.
 * Mirrors the AP-1 settings forbidden panel.
 */
export function ForbiddenState({
  message = "หน้านี้สำหรับ IT Admin และ System Admin เท่านั้น",
  backHref = "/request/clear-advance/admin",
}: {
  message?: string;
  backHref?: string;
}) {
  return (
    <div
      className="rounded-2xl py-16 text-center"
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3"
        style={{ background: "var(--bg-badge)", color: "var(--text-muted)" }}
      >
        <Lock size={22} />
      </div>
      <h2 className="text-[16px] font-bold mb-1" style={{ color: "var(--text-heading)" }}>
        ไม่มีสิทธิ์เข้าถึง
      </h2>
      <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
        {message}
      </p>
      <Link
        href={backHref}
        className="inline-block mt-4 text-[12px] px-4 py-2 rounded-lg no-underline font-medium"
        style={{ background: "var(--bg-badge)", color: "var(--text-secondary)" }}
      >
        กลับหน้าหลัก
      </Link>
    </div>
  );
}

/* ── Loading / empty helpers ── */

export function LoadingRow({ label = "กำลังโหลด..." }: { label?: string }) {
  return (
    <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
      {label}
    </p>
  );
}

export function EmptyRow({ label = "— ไม่มีข้อมูล —" }: { label?: string }) {
  return (
    <p className="text-[12px] py-8 text-center" style={{ color: "var(--text-muted)" }}>
      {label}
    </p>
  );
}

/**
 * Card surface wrapper used by the admin sub-pages so every table/section sits
 * on the same rounded card as AP-1/AP-2.
 */
export function AdminCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl overflow-hidden ${className}`}
      style={{ background: "var(--bg-card)", border: "1px solid var(--border-card)" }}
    >
      {children}
    </div>
  );
}
