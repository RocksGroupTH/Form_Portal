import sql from "mssql";

/** Filter columns this builder knows about. */
export const FILTER_KEYS = [
  "ym",
  "branch_id",
  "branch_name",
  "category",
  "channel",
  "menu_code",
  "menu_name",
  "order_type",
  "payment_type",
  "void_flag",
  "is_revenue",
] as const;

export type FilterKey = (typeof FILTER_KEYS)[number];

export type Filters = Partial<Record<FilterKey, string[]>>;

export interface SqlInput {
  name: string;
  type: sql.ISqlType | (() => sql.ISqlType);
  value: unknown;
}

/* ── Parse from URLSearchParams ── */

export function parseFiltersFromSearchParams(
  searchParams: URLSearchParams,
): Filters {
  const filters: Filters = {};
  for (const key of FILTER_KEYS) {
    // Both repeatable params (?ym=a&ym=b) and comma-separated (?ym=a,b) supported.
    const collected: string[] = [];
    for (const raw of searchParams.getAll(key)) {
      for (const part of raw.split(",")) {
        const v = part.trim();
        if (v.length > 0) collected.push(v);
      }
    }
    if (collected.length > 0) filters[key] = collected;
  }
  return filters;
}

/* ── Column expressions used in the WHERE ── */

const COLUMN_SQL: Record<Exclude<FilterKey, "ym">, string> = {
  branch_id: "branch_id",
  branch_name: "branch_name",
  category: "category",
  channel: "channel",
  menu_code: "menu_code",
  menu_name: "menu_name",
  order_type: "order_type",
  payment_type: "payment_type",
  void_flag: "void_flag",
  is_revenue: "is_revenue",
};

/* ── Date helpers ── */

function ymToRange(ym: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!y || mo < 1 || mo > 12) return null;
  const start = `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const end = `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-01`;
  return { start, end };
}

function defaultWindowStart(months: number): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - (months - 1);
  const d = new Date(Date.UTC(y, m, 1));
  const yy = d.getUTCFullYear();
  const mm = d.getUTCMonth() + 1;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-01`;
}

/* ── Build predicates / WHERE ── */

export interface BuildPredicatesOptions {
  /** When true (default) and `filters.ym` is empty, inject a default-window predicate. */
  applyDefaultYm?: boolean;
  /** Months of look-back when applyDefaultYm injects the default. */
  defaultWindowMonths?: number;
}

export function buildPredicates(
  filters: Filters,
  options?: BuildPredicatesOptions,
): { predicates: string[]; inputs: SqlInput[] } {
  const applyDefaultYm = options?.applyDefaultYm ?? true;
  const windowMonths = options?.defaultWindowMonths ?? 3;
  const predicates: string[] = [];
  const inputs: SqlInput[] = [];

  // ym filter (multi-value) → OR ranges, sargable.
  if (filters.ym && filters.ym.length > 0) {
    const ranges: string[] = [];
    filters.ym.forEach((val, i) => {
      const r = ymToRange(val);
      if (!r) return;
      const s = `ym_s_${i}`;
      const e = `ym_e_${i}`;
      inputs.push({ name: s, type: sql.DateTime2(), value: r.start });
      inputs.push({ name: e, type: sql.DateTime2(), value: r.end });
      ranges.push(`(order_datetime >= @${s} AND order_datetime < @${e})`);
    });
    if (ranges.length > 0) predicates.push(`(${ranges.join(" OR ")})`);
  } else if (applyDefaultYm) {
    const start = defaultWindowStart(windowMonths);
    inputs.push({ name: "default_start", type: sql.DateTime2(), value: start });
    predicates.push("order_datetime >= @default_start");
  }

  // Other filters: IN (@k_0, @k_1, ...)
  for (const key of Object.keys(COLUMN_SQL) as Array<Exclude<FilterKey, "ym">>) {
    const vals = filters[key];
    if (!vals || vals.length === 0) continue;
    const names: string[] = [];
    vals.forEach((val, i) => {
      const name = `${key}_${i}`;
      names.push(`@${name}`);
      inputs.push({ name, type: sql.NVarChar(256), value: val });
    });
    predicates.push(`${COLUMN_SQL[key]} IN (${names.join(",")})`);
  }

  return { predicates, inputs };
}

export function buildWhereClause(
  filters: Filters,
  options?: BuildPredicatesOptions,
): { whereSql: string; inputs: SqlInput[] } {
  const { predicates, inputs } = buildPredicates(filters, options);
  const whereSql = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
  return { whereSql, inputs };
}

/** Bind every named input on a sql.Request in one call. */
export function applyInputs(req: sql.Request, inputs: SqlInput[]): sql.Request {
  for (const i of inputs) req.input(i.name, i.type as sql.ISqlType, i.value);
  return req;
}

/** Convenience wrapper — parse filters straight from a full request URL. */
export function filtersFromRequest(url: string): Filters {
  const u = new URL(url);
  return parseFiltersFromSearchParams(u.searchParams);
}
