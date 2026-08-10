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
