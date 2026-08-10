"use client";

import React from "react";
import useSWR from "swr";
import { signOut, useSession } from "next-auth/react";
import { Building2, LogOut, Loader2, Shield, X } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { FullScreenModal } from "@/components/ui/FullScreenModal";
import { Dialog } from "@/components/ui/Dialog";
import type { EmployeeContext } from "@/lib/hr/types";
import type { WeatherBackdrop } from "@/lib/weather/types";
import { useUserPhoto } from "@/lib/hooks/useUserPhoto";
import { useWeatherBackdrop } from "@/lib/hooks/useWeatherBackdrop";
import { WeatherSkyArt } from "@/components/weather/WeatherSkyArt";
import { useTheme } from "@/components/ThemeProvider";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const SURFACE = "var(--bg-modal)";

const GLASS: React.CSSProperties = {
  background: "color-mix(in srgb, var(--bg-elevated) 80%, transparent)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid color-mix(in srgb, var(--border-card) 60%, transparent)",
};

/** 30% transparent — elevated color at 70% */
const PROFILE_CARD_GLASS: React.CSSProperties = {
  background: "color-mix(in srgb, var(--bg-elevated) 70%, transparent)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)",
  border: "1px solid color-mix(in srgb, var(--border-card) 55%, transparent)",
  boxShadow: "0 2px 12px color-mix(in srgb, var(--bg-modal) 35%, transparent)",
};

const SIGN_OUT_STYLE: React.CSSProperties = {
  background: "color-mix(in srgb, var(--color-danger) 14%, transparent)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  border: "1px solid color-mix(in srgb, var(--color-danger) 30%, transparent)",
  color: "var(--color-danger)",
};

function profileTitleStyle(theme: "light" | "gold", darkSky?: boolean): React.CSSProperties {
  if (theme === "gold") {
    return {
      color: "var(--text-heading)",
      textShadow: "0 1px 3px rgba(0,0,0,0.9), 0 1px 6px rgba(0,0,0,0.65), 0 0 2px rgba(0,0,0,0.8)",
    };
  }
  if (darkSky) {
    return {
      color: "rgba(255,255,255,0.96)",
      textShadow: "0 1px 4px rgba(0,0,0,0.55), 0 0 10px rgba(0,0,0,0.2)",
    };
  }
  return {
    color: "var(--text-heading)",
    textShadow: "0 1px 2px rgba(255,255,255,0.95), 0 1px 5px rgba(0,0,0,0.14), 0 0 1px rgba(0,0,0,0.08)",
  };
}

interface MeData {
  email: string | null;
  teamMemberEmail: string | null;
  sessionRole: string;
  dbRole: string | null;
  effectiveRole: string;
  isActive: boolean | null;
  isAdmin: boolean;
  teamMemberFound: boolean;
}

interface EmployeeApiData {
  email: string | null;
  employee: EmployeeContext | null;
  matchMethod: string | null;
  hint: string | null;
}

function statusBadge(status: string) {
  if (status === "Active") {
    return (
      <Badge
        label="Active"
        color="var(--text-info-green)"
        bg="var(--bg-info-green)"
        border="1px solid var(--border-info-green)"
        small
      />
    );
  }
  if (status === "Inactive") {
    return <Badge label="Inactive" color="var(--text-muted)" small />;
  }
  return (
    <Badge
      label="Not found"
      color="var(--text-info-yellow)"
      bg="var(--bg-info-yellow)"
      border="1px solid var(--border-info-yellow)"
      small
    />
  );
}

function GlassChip({
  children,
  darkSky,
  className = "",
}: {
  children: React.ReactNode;
  darkSky?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full backdrop-blur-md ${className}`}
      style={{
        background: darkSky ? "rgba(255,255,255,0.14)" : "color-mix(in srgb, var(--bg-elevated) 55%, transparent)",
        border: darkSky ? "1px solid rgba(255,255,255,0.12)" : "1px solid color-mix(in srgb, var(--border-card) 50%, transparent)",
        color: darkSky ? "rgba(255,255,255,0.92)" : "var(--text-secondary)",
      }}
    >
      {children}
    </span>
  );
}

function ProfileWeatherAmbient({ backdrop }: { backdrop: WeatherBackdrop }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{ background: backdrop.gradient, opacity: backdrop.darkSky ? 0.38 : 0.45 }}
      />
      <div className="absolute left-0 top-0 w-[58%] max-w-[240px] h-[min(58%,240px)]">
        <WeatherSkyArt scene={backdrop.scene} className="absolute inset-0" />
      </div>
      {backdrop.effect === "rain" && (
        <div className="profile-weather-rain absolute inset-0 opacity-[0.18]" />
      )}
      {backdrop.effect === "snow" && (
        <div className="profile-weather-snow absolute inset-0 opacity-[0.22]" />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: backdrop.darkSky
            ? `linear-gradient(180deg, rgba(0,0,0,0.1) 0%, transparent 30%, color-mix(in srgb, ${SURFACE} 82%, transparent) 58%, ${SURFACE} 100%)`
            : `linear-gradient(180deg, transparent 0%, color-mix(in srgb, ${SURFACE} 70%, transparent) 42%, ${SURFACE} 92%)`,
        }}
      />
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === "") return null;
  return (
    <div
      className="flex items-center justify-between gap-4 px-4 py-3 last:border-b-0"
      style={{
        borderBottomWidth: 1,
        borderBottomStyle: "solid",
        borderBottomColor: "color-mix(in srgb, var(--border-light) 80%, transparent)",
      }}
    >
      <span className="text-[11px] font-medium uppercase tracking-wide shrink-0" style={{ color: "var(--text-faint)" }}>
        {label}
      </span>
      <span
        className="text-[13px] text-right font-medium break-all leading-snug max-w-[60%]"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </span>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  children,
  hint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>;
  title: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <section className="mb-3.5">
      <div className="flex items-center gap-2 mb-2 px-0.5">
        <div
          className="flex items-center justify-center w-6 h-6 rounded-lg shrink-0 backdrop-blur-sm"
          style={{
            ...GLASS,
            background: "color-mix(in srgb, var(--accent-subtle) 85%, transparent)",
            color: "var(--nav-active-text)",
          }}
        >
          <Icon size={13} />
        </div>
        <h3 className="text-[12px] font-semibold uppercase tracking-wider flex-1 min-w-0" style={{ color: "var(--text-muted)" }}>
          {title}
        </h3>
        {hint && (
          <span className="text-[11px] truncate font-medium" style={{ color: "var(--text-faint)" }}>
            {hint}
          </span>
        )}
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ ...GLASS, boxShadow: "var(--shadow-sm)" }}>
        {children}
      </div>
    </section>
  );
}

function ProfileHeader({
  role,
  memberStatus,
  backdrop,
  temperature,
  labelTh,
  onClose,
}: {
  role: string;
  memberStatus: string;
  backdrop: WeatherBackdrop;
  temperature: number | null;
  labelTh: string | null;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const user = session?.user;
  const displayPhoto = useUserPhoto();
  const { theme } = useTheme();

  if (!user) return null;

  const weatherChip =
    labelTh != null && temperature != null ? `${temperature}°C · ${labelTh}` : null;

  return (
    <div className="shrink-0 relative z-[2]">
      <div className="relative px-5 pt-4 pb-4">
        <div className="relative z-10 flex items-center justify-between gap-2 mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={profileTitleStyle(theme, backdrop.darkSky)}>
            My profile
          </span>
          <div className="relative z-10 flex items-center gap-1.5 shrink-0">
            {weatherChip && (
              <GlassChip darkSky={backdrop.darkSky} className="text-[10px] font-medium px-2 py-0.5 max-w-[140px] truncate">
                {weatherChip}
              </GlassChip>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-7 h-7 flex items-center justify-center rounded-full cursor-pointer transition-opacity hover:opacity-80 backdrop-blur-md"
              style={{
                ...GLASS,
                color: "var(--text-muted)",
              }}
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div
          className="relative z-[1] flex items-start gap-4 rounded-2xl p-3.5"
          style={PROFILE_CARD_GLASS}
        >
          <div
            className="shrink-0 rounded-full p-[2px]"
            style={{
              background: `linear-gradient(135deg, var(--nav-active-text), var(--accent))`,
            }}
          >
            <div
              className="rounded-full p-[2px] backdrop-blur-sm"
              style={{ background: "color-mix(in srgb, var(--bg-modal) 75%, transparent)" }}
            >
              <Avatar
                name={user.nickname || user.name || ""}
                color={user.color}
                size={56}
                photo={displayPhoto}
              />
            </div>
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[17px] font-semibold truncate leading-tight" style={{ color: "var(--text-heading)" }}>
              {user.name}
            </p>
            {user.nickname && user.nickname !== user.name && (
              <p className="text-[12px] truncate mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {user.nickname}
              </p>
            )}
            <p className="text-[12px] truncate mt-1.5" style={{ color: "var(--text-muted)" }}>
              {user.email}
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
              <Badge label={role} color="var(--nav-active-text)" small />
              {statusBadge(memberStatus)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProfileScrollContent({ open }: { open: boolean }) {
  const { data: session } = useSession();
  const user = session?.user;

  const { data: meRes } = useSWR<{ ok: boolean; data?: MeData }>(
    open && user ? "/api/me" : null,
    fetcher,
  );

  const { data: empRes, isLoading: empLoading } = useSWR<{ ok: boolean; data?: EmployeeApiData }>(
    open && user ? "/api/me/employee" : null,
    fetcher,
  );

  const me = meRes?.data;
  const emp = empRes?.data;
  const role = me?.effectiveRole ?? user?.role ?? "";
  const memberStatus = me?.teamMemberFound
    ? me.isActive === false ? "Inactive" : "Active"
    : "Not found";

  if (!user) return null;

  return (
    <div className="relative z-[1] px-4 pb-4">
      <Section icon={Shield} title="Account">
        <DataRow label="Member ID" value={user.id || null} />
        <DataRow label="Role" value={role} />
        <DataRow label="Admin" value={me?.isAdmin ? "Yes" : "No"} />
        {me?.dbRole && me.dbRole !== role && (
          <DataRow label="Database role" value={me.dbRole} />
        )}
        {me?.teamMemberEmail && me.teamMemberEmail !== user.email && (
          <DataRow label="TeamMember email" value={me.teamMemberEmail} />
        )}
      </Section>

      <Section
        icon={Building2}
        title="HR Employee"
        hint={emp?.employee ? (emp.employee.brand.code || emp.employee.brand.name) : undefined}
      >
        {empLoading && (
          <div className="flex items-center justify-center gap-2 py-8" style={{ color: "var(--text-muted)" }}>
            <Loader2 size={15} className="animate-spin" style={{ color: "var(--nav-active-text)" }} />
            <span className="text-[12px]">Loading employee data…</span>
          </div>
        )}
        {!empLoading && emp?.employee && (
          <>
            {(emp.employee.position || emp.employee.departmentName) && (
              <div
                className="px-4 py-3"
                style={{
                  borderBottom: "1px solid color-mix(in srgb, var(--border-light) 80%, transparent)",
                  borderLeft: "3px solid var(--nav-active-text)",
                }}
              >
                {emp.employee.position && (
                  <p className="text-[14px] font-semibold leading-snug" style={{ color: "var(--text-heading)" }}>
                    {emp.employee.position}
                  </p>
                )}
                {emp.employee.departmentName && (
                  <p className="text-[12px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    {emp.employee.departmentName}
                  </p>
                )}
              </div>
            )}
            <DataRow label="Staff ID" value={emp.employee.staffId} />
            <DataRow label="Name (TH)" value={emp.employee.fullNameTh} />
            <DataRow label="Work email" value={emp.employee.emailCompBr ?? emp.employee.email} />
            <DataRow label="Phone" value={emp.employee.phone} />
            <DataRow label="Company" value={emp.employee.brand.companyName} />
          </>
        )}
        {!empLoading && !emp?.employee && (
          <p className="text-[12px] py-8 text-center leading-relaxed px-4" style={{ color: "var(--text-muted)" }}>
            {emp?.hint ?? "No employee record for this email."}
          </p>
        )}
      </Section>
    </div>
  );
}

function ProfileFooter({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="relative z-[1] shrink-0 px-4 py-3">
      <button
        type="button"
        onClick={onSignOut}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-medium cursor-pointer transition-all hover:opacity-90 active:scale-[0.99] backdrop-blur-md"
        style={SIGN_OUT_STYLE}
      >
        <LogOut size={15} />
        Sign out
      </button>
    </div>
  );
}

function ProfileLayout({
  open,
  onClose,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const { data: session } = useSession();
  const user = session?.user;
  const { backdrop, temperature, labelTh } = useWeatherBackdrop(open);

  const { data: meRes } = useSWR<{ ok: boolean; data?: MeData }>(
    open && user ? "/api/me" : null,
    fetcher,
  );

  const me = meRes?.data;
  const role = me?.effectiveRole ?? user?.role ?? "";
  const memberStatus = me?.teamMemberFound
    ? me?.isActive === false ? "Inactive" : "Active"
    : "Not found";

  return (
    <div className="relative flex flex-col flex-1 min-h-0 h-full overflow-hidden" style={{ background: SURFACE }}>
      <ProfileWeatherAmbient backdrop={backdrop} />
      <ProfileHeader
        role={role}
        memberStatus={memberStatus}
        backdrop={backdrop}
        temperature={temperature}
        labelTh={labelTh}
        onClose={onClose}
      />
      <div className="relative z-[1] flex-1 min-h-0 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <ProfileScrollContent open={open} />
      </div>
      <ProfileFooter onSignOut={onSignOut} />
    </div>
  );
}

export function UserProfileModal({
  open,
  onClose,
  mobile,
}: {
  open: boolean;
  onClose: () => void;
  mobile?: boolean;
}) {
  const handleSignOut = () => {
    onClose();
    void signOut({ callbackUrl: "/login" });
  };

  if (mobile) {
    return (
      <FullScreenModal open={open} onClose={onClose} uniformSurface hideHeader>
        <ProfileLayout open={open} onClose={onClose} onSignOut={handleSignOut} />
      </FullScreenModal>
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="My profile"
      hideTitle
      scrollable={false}
      uniformSurface
      hideCloseButton
      bleedBackground
      contentClassName="max-w-[420px] w-[calc(100%-2rem)] !rounded-2xl overflow-hidden"
    >
      <ProfileLayout open={open} onClose={onClose} onSignOut={handleSignOut} />
    </Dialog>
  );
}
