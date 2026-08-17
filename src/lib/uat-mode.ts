/** Per-browser UAT mode. Only a hint: membership is checked server side on every resolve. */
export const UAT_MODE_COOKIE = "form-portal-uat-mode";
export const UAT_MODE_MAX_AGE = 60 * 60 * 24 * 30;

export function isUatModeCookieOn(raw: string | null | undefined): boolean {
  return raw === "1";
}
