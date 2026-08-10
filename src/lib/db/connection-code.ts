/** Client-safe connection code helpers (no mssql / Node built-ins). */

const CODE_PATTERN = /^[A-Z0-9_-]{2,50}$/;

export function normalizeConnectionCode(value: string): string {
  return value.trim().toUpperCase();
}

export function validateConnectionCode(value: string): string | null {
  const code = normalizeConnectionCode(value);
  if (!code) return "Code is required";
  if (!CODE_PATTERN.test(code)) {
    return "Code must be 2–50 characters: letters, numbers, underscore, hyphen";
  }
  return null;
}
