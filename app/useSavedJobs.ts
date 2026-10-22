"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "gazette-jobs:saved:v1";

function read(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // Private mode, blocked storage or corrupt JSON: behave as "nothing saved".
    return [];
  }
}

function write(ids: string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Storage full or blocked: the in-memory state still works for this visit.
  }
}

/**
 * Saved vacancy ids, kept in this browser's localStorage — no account and no
 * server. Starts empty and loads after mount so the server-rendered HTML and
 * the first client render match.
 */
export function useSavedJobs() {
  const [saved, setSaved] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSaved(new Set(read()));

    // Keep other open tabs in sync.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setSaved(new Set(read()));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const toggle = useCallback((id: string) => {
    setSaved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      write([...next]);
      return next;
    });
  }, []);

  return { saved, toggle };
}
