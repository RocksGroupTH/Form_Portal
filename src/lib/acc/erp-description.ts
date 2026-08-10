/** Client-safe ERP description helpers (no mssql / Node built-ins). */

/** Default ERP journal description from a synced G/L option. */
export function erpDescriptionFromGlOption(
  accountNo: string,
  options: { value: string; subLabel?: string }[],
): string {
  if (!accountNo.trim()) return "";
  const opt = options.find((o) => o.value === accountNo);
  return opt?.subLabel?.trim() || accountNo.trim();
}
