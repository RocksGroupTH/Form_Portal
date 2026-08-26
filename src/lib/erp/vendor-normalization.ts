export interface BcVendorRow extends Record<string, unknown> {
  id?: string;
  number?: string;
  displayName?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  phoneNumber?: string;
  email?: string;
  website?: string;
  taxRegistrationNumber?: string;
  currencyId?: string;
  currencyCode?: string;
  taxLiable?: boolean;
  blocked?: string;
  lastModifiedDateTime?: string;
}

export interface NormalizedVendor {
  bcVendorId: string;
  vendorNo: string;
  displayName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  postalCode: string | null;
  phoneNumber: string | null;
  email: string | null;
  website: string | null;
  taxRegistrationNumber: string | null;
  currencyId: string | null;
  currencyCode: string | null;
  taxLiable: boolean;
  blockedStatus: string | null;
  isBlocked: boolean;
  bcLastModified: Date | null;
}

// BC SystemId values are SQL uniqueidentifier values, not guaranteed to carry
// RFC 4122 version/variant bits. Validate the exact SQL GUID shape only.
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalGuid(value: unknown, field: string): string | null {
  const valueText = text(value);
  if (!valueText || valueText === ZERO_GUID) return null;
  if (!GUID_RE.test(valueText)) throw new Error(`Invalid BC vendor ${field}`);
  return valueText.toLowerCase();
}

function blockedStatus(value: unknown): string | null {
  const status = text(value);
  // Standard API encodes the blank Vendor Blocked enum member (a single U+0020)
  // as its OData-safe name. It means "not blocked", not a real status.
  if (!status || status.toLowerCase() === "_x0020_") return null;
  return status;
}

export function normalizeVendorRow(row: BcVendorRow): NormalizedVendor {
  const bcVendorId = optionalGuid(row.id, "id");
  const vendorNo = text(row.number);
  if (!bcVendorId) throw new Error("BC vendor row is missing id");
  if (!vendorNo) throw new Error(`BC vendor ${bcVendorId} is missing number`);

  const normalizedBlockedStatus = blockedStatus(row.blocked);
  const bcLastModifiedText = text(row.lastModifiedDateTime);
  let bcLastModified: Date | null = null;
  if (bcLastModifiedText) {
    bcLastModified = new Date(bcLastModifiedText);
    if (Number.isNaN(bcLastModified.getTime())) {
      throw new Error(`BC vendor ${vendorNo} has invalid lastModifiedDateTime`);
    }
  }

  return {
    bcVendorId,
    vendorNo,
    displayName: text(row.displayName) ?? vendorNo,
    addressLine1: text(row.addressLine1),
    addressLine2: text(row.addressLine2),
    city: text(row.city),
    state: text(row.state),
    countryCode: text(row.country),
    postalCode: text(row.postalCode),
    phoneNumber: text(row.phoneNumber),
    email: text(row.email),
    website: text(row.website),
    taxRegistrationNumber: text(row.taxRegistrationNumber),
    currencyId: optionalGuid(row.currencyId, "currencyId"),
    currencyCode: text(row.currencyCode),
    taxLiable: row.taxLiable === true,
    blockedStatus: normalizedBlockedStatus,
    isBlocked: normalizedBlockedStatus !== null,
    bcLastModified,
  };
}

export function normalizeVendorSnapshot(rows: BcVendorRow[]): NormalizedVendor[] {
  const byId = new Map<string, NormalizedVendor>();
  for (const row of rows) {
    const vendor = normalizeVendorRow(row);
    const prior = byId.get(vendor.bcVendorId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(vendor)) {
      throw new Error(`BC vendor snapshot has conflicting duplicate id ${vendor.bcVendorId}`);
    }
    byId.set(vendor.bcVendorId, vendor);
  }
  return Array.from(byId.values());
}
