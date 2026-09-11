/** Prefer HR override, then default photo URL. */
export function pickEmployeePhotoUrl(
  photoOverrideUrl: string | null | undefined,
  photoUrl: string | null | undefined,
): string | null {
  const raw = (photoOverrideUrl ?? photoUrl ?? "").trim();
  if (!raw) return null;
  if (raw.startsWith("data:") || raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/")) {
    return raw;
  }
  return raw;
}

/** Session photo first, then HR employee photo. */
export function resolveUserDisplayPhoto(
  sessionPhoto: string | null | undefined,
  hrPhotoUrl: string | null | undefined,
): string | null {
  const session = (sessionPhoto ?? "").trim();
  if (session) return session;
  return pickEmployeePhotoUrl(hrPhotoUrl, null);
}

/**
 * The cached photo endpoint for one employee, or undefined when there is
 * nobody to ask about.
 *
 * Photos used to travel as base64 inside every payload that named a person,
 * which made the HR and approver endpoints several megabytes each; they were
 * moved behind `/api/hr/photo/{staffId}`, which the browser caches. Eight
 * server-side lookups build that string, and the detail screens need it on the
 * client too — this is so there is one copy of the shape rather than a ninth.
 *
 * `undefined` rather than `null` because that is what `<Avatar photo>` reads as
 * "draw the initials": for a person with no staff id, initials are the right
 * answer and a broken image is not.
 */
export function hrPhotoUrl(staffId: number | null | undefined): string | undefined {
  return typeof staffId === "number" && Number.isFinite(staffId) && staffId > 0
    ? `/api/hr/photo/${staffId}`
    : undefined;
}
