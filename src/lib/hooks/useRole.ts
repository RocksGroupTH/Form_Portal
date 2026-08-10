"use client";

import { useSession } from "next-auth/react";
import { normalizeRole, isAdminRole } from "@/lib/roles";
import type { Role } from "@/lib/types";

export function useRole() {
  const { data: session } = useSession();
  const role = normalizeRole(session?.user?.role);

  return {
    role,
    isViewer: role === "Viewer",
    isStaff: role === "Staff",
    isITAdmin: isAdminRole(role),
    isSystemAdmin: role === "System Admin",
    canEdit: role !== "Viewer",
    canAssign: role !== "Viewer" && role !== "Staff",
    canAdmin: isAdminRole(role),
  };
}
