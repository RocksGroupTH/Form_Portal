"use client";

import { useState, useCallback, useEffect, useRef } from "react";

function defaultYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const STORAGE_KEY = "rocks-fast-report-filters";

interface StoredFilters {
  [reportKey: string]: {
    from?: string;
    to?: string;
    branch?: string;
  };
}

function loadAll(): StoredFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveAll(data: StoredFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full — ignore
  }
}

/**
 * Persists report filters (from, to, branch) to localStorage.
 * Each report gets its own key. Filters restore on next visit.
 */
export function useReportFilters(reportKey: string) {
  const yesterday = defaultYesterday();
  const hydrated = useRef(false);

  const [from, setFromRaw] = useState(yesterday);
  const [to, setToRaw] = useState(yesterday);
  const [branch, setBranchRaw] = useState("");

  // Hydrate from localStorage on mount
  useEffect(() => {
    const s = loadAll()[reportKey];
    if (s) {
      if (s.from) setFromRaw(s.from);
      if (s.to) setToRaw(s.to);
      if (s.branch !== undefined) setBranchRaw(s.branch);
    }
    hydrated.current = true;
  }, [reportKey]);

  // Persist entire filter state whenever it changes (after hydration)
  const persist = useCallback(
    (patch: { from?: string; to?: string; branch?: string }) => {
      if (!hydrated.current) return;
      const all = loadAll();
      const prev = all[reportKey] ?? {};
      all[reportKey] = { ...prev, ...patch };
      saveAll(all);
    },
    [reportKey],
  );

  const setFrom = useCallback(
    (v: string) => { setFromRaw(v); persist({ from: v }); },
    [persist],
  );

  const setTo = useCallback(
    (v: string) => { setToRaw(v); persist({ to: v }); },
    [persist],
  );

  const setBranch = useCallback(
    (v: string) => { setBranchRaw(v); persist({ branch: v }); },
    [persist],
  );

  return { from, to, branch, setFrom, setTo, setBranch };
}
