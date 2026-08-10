import type { Role } from "@/lib/types";

const VALID_ROLES: Role[] = ["Staff", "IT Admin", "System Admin", "Viewer"];

const ROLE_ALIASES: Record<string, Role> = {
  staff: "Staff",
  viewer: "Viewer",
  "it admin": "IT Admin",
  itadmin: "IT Admin",
  "system admin": "System Admin",
  systemadmin: "System Admin",
};

/** Map DB AppRole to a valid Role (handles extra spaces / casing) */
export function normalizeRole(appRole: string | undefined | null): Role {
  if (!appRole) return "Staff";
  const trimmed = appRole.trim();
  if (VALID_ROLES.includes(trimmed as Role)) return trimmed as Role;
  const lower = trimmed.toLowerCase();
  const compact = lower.replace(/\s+/g, "");
  return ROLE_ALIASES[lower] ?? ROLE_ALIASES[compact] ?? "Staff";
}

export function isAdminRole(role: string | undefined | null): boolean {
  const r = normalizeRole(role ?? "Staff");
  return r === "IT Admin" || r === "System Admin";
}

export function isSystemAdminRole(role: string | undefined | null): boolean {
  return normalizeRole(role ?? "Staff") === "System Admin";
}
