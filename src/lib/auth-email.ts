/** Resolve login email from NextAuth user / Microsoft Entra profile / JWT token */
export function resolveLoginEmail(
  user?: { email?: string | null } | null,
  profile?: Record<string, unknown> | null,
  token?: Record<string, unknown> | null,
): string {
  const pick = (v: unknown): string => {
    if (typeof v !== "string") return "";
    const s = v.trim();
    return s.includes("@") ? s : "";
  };

  return (
    pick(user?.email) ||
    pick(profile?.email) ||
    pick(profile?.preferred_username) ||
    pick(profile?.mail) ||
    pick(profile?.userPrincipalName) ||
    pick(profile?.upn) ||
    pick(token?.email) ||
    pick(token?.preferred_username) ||
    ""
  );
}
