/**
 * The Revenue Department's VAT registrant lookup — the pure half.
 *
 * `https://rdws.rd.go.th/serviceRD3/vatserviceRD3.asmx` answers a 13-digit tax id
 * with the registered name, the branch number and the date the RD approved the
 * business to issue tax invoices. It takes `anonymous`/`anonymous`; there is no
 * key to obtain.
 *
 * Why it is worth the call: the OCR spelled one seller's name four different ways
 * across four reads, and nothing on our side could tell which was right. This can
 * — and it also answers a question we could not ask at all before, namely whether
 * the seller is registered for VAT, since input tax from someone who is not
 * cannot be claimed.
 *
 * A registrant that does not answer is not an error. Small sellers are not VAT
 * registered, and "not registered" is a fact about the invoice worth showing.
 */

export interface RdVatRegistrant {
  /** The tax id as the RD holds it. */
  nid: string;
  /** "บริษัท", "ห้างหุ้นส่วนจำกัด", "นาย" … — a juristic prefix or a personal title. */
  titleName: string | null;
  /** The registered name, without the title. */
  name: string | null;
  /** 0 for the head office, 1.. for a branch. */
  branchNumber: number | null;
  /** The same number as the five-digit code BC keeps — 0 becomes "00000". */
  branchCode: string | null;
  /** When the RD approved them to issue tax invoices. */
  vatRegisteredOn: string | null;
  /** One line, as the RD holds it. Empty parts are dropped rather than dashed. */
  address: string | null;
}

export const RD_VAT_ENDPOINT = "https://rdws.rd.go.th/serviceRD3/vatserviceRD3.asmx";
export const RD_VAT_SOAP_ACTION =
  "https://rdws.rd.go.th/serviceRD3/vatserviceRD3/Service";

/** The SOAP envelope for one tax id. Branch 0 asks for the head office record. */
export function buildRdVatRequest(taxId: string): string {
  const tin = taxId.replace(/\D/g, "").slice(0, 13);
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Service xmlns="https://rdws.rd.go.th/serviceRD3/vatserviceRD3">
      <username>anonymous</username>
      <password>anonymous</password>
      <TIN>${tin}</TIN>
      <Name></Name>
      <ProvinceCode>0</ProvinceCode>
      <BranchNumber>0</BranchNumber>
      <AmphurCode>0</AmphurCode>
    </Service>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * One field out of the answer. Values arrive wrapped —
 * `<vName><anyType xsi:type="xsd:string">…</anyType></vName>` — and an absent one
 * is self-closing, `<vtin />`.
 *
 * The RD writes "-" where it holds nothing, so that is read as nothing too: a
 * dash in an address line is not part of the address.
 */
function field(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  if (!m) return null;
  const inner = /<anyType[^>]*>([\s\S]*?)<\/anyType>/.exec(m[1]);
  const v = (inner ? inner[1] : m[1]).trim();
  return v && v !== "-" ? v : null;
}

/**
 * The registrant, or null when the RD holds no VAT registration for that number.
 *
 * Null covers both "no such registrant" and an answer that carries no tax id —
 * the caller treats them the same, because to a reviewer they mean the same
 * thing: this invoice's seller is not on the VAT register.
 */
export function parseRdVatResponse(xml: string): RdVatRegistrant | null {
  const nid = field(xml, "vNID");
  if (!nid) return null;

  const branchRaw = field(xml, "vBranchNumber");
  const branchNumber = branchRaw != null && /^\d+$/.test(branchRaw) ? Number(branchRaw) : null;

  const address = [
    field(xml, "vHouseNumber"),
    field(xml, "vBuildingName"),
    field(xml, "vRoomNumber"),
    field(xml, "vStreetName"),
    field(xml, "vThambol"),
    field(xml, "vAmphur"),
    field(xml, "vProvince"),
    field(xml, "vPostCode"),
  ].filter(Boolean).join(" ");

  return {
    nid,
    titleName: field(xml, "vBranchTitleName") ?? field(xml, "vtitleName"),
    name: field(xml, "vBranchName") ?? field(xml, "vName"),
    branchNumber,
    branchCode: branchNumber != null ? String(branchNumber).padStart(5, "0") : null,
    vatRegisteredOn: field(xml, "vBusinessFirstDate"),
    address: address || null,
  };
}

/** The registrant's full name as it would be written on an invoice. */
export function registrantFullName(r: RdVatRegistrant): string | null {
  const joined = [r.titleName, r.name].filter(Boolean).join(" ").trim();
  return joined || null;
}

/**
 * Whether two spellings name the same registrant.
 *
 * The invoice, the vendor card and the register disagree about spacing —
 * "บริษัท เซ็นทรัล พัฒนา จำกัด (มหาชน)" and "บริษัท เซ็นทรัลพัฒนา จำกัด (มหาชน)"
 * are one company. Treating that as a difference put a "the name does not match"
 * panel on almost every line, which teaches the reader to ignore the one line
 * where it is true. Spacing is not a difference; anything else is.
 */
export function sameRegisteredName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, "");
  const x = norm(a);
  return x !== "" && x === norm(b);
}

/** What the account screen knows about one tax id, as far as this rule cares. */
export type RdAnswerState = "checking" | "found" | "unregistered" | "unknown";

/**
 * The distinct tax ids on these lines that the registry has not answered for.
 *
 * This is both the count the "ตรวจสรรพากร" button shows and the work it does.
 * It counts ids rather than rows because six receipts from one seller are one
 * question — the per-card check this replaces asked six separate times for the
 * same answer, against a SOAP service behind a 15-second timeout.
 *
 * `unknown` is a failed check and is asked again. `unregistered` is a real
 * answer and is not — the register simply has nothing on that number, which is
 * ordinary for an individual seller. `checking` is already in flight. Anything
 * that is not thirteen digits is not a question the registry can take.
 */
export function tinsNeedingRdCheck(
  items: readonly { taxId?: string | null }[] | null | undefined,
  answers: Readonly<Record<string, { state: RdAnswerState }>>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items ?? []) {
    const tin = (it.taxId ?? "").replace(/\D/g, "");
    if (tin.length !== 13 || seen.has(tin)) continue;
    seen.add(tin);
    const state = answers[tin]?.state;
    if (state === undefined || state === "unknown") out.push(tin);
  }
  return out;
}
