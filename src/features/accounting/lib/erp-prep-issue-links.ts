export type ErpSettingsTab = "departments" | "erpInterface" | "brands";
export type ErpSettingsFocus = "journalBatch" | "gl" | "bank" | "branch" | "claimTarget";

export interface ErpPrepIssueLinkContext {
  interfaceTarget?: string | null;
  interfaceByClaim?: Record<string, string>;
}

const SETTINGS_BASE = "/request/accounting/settings";

function settingsHref(params: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  return `${SETTINGS_BASE}?${qs.toString()}`;
}

function extractClaimBrand(issue: string): string | undefined {
  const match = issue.match(/แบรนด์เบิก\s+(\S+)/);
  return match?.[1]?.trim().toUpperCase() || undefined;
}

function resolveInterfaceForClaim(
  claim: string | undefined,
  ctx: ErpPrepIssueLinkContext,
): string | undefined {
  const iface = ctx.interfaceTarget?.trim().toUpperCase();
  if (iface) return iface;
  if (!claim || !ctx.interfaceByClaim) return undefined;
  return ctx.interfaceByClaim[claim]?.trim().toUpperCase() || undefined;
}

/** Maps an ERP prep issue message to a settings URL, or null if not configurable in settings. */
export function resolveErpPrepIssueLink(
  issue: string,
  ctx: ErpPrepIssueLinkContext = {},
): string | null {
  const claim = extractClaimBrand(issue);
  const iface = resolveInterfaceForClaim(claim, ctx);

  if (issue.includes("map ข้อมูล Department")) {
    return iface
      ? settingsHref({ tab: "departments", iface })
      : settingsHref({ tab: "departments" });
  }

  if (issue.includes("Journal Batch")) {
    return iface
      ? settingsHref({ tab: "erpInterface", iface, focus: "journalBatch" })
      : settingsHref({ tab: "erpInterface", focus: "journalBatch" });
  }

  if (issue.includes("G/L Account") && claim) {
    return settingsHref({
      tab: "erpInterface",
      ...(iface ? { iface } : {}),
      claim,
      focus: "gl",
    });
  }

  if (issue.includes("Bank Account") && claim) {
    return settingsHref({
      tab: "erpInterface",
      ...(iface ? { iface } : {}),
      claim,
      focus: "bank",
    });
  }

  if (issue.includes("Branch Code") && claim) {
    return settingsHref({
      tab: "erpInterface",
      ...(iface ? { iface } : {}),
      claim,
      focus: "branch",
    });
  }

  if (issue.includes("ไม่พบ Department ใน ERP") && claim) {
    return settingsHref({
      tab: "erpInterface",
      ...(iface ? { iface } : {}),
      claim,
      focus: "branch",
    });
  }

  if (issue === "ไม่มีแบรนด์เบิก") {
    return settingsHref({ tab: "brands" });
  }

  if (issue.includes("ไม่ตั้งปลายทาง") || issue.includes("ส่งเข้าแบรนด์")) {
    return claim
      ? settingsHref({ tab: "erpInterface", claim, focus: "claimTarget" })
      : settingsHref({ tab: "erpInterface" });
  }

  return null;
}

export function scrollToErpSettingsFocus(focus: string, claim?: string | null): void {
  const claimCode = claim?.trim().toUpperCase();
  const base = `acc-erp-focus-${focus}`;
  const candidates: string[] = [];
  if (claimCode) candidates.push(`${base}-${claimCode}`);
  candidates.push(base);
  if (focus === "journalBatch" && claimCode) {
    candidates.push(`acc-erp-focus-journalBatch-${claimCode}`);
  }

  window.setTimeout(() => {
    for (let i = 0; i < candidates.length; i++) {
      const el = document.getElementById(candidates[i]);
      if (!el) continue;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.style.outline = "2px solid var(--nav-active-text)";
      el.style.outlineOffset = "2px";
      window.setTimeout(() => {
        el.style.outline = "";
        el.style.outlineOffset = "";
      }, 2500);
      break;
    }
  }, 350);
}
