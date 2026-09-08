/**
 * Per-table column preferences — which columns are shown and in what order,
 * remembered in localStorage for the reader who set them.
 *
 * A factory rather than a module of constants because AP-2 has more than one
 * table wanting this, and each needs its own storage keys: a reader arranging
 * the approval queue must not rearrange the interface list underneath them.
 */

export interface ColumnLike {
  key: string;
}

export interface ColumnPrefs {
  /** Every column shown — the state a first-time reader starts from. */
  defaultVisible: Record<string, boolean>;
  /** Reconcile a stored order against the columns that exist today. */
  mergeOrder: (stored: string[]) => string[];
  loadOrder: () => string[];
  loadVisibility: () => Record<string, boolean>;
  saveOrder: (order: string[]) => void;
  saveVisibility: (visible: Record<string, boolean>) => void;
}

export function makeColumnPrefs(columns: ColumnLike[], colsKey: string, orderKey: string): ColumnPrefs {
  const canonical = columns.map((c) => c.key);
  const known = new Set(canonical);

  const defaultVisible = canonical.reduce(
    (acc, k) => ({ ...acc, [k]: true }),
    {} as Record<string, boolean>,
  );

  /**
   * Stored keys that no longer exist are dropped, and — the part that matters —
   * any column the stored list has never seen is appended rather than lost. A
   * column added in a later release would otherwise be invisible to every reader
   * who had ever dragged one, with nothing on screen to explain why.
   */
  const mergeOrder = (stored: string[]): string[] => {
    const kept = stored.filter((k) => known.has(k));
    const seen = new Set(kept);
    return [...kept, ...canonical.filter((k) => !seen.has(k))];
  };

  return {
    defaultVisible,
    mergeOrder,

    loadOrder() {
      if (typeof window === "undefined") return canonical;
      try {
        const raw = window.localStorage.getItem(orderKey);
        if (!raw) return canonical;
        const parsed = JSON.parse(raw) as unknown;
        if (!Array.isArray(parsed) || parsed.some((k) => typeof k !== "string")) return canonical;
        return mergeOrder(parsed as string[]);
      } catch {
        return canonical;
      }
    },

    loadVisibility() {
      if (typeof window === "undefined") return defaultVisible;
      try {
        const raw = window.localStorage.getItem(colsKey);
        if (!raw) return defaultVisible;
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object") return defaultVisible;
        // Spread over the defaults so a column added later is shown, not missing.
        return { ...defaultVisible, ...(parsed as Record<string, boolean>) };
      } catch {
        return defaultVisible;
      }
    },

    // Both writes are swallowed: a browser in private mode with storage denied
    // should lose the preference, not the click that set it.
    saveOrder(order) {
      try { window.localStorage.setItem(orderKey, JSON.stringify(order)); } catch { /* storage denied */ }
    },
    saveVisibility(visible) {
      try { window.localStorage.setItem(colsKey, JSON.stringify(visible)); } catch { /* storage denied */ }
    },
  };
}
