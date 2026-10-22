/**
 * Board filters <-> URL query string, so a filtered view can be shared as a link
 * ("open exams closing within 7 days") and survives a reload.
 *
 * Only the filters that mean the same thing to every visitor are in the URL.
 * "Saved only" is deliberately left out: saved posts live in one browser's
 * localStorage, so a shared link to them would show someone else an empty list.
 */
export type ExamFilter = "all" | "any" | "open" | "limited";
export type WindowFilter = 0 | 3 | 7 | 30;

export interface Filters {
  q: string;
  exam: ExamFilter;
  within: WindowFilter;
  online: boolean;
}

export const DEFAULT_FILTERS: Filters = { q: "", exam: "all", within: 0, online: false };

const EXAMS: ExamFilter[] = ["all", "any", "open", "limited"];
const WINDOWS: WindowFilter[] = [0, 3, 7, 30];

/** Read filters from a query string. Anything unrecognised falls back to the default. */
export function parseFilters(params: URLSearchParams): Filters {
  const exam = params.get("exam") as ExamFilter | null;
  const within = Number(params.get("within")) as WindowFilter;

  return {
    q: (params.get("q") ?? "").slice(0, 100),
    exam: exam && EXAMS.includes(exam) ? exam : DEFAULT_FILTERS.exam,
    within: WINDOWS.includes(within) ? within : DEFAULT_FILTERS.within,
    online: params.get("apply") === "online",
  };
}

/** `?q=...` for the non-default filters, or "" when everything is default. */
export function filtersToSearch(f: Filters): string {
  const params = new URLSearchParams();
  if (f.q.trim()) params.set("q", f.q.trim());
  if (f.exam !== DEFAULT_FILTERS.exam) params.set("exam", f.exam);
  if (f.within !== DEFAULT_FILTERS.within) params.set("within", String(f.within));
  if (f.online) params.set("apply", "online");

  const s = params.toString();
  return s ? `?${s}` : "";
}
